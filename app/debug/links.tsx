import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { buildSessionDeepLink, buildSpaceDeepLink } from "@/src/config";
import { resolveMessageLink } from "@/src/data/message-links";
import { isWebLink, openWebLink } from "@/src/platform/browser";
import { getInitialNotificationUrl } from "@/src/platform/notifications";
import { useAppTheme } from "@/src/theme";
import { AppIcon, PrimaryButton, Screen, SectionHeader } from "@/src/ui";

const SAMPLE_SPACE = "241ec263-bd4f-47d6-b459-35b4219e0c23";
const SAMPLE_SESSION = "81816f3f-02fa-4b71-b775-ba64a5759c8f";

export default function DebugLinksScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const [url, setUrl] = useState(buildSessionDeepLink(SAMPLE_SESSION));
  const [spaceId, setSpaceId] = useState(SAMPLE_SPACE);
  const [notificationUrl, setNotificationUrl] = useState<string | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() =>
      getInitialNotificationUrl().then(setNotificationUrl).catch(() => setNotificationUrl(null)),
    );
  }, []);

  const resolved = resolveMessageLink(url);

  const openResolved = useCallback(() => {
    const target = resolveMessageLink(url);
    if (!target) return;
    if (target.kind === "session") {
      router.push({ pathname: "/chat/[sessionId]", params: { sessionId: target.sessionId } });
      return;
    }
    if (target.kind === "space") {
      router.push({ pathname: "/space/[spaceId]", params: { spaceId: target.spaceId } });
      return;
    }
    if (target.kind === "file") {
      if (!spaceId.trim()) return;
      router.push({ pathname: "/space/[spaceId]/file", params: { spaceId: spaceId.trim(), path: target.path } });
      return;
    }
    void (isWebLink(target.url) ? openWebLink(target.url) : Linking.openURL(target.url)).catch(() => undefined);
  }, [router, spaceId, url]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="输入链接" />
        <View className="px-4 gap-2">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={url}
            onChangeText={setUrl}
            placeholder="cohub://spaces/… 或 https://cohub.live/…"
            placeholderTextColor={theme.colors.textFaint}
            className="text-body text-fg min-h-12 px-3 border border-border rounded-md bg-background"
          />
          <Text className="text-caption text-fg-muted">文件链接所需的 Space ID（file 类型时使用）</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={spaceId}
            onChangeText={setSpaceId}
            placeholder="space uuid"
            placeholderTextColor={theme.colors.textFaint}
            className="text-body text-fg min-h-11 px-3 border border-border rounded-md bg-background"
          />
          <PrimaryButton label="解析并打开" icon="arrow-right" disabled={!resolved} onPress={openResolved} />
        </View>

        <SectionHeader title="解析结果" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Text selectable className="text-code text-fg-secondary p-4">
            {resolved ? JSON.stringify(resolved, null, 2) : "null（无效或不受支持的 scheme）"}
          </Text>
        </View>

        <SectionHeader title="快捷样例" />
        <View className="px-4 flex-row flex-wrap gap-2">
          <Preset label="session 深链" value={buildSessionDeepLink(SAMPLE_SESSION, 3)} onPick={setUrl} />
          <Preset label="space 深链" value={buildSpaceDeepLink(SAMPLE_SPACE)} onPick={setUrl} />
          <Preset label="web 会话" value={`https://cohub.live/spaces/${SAMPLE_SPACE}/sessions/${SAMPLE_SESSION}?turn=3`} onPick={setUrl} />
          <Preset label="web 空间" value={`https://cohub.live/spaces/${SAMPLE_SPACE}`} onPick={setUrl} />
          <Preset label="沙箱文件" value="/workspace/out/contact-sheet.png" onPick={setUrl} />
          <Preset label="外部链接" value="https://example.com/doc" onPick={setUrl} />
          <Preset label="mailto" value="mailto:support@cohub.live" onPick={setUrl} />
          <Preset label="非法(js)" value="javascript:alert(1)" onPick={setUrl} />
        </View>

        <SectionHeader title="通知冷启动链接" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <View className="flex-row items-center gap-2 p-4">
            <AppIcon name="bell" size={16} tone="muted" />
            <Text selectable className="text-caption text-fg-secondary flex-1">
              {notificationUrl ?? "（无：应用不是从通知点击冷启动的）"}
            </Text>
          </View>
        </View>
        <Text className="text-micro font-semibold text-fg-faint mx-4 mt-3">
          深链是不可信输入：解析只接受固定格式的 cohub://、cohub.live、沙箱路径和 http(s)/mailto；其它一律拒绝。
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Preset({ label, value, onPick }: { label: string; value: string; onPick: (value: string) => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onPick(value)} className="min-h-8 px-3 rounded-full border border-border bg-surface active:bg-surface-pressed justify-center">
      <Text className="text-caption text-fg-secondary">{label}</Text>
    </Pressable>
  );
}

