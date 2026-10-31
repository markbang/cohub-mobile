import { createAppBridgeCore, type AppAppearance, type AppBridgeCore, type AppBridgeDialogState, type AppDetailResponse, type AppDevice } from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { config } from "@/src/config";
import { APP_SCOPES } from "@/src/data/app-manage";
import { appDevicesRequest, appHostDelivery, appHostGrant, appHostScript, appNavigationRequest, appNavigationResult, appRuntimeSignal, readAppHostMessage } from "@/src/data/app-host";
import { useApp } from "@/src/data/context";
import { useTranslation, type Translate, type TranslationKey } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme, type AppTheme } from "@/src/theme";
import { AppIcon, PrimaryButton } from "@/src/ui";

const CLOSED_DIALOG: AppBridgeDialogState = { authOpen: false, pendingAuth: null, authError: null, authSaving: false, selectedSpaceId: null, canChangeSpace: false };
const DEVICE_LABELS: Record<AppDevice, TranslationKey> = { camera: "app.host.device.camera", microphone: "app.host.device.microphone", screen: "app.host.device.screen" };

function appearanceOf(theme: AppTheme, reducedMotion: boolean): AppAppearance {
  const c = theme.colors;
  return {
    colorScheme: theme.mode === "dark" ? "dark" : "light",
    theme: `cohub-mobile-${theme.mode}`,
    reducedMotion,
    tokens: {
      "bg-primary": c.background, "bg-content": c.surface, "bg-surface": c.surface, "bg-elevated": c.surfaceRaised, "bg-input": c.surfaceRaised,
      "bg-hover": c.surfacePressed, "bg-active": c.surfacePressed,
      "text-primary": c.text, "text-secondary": c.textSecondary, "text-tertiary": c.textMuted, "text-placeholder": c.textFaint, "text-disabled": c.textFaint,
      "border-primary": c.borderStrong, "border-subtle": c.border,
      brand: c.accent, "brand-hover": c.accentPressed, "brand-soft": c.accentSoft, "brand-muted": c.accentSoft, "brand-border": c.accentBorder, "brand-ring": c.accentBorder, "brand-contrast-fg": c.accentText,
      "error-fg": c.dangerText, success: c.success, warning: c.warning, error: c.danger, info: c.info,
    },
  };
}

