import { createNativeStackProps, createStandardRouterNavigator, IsWithinNativeNavigator, useRouter, type NativeStackNavigationOptions, type NavigatorContentProps } from "expo-router";
import { createStandardNativeStackNavigator, type NativeStackNavigatorCreateProps, type StandardNativeStackEventMap } from "expo-router/build/fork/native-stack/createNativeStackNavigator";
// The router `Stack` itself uses: singular routes, the zoom-transition id, and previews on top of React Navigation's.
import { StackRouter } from "expo-router/build/layouts/stack-router";
import { useLinkPreviewContext } from "expo-router/build/link/preview/LinkPreviewContext";
import { INTERNAL_EXPO_ROUTER_NO_ANIMATION_PARAM_NAME } from "expo-router/build/navigationParams";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { chatSessionId, focusedRouteKeys, leftPaneWidth, selectedChatId, splitMode, splitRoutes } from "@/src/data/split-navigation";
import { useTranslation } from "@/src/i18n";
import { PrimaryButton } from "@/src/ui";
import { Mascot } from "@/src/ui/Mascot";
import { clearUnanimatedChat, isUnanimatedChat, PaneContext, PaneRouteIndexContext, SplitLayoutContext, type Pane, type SplitLayout } from "@/src/ui/pane";

type ContentProps = NavigatorContentProps<NativeStackNavigationOptions, StandardNativeStackEventMap, object, NativeStackNavigatorCreateProps>;
type Descriptors = ContentProps["descriptors"];
type Route = ContentProps["state"]["routes"][number];
type RouteState = Parameters<typeof focusedRouteKeys>[0];

const NativeStackContent = createStandardNativeStackNavigator.NavigatorContent;

/**
 * The root navigator: Expo Router's native stack over one navigation state, drawn two ways. A
 * compact window is the phone's stack, unchanged. A split window keeps the tab app (`routes[0]`)
 * as the stack's bottom screen and draws it as two panes: the tab app on the left and the routes
 * above it in a second native stack on the right. New Chat and the viewers stay in the outer stack,
 * so they cover both panes. The tab app keeps its place in the tree across both layouts; the right
 * pane's screens remount when the layout changes (Chat drafts are persisted).
 */
function SplitStackContent(props: ContentProps) {
  const { state, descriptors, emitter, isPreloaded } = props;
  const window = useWindowDimensions();
  const mode = splitMode(window.width, window.height);
  const split = mode === "split";
  const leftWidth = leftPaneWidth(window.width);
  const root = state.routes[0];
  const { pane, overlays } = useMemo(() => split ? splitRoutes(state.routes) : { pane: [], overlays: [] }, [split, state.routes]);
  const paneTop = pane.at(-1);

  // A Chat opened from the left list appears in place; the flag lifts once it has appeared, so its
  // own back still animates. Derived during render (as React documents) so the first frame has it.
  const [unanimated, setUnanimated] = useState<{ top: string | undefined; keys: ReadonlySet<string> }>({ top: undefined, keys: new Set() });
  if (unanimated.top !== paneTop?.key) {
    const keys = new Set([...unanimated.keys].filter((key) => pane.some((route) => route.key === key)));
    if (paneTop && isUnanimatedChat(chatSessionId(paneTop))) keys.add(paneTop.key);
    setUnanimated({ top: paneTop?.key, keys });
  }
  useEffect(clearUnanimatedChat, [unanimated.top]);
  const paneEmitter = useMemo<ContentProps["emitter"]>(() => ({
    emit: (event) => {
      if (event.type === "transitionEnd" && event.target && !(event.data as { closing?: boolean } | undefined)?.closing) {
        const target = event.target;
        setUnanimated((current) => current.keys.has(target) ? { ...current, keys: new Set([...current.keys].filter((key) => key !== target)) } : current);
      }
      return emitter.emit(event);
    },
  }), [emitter, setUnanimated]);

  const layout = useMemo<SplitLayout>(() => ({ mode, selectedChatId: selectedChatId(pane), paneTopName: paneTop?.name }), [mode, pane, paneTop?.name]);
  const overlayOnTop = overlays.some((route) => !isPreloaded(route.key));
  const rootState = (root as Route & { state?: RouteState }).state;
  const leftPane = useMemo<Pane>(() => ({ width: leftWidth, visibleKeys: split && !overlayOnTop ? new Set(focusedRouteKeys(rootState)) : null }), [leftWidth, overlayOnTop, rootState, split]);
  const rightPane = useMemo<Pane>(() => ({ width: window.width - leftWidth, visibleKeys: null }), [leftWidth, window.width]);

  const paneDescriptors = useMemo(() => {
    const result: Descriptors = { ...descriptors };
    pane.forEach((route, index) => {
      const descriptor = descriptors[route.key];
      if (!descriptor) return;
      result[route.key] = {
        ...descriptor,
        options: { ...descriptor.options, ...(unanimated.keys.has(route.key) ? { animation: "none" } : null), ...(index === 0 ? { gestureEnabled: false } : null) },
        render: () => <PaneRouteIndexContext value={index}>{descriptor.render()}</PaneRouteIndexContext>,
      };
    });
    return result;
  }, [descriptors, pane, unanimated.keys]);

  const paneStack = split && pane.length > 0
    ? <NativeStackContent {...props} emitter={paneEmitter} descriptors={paneDescriptors} state={{ index: pane.length - 1, routes: pane }} />
    : null;
  const rootDescriptor = descriptors[root.key];
  const outerDescriptors: Descriptors = {
    ...descriptors,
    [root.key]: {
      ...rootDescriptor,
      render: () => <SplitRoot split={split} leftPane={leftPane} rightPane={rightPane} paneStack={paneStack}>{rootDescriptor.render()}</SplitRoot>,
    },
  };
  const outerState = split ? { index: overlays.length, routes: [root, ...overlays] } : state;

  return <SplitLayoutContext value={layout}>
    <NativeStackContent {...props} descriptors={outerDescriptors} state={outerState} />
  </SplitLayoutContext>;
}

