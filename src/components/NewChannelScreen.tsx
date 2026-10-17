import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useApp } from "@/src/data/context";
import { channelProviders, isChannelProvider, type ChannelProvider } from "@/src/data/channel-settings";
import { useNewChannel } from "@/src/data/use-new-channel";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { EmptyState, Field, FIELD_INPUT_CLASS, PrimaryButton, Screen, Segmented, TopBar } from "@/src/ui";

const providerNames: Record<ChannelProvider, string> = { discord: "Discord", feishu: "Feishu / Lark", wechat: "WeChat", qq: "QQ Bot" };

export function NewChannelScreen() {
  const { provider } = useLocalSearchParams<{ provider?: string | string[] }>();
  const router = useRouter();
  const { t } = useTranslation();
  if (isChannelProvider(provider)) return <ChannelForm key={provider} provider={provider} />;
  return <Screen>
    <TopBar title={t("settings.channels.add")} onBack={() => router.back()} />
    {provider !== undefined ? <EmptyState icon="messages" title={t("route.notFound")} /> : <ScrollView>
      {channelProviders.map((value) => <SettingsRow key={value} icon="messages" title={providerNames[value]} onPress={() => router.push({ pathname: "/settings/new-channel", params: { provider: value } })} />)}
    </ScrollView>}
  </Screen>;
}

function ChannelForm({ provider }: { provider: ChannelProvider }) {
  const router = useRouter();
  const { client } = useApp();
  const { t } = useTranslation();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const onCreated = useCallback(() => router.dismissTo("/settings/channels"), [router]);
  const { draft, setDraft, login, busy, error, submit, verify, cancelLogin } = useNewChannel(client, provider, onCreated);
  const [code, setCode] = useState("");
  const [qrError, setQrError] = useState(false);
  const fields = ["name", ...(provider === "discord" ? ["token"] : provider === "feishu" || provider === "qq" ? ["appId", "secret"] : [])] as ("name" | "token" | "appId" | "secret")[];
  return <Screen keyboard>
    <TopBar title={providerNames[provider]} onBack={() => router.back()} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4" contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}>
      {fields.map((field) => <Field key={field} label={t(`settings.channels.field.${field}`)}>
        <TextInput
          accessibilityLabel={t(`settings.channels.field.${field}`)}
          value={draft[field]}
          onChangeText={(value) => setDraft((current) => ({ ...current, [field]: value }))}
          editable={!busy}
          secureTextEntry={field === "token" || field === "secret"}
          autoCorrect={false}
          autoCapitalize="none"
          className={FIELD_INPUT_CLASS}
        />
      </Field>)}
      {provider === "feishu" ? <Segmented
        disabled={busy}
        value={draft.brand}
        onChange={(brand) => setDraft((current) => ({ ...current, brand }))}
        options={[{ value: "feishu", label: "Feishu" }, { value: "lark", label: "Lark" }]}
      /> : null}
      {login ? <View className="gap-3 items-center">
        {!login.expired ? <Image key={login.sessionKey} source={{ uri: login.qrDataUrl }} accessibilityLabel={t("settings.channels.qr")} resizeMode="contain" onError={() => setQrError(true)} onLoad={() => setQrError(false)} // design-system: QR codes need a white plate to scan in dark themes.
          style={{ width: "100%", maxWidth: 280, aspectRatio: 1, backgroundColor: "#ffffff" }} /> : null}
        <Text accessibilityLiveRegion="polite" className="text-body text-fg-secondary text-center">{login.expired ? t("settings.channels.expired") : login.message}</Text>
        {qrError ? <Text accessibilityRole="alert" className="text-caption text-danger">{t("settings.channels.qrError")}</Text> : null}
      </View> : null}
      {login?.needsCode ? <View className="gap-3">
        <TextInput accessibilityLabel={t("settings.channels.code")} value={code} onChangeText={setCode} keyboardType="number-pad" autoCorrect={false} className={FIELD_INPUT_CLASS} editable={!busy} />
        <PrimaryButton label={t("settings.channels.verify")} icon="check" loading={busy} onPress={() => verify(code)} />
      </View> : <PrimaryButton label={provider === "wechat" ? t(login ? "common.retry" : "settings.channels.connectWeChat") : t("common.create")} icon={provider === "wechat" ? "refresh" : "plus"} loading={busy} onPress={() => { setQrError(false); void submit(); }} />}
      {login ? <Pressable accessibilityRole="button" onPress={() => { setCode(""); setQrError(false); cancelLogin(); }} className="min-h-11 items-center justify-center active:opacity-60">
        <Text className="text-body font-semibold text-fg-secondary">{t("common.cancel")}</Text>
      </Pressable> : null}
      {error ? <Text accessibilityRole="alert" className="text-body text-danger">{error}</Text> : null}
    </ScrollView>
  </Screen>;
}