export function AppHostWebView({ detail, contentUrl }: { detail: AppDetailResponse; contentUrl: string }) {
  const router = useRouter();
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const { t, locale } = useTranslation();
  const { userUuid, getAccessToken } = useApp();
  const web = useRef<ComponentRef<typeof WebView>>(null);
  const ready = useRef(false);
  const [dialog, setDialog] = useState<AppBridgeDialogState>(CLOSED_DIALOG);
  const [deviceRequest, setDeviceRequest] = useState<{ requestId: string; devices: AppDevice[] } | null>(null);
  const [granted, setGranted] = useState<AppDevice[]>([]);
  const appOrigin = useMemo(() => new URL(contentUrl).origin, [contentUrl]);
  const live = useRef({ appearance: appearanceOf(theme, reducedMotion), locale, userUuid, getAccessToken });
  useEffect(() => { live.current = { appearance: appearanceOf(theme, reducedMotion), locale, userUuid, getAccessToken }; }, [getAccessToken, locale, reducedMotion, theme, userUuid]);

  const deliver = (payload: Record<string, unknown>) => web.current?.injectJavaScript(appHostDelivery(payload));
  const { app, space } = detail;
  const coreRef = useRef<{ appId: string; core: AppBridgeCore } | null>(null);
  // Built on first use from an event or effect, never during render; one core serves one App.
  const bridge = (): AppBridgeCore => {
    if (coreRef.current?.appId === app.id) return coreRef.current.core;
    const core = createAppBridgeCore({
      app: { id: app.id, spaceId: app.spaceId, slug: app.slug, userUuid: app.userUuid, appScopes: app.appScopes, spaceName: space.name ?? null },
      authorizationContext: { surface: "page" },
      devices: true,
      apiOrigin: config.apiOrigin,
      getLocale: () => live.current.locale,
      getAppearance: () => live.current.appearance,
      getWindow: () => ({ visible: true }),
      notify: (payload) => { if (ready.current) web.current?.injectJavaScript(appHostDelivery(payload)); },
      reply: (requestId, payload) => web.current?.injectJavaScript(appHostDelivery({ requestId, ...payload })),
      // Checkout returns to the browser, not this page, so the App reads its result from its entitlements.
      getCheckoutState: () => ({ status: null, orderId: null }),
      getAccessToken: (options) => live.current.getAccessToken(options),
      getViewerUuid: async () => live.current.userUuid || null,
      requestSignIn: async () => undefined,
      onStateChange: setDialog,
    });
    coreRef.current = { appId: app.id, core };
    return core;
  };

  useEffect(() => { if (ready.current) void coreRef.current?.core.notifyContextChanged(); }, [locale, theme, reducedMotion]);
  useEffect(() => () => coreRef.current?.core.cancelAuth(), []);

  const purchase = async (message: Record<string, unknown>) => {
    const requestId = message.requestId as string;
    const namespace = typeof message.type === "string" && message.type.startsWith("cohub.work.") ? "cohub.work" : "cohub.app";
    try {
      const token = await getAccessToken();
      const productKey = typeof message.productKey === "string" ? message.productKey.trim() : "";
      if (!token || !productKey) throw new Error(t("app.host.purchaseFailed"));
      const purchaseAttemptId = typeof message.purchaseAttemptId === "string" && /^[\w-]{1,128}$/.test(message.purchaseAttemptId) ? message.purchaseAttemptId : requestId.replace(/[^\w-]/g, "_").slice(0, 128);
      const response = await fetch(`${config.apiOrigin}/api/apps/${app.id}/commerce/purchase`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ productKey, purchaseAttemptId }) });
      const body = await response.json().catch(() => null) as { checkout?: { checkoutUrl?: unknown; checkoutUsable?: unknown }; message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? t("app.host.purchaseFailed"));
      const checkout = body?.checkout ?? null;
      if (checkout?.checkoutUsable === true && typeof checkout.checkoutUrl === "string") void openWebLink(checkout.checkoutUrl).catch(() => undefined);
      deliver({ requestId, type: `${namespace}.purchase.result`, checkout });
    } catch (caught) {
      deliver({ requestId, type: `${namespace}.error`, message: caught instanceof Error ? caught.message : t("app.host.purchaseFailed") });
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const message = readAppHostMessage(event.nativeEvent.data, event.nativeEvent.url, appOrigin);
    if (!message) return;
    const signal = appRuntimeSignal(message);
    if (signal === "ready") { ready.current = true; void bridge().notifyContextChanged(); return; }
    if (signal === "close") { router.back(); return; }
    const devices = appDevicesRequest(message);
    if (devices) {
      const wanted = devices.devices.filter((device) => device !== "screen");
      if (wanted.length === 0) deliver({ type: "cohub.app.devices.result", requestId: devices.requestId, status: "unavailable" });
      else if (wanted.every((device) => granted.includes(device))) deliver({ type: "cohub.app.devices.result", requestId: devices.requestId, status: "granted" });
      else setDeviceRequest({ requestId: devices.requestId, devices: wanted });
      return;
    }
    const navigation = appNavigationRequest(message);
    if (navigation) {
      deliver(appNavigationResult(navigation.requestId, Boolean(navigation.route)));
      if (navigation.route) router.push(navigation.route);
      return;
    }
    if (message.type === "cohub.app.purchase" || message.type === "cohub.work.purchase") {
      if (typeof message.requestId === "string" && message.requestId) void purchase(message);
      return;
    }
    void bridge().handleMessage({ data: message } as MessageEvent);
  };

  const answerDevices = (allow: boolean) => {
    if (!deviceRequest) return;
    if (allow) {
      const next = [...new Set([...granted, ...deviceRequest.devices])];
      setGranted(next);
      web.current?.injectJavaScript(appHostGrant(next));
    }
    deliver({ type: "cohub.app.devices.result", requestId: deviceRequest.requestId, status: allow ? "granted" : "denied" });
    setDeviceRequest(null);
  };

  return <>
    <WebView
      ref={web}
      source={{ uri: contentUrl }}
      // design-system: WebView does not take className.
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      originWhitelist={["https://*"]}
      injectedJavaScriptBeforeContentLoaded={appHostScript(appOrigin)}
      onMessage={onMessage}
      onLoadStart={() => { ready.current = false; }}
      onLoadEnd={() => { if (granted.length) web.current?.injectJavaScript(appHostGrant(granted)); }}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      // iOS asks WebKit per capture; nothing is captured before the viewer allows the device here.
      mediaCapturePermissionGrantType={granted.length ? "grantIfSameHostElseDeny" : "deny"}
      onShouldStartLoadWithRequest={(request) => {
        try {
          const url = new URL(request.url);
          if (url.protocol !== "https:") return false;
          if (url.origin === appOrigin) return true;
          void openWebLink(request.url).catch(() => undefined);
          return false;
        } catch {
          return false;
        }
      }}
      startInLoadingState
    />
    {dialog.authOpen && dialog.pendingAuth ? <AuthorizeSheet appTitle={app.meta?.title || app.meta?.name || app.slug} dialog={dialog} onSelect={(spaceId) => bridge().setSelectedSpace(spaceId)} onConfirm={() => void bridge().confirmAuth(dialog.selectedSpaceId ?? undefined)} onCancel={() => bridge().cancelAuth()} /> : null}
    <AdaptiveSheet visible={Boolean(deviceRequest)} detent="fit" title={t("app.host.devicesTitle", { app: app.meta?.title || app.meta?.name || app.slug })} onClose={() => answerDevices(false)} scrollable={false}>
      <View className="gap-3">
        {(deviceRequest?.devices ?? []).map((device) => <View key={device} className="flex-row items-center gap-3">
          <AppIcon name={device === "camera" ? "camera" : "mic"} size={18} tone="accent" />
          <Text className="text-body text-fg">{t(DEVICE_LABELS[device])}</Text>
        </View>)}
        <Text className="text-caption text-fg-muted">{t("app.host.devicesHint")}</Text>
        <View className="flex-row gap-2">
          <PrimaryButton variant="secondary" label={t("app.host.deny")} onPress={() => answerDevices(false)} className="flex-1" />
          <PrimaryButton label={t("app.host.allow")} onPress={() => answerDevices(true)} className="flex-1" />
        </View>
      </View>
    </AdaptiveSheet>
  </>;
}