/** The tab app's screen. Its children keep one position in both layouts, so switching never remounts the tabs. */
function SplitRoot({ split, leftPane, rightPane, paneStack, children }: { split: boolean; leftPane: Pane; rightPane: Pane; paneStack: ReactNode; children: ReactNode }) {
  return <View className="flex-1 flex-row">
    {/* Each pane clips its own push transitions and slide-out panels. */}
    <View className={split ? "overflow-hidden border-border" : "flex-1"} style={split ? { width: leftPane.width, borderRightWidth: StyleSheet.hairlineWidth } : undefined}>
      <PaneContext value={split ? leftPane : null}>{children}</PaneContext>
    </View>
    {split ? <View testID="split-right-pane" className="flex-1 overflow-hidden"><PaneContext value={rightPane}>{paneStack ?? <EmptyPane />}</PaneContext></View> : null}
  </View>;
}

/** No Chat is open. Opening the latest one would mark it read, so the pane waits for a choice. */
function EmptyPane() {
  const router = useRouter();
  const { t } = useTranslation();
  return <View className="flex-1 items-center justify-center gap-3 bg-background">
    <Mascot size={92} />
    <PrimaryButton label={t("chats.action.newChat")} icon="square-pen" variant="ghost" onPress={() => router.push("/new-chat")} />
  </View>;
}

const SplitStackNavigator = createStandardRouterNavigator(SplitStackContent, StackRouter, {
  activityDefaultThreshold: 2,
  createProps: createNativeStackProps,
});

type ScreenOptions = NonNullable<ComponentProps<typeof SplitStackNavigator>["screenOptions"]>;

/**
 * Matches expo-router's `Stack` wrapper: a route carrying the no-animation param, or any route while a
 * link preview is open, does not animate.
 */
function SplitStackRoot(props: ComponentProps<typeof SplitStackNavigator>) {
  const { isStackAnimationDisabled } = useLinkPreviewContext();
  const { screenOptions } = props;
  const options = useMemo<ScreenOptions>(() => (args) => {
    const base = (typeof screenOptions === "function" ? screenOptions(args) : screenOptions) ?? {};
    const params = args.route.params as Record<string, unknown> | undefined;
    return isStackAnimationDisabled || params?.[INTERNAL_EXPO_ROUTER_NO_ANIMATION_PARAM_NAME] ? { ...base, animation: "none" } : base;
  }, [isStackAnimationDisabled, screenOptions]);
  return <IsWithinNativeNavigator value><SplitStackNavigator {...props} screenOptions={options} /></IsWithinNativeNavigator>;
}

export const SplitStack = Object.assign(SplitStackRoot, { Screen: SplitStackNavigator.Screen });