function scopeLabel(scope: string, t: Translate): string {
  return (APP_SCOPES as readonly string[]).includes(scope) ? t(`app.scope.${scope as (typeof APP_SCOPES)[number]}`) : scope;
}

function AuthorizeSheet({ appTitle, dialog: state, onSelect, onConfirm, onCancel }: { appTitle: string; dialog: AppBridgeDialogState; onSelect: (spaceId: string) => void; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const pending = state.pendingAuth;
  if (!pending) return null;
  const target = pending.createSpace ? t("app.host.newSpace", { name: pending.createSpace.name }) : pending.spaceName ?? pending.homeSpaceName ?? null;
  return <AdaptiveSheet visible title={t("app.host.authorizeTitle", { app: appTitle })} subtitle={target ?? undefined} onClose={onCancel} dismissible={!state.authSaving}>
    <View className="gap-3">
      {pending.reason ? <Text className="text-subhead text-fg-secondary">{pending.reason}</Text> : null}
      <View className="overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
        {pending.scopes.map((scope, index) => <View key={scope} className={`min-h-11 flex-row items-center gap-3 px-4 py-2 ${index ? "border-t border-border" : ""}`}>
          <AppIcon name="shield" size={16} tone="accent" />
          <Text className="min-w-0 flex-1 text-body text-fg">{scopeLabel(scope, t)}</Text>
        </View>)}
      </View>
      {state.canChangeSpace && pending.spaces?.length ? <>
        <Text className="text-caption font-semibold text-fg-muted">{t("app.host.chooseSpace")}</Text>
        <View className="overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
          {pending.spaces.map((option, index) => {
            const selected = option.id === state.selectedSpaceId;
            return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={option.name ?? option.id} onPress={() => onSelect(option.id)} className={`min-h-12 flex-row items-center gap-3 px-4 active:bg-surface-pressed ${index ? "border-t border-border" : ""}`}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-body text-fg">{option.name ?? option.id.slice(0, 8)}</Text>
              {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
            </Pressable>;
          })}
        </View>
      </> : null}
      {state.authError ? <Text accessibilityRole="alert" className="text-caption text-danger">{state.authError}</Text> : null}
      <View className="flex-row gap-2">
        <PrimaryButton variant="secondary" label={t("common.cancel")} disabled={state.authSaving} onPress={onCancel} className="flex-1" />
        <PrimaryButton label={t("app.host.allow")} loading={state.authSaving} onPress={onConfirm} className="flex-1" />
      </View>
    </View>
  </AdaptiveSheet>;
}
