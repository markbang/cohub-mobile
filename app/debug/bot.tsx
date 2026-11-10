import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useAppActions } from "@/src/data/context";
import { ensurePrimaryBot, type PrimaryBotResult } from "@/src/data/primary-bot";
import { PrimaryButton, Screen, SectionHeader } from "@/src/ui";

export default function DebugBotScreen() {
  const router = useRouter();
  const { client } = useAppActions();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PrimaryBotResult | null>(null);

  const run = async () => {
    if (!client) return;
    setRunning(true);
    setResult(await ensurePrimaryBot(client));
    setRunning(false);
  };

  const spaceId = result && "spaceId" in result ? result.spaceId : null;
  const sessionId = result?.status === "created" || result?.status === "ready" ? result.sessionId : null;

  return (
    <Screen scroll>
      <SectionHeader title="主 Bot" />
      <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
        <Row label="状态" value={result?.status ?? "—"} />
        <Row label="Space id" value={spaceId ?? "—"} />
        {sessionId ? <Row label="主 Chat" value={sessionId} /> : null}
        {result?.status === "ready" ? <Row label="bot mod" value={result.modEnabled ? "enabled" : "disabled"} /> : null}
        {result?.status === "conflict" ? <Note text="已有名为 cohubbot 的 Space，未挂 bot mod，没有改动" /> : null}
        {result?.status === "error" ? <Note text={result.message} danger /> : null}
      </View>
      <View className="mx-4 mt-4 gap-2">
        <PrimaryButton label="运行" icon="play" loading={running} disabled={!client} onPress={() => void run()} />
        {sessionId ? (
          <PrimaryButton
            label="打开主 Chat"
            icon="messages"
            variant="ghost"
            onPress={() => router.push({ pathname: "/chat/[sessionId]", params: { sessionId } })}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-12 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <Text className="text-body font-semibold text-fg flex-1">{label}</Text>
      <Text selectable numberOfLines={2} className="text-right text-micro text-fg-secondary" style={{ maxWidth: "64%" }}>{value}</Text>
    </View>
  );
}

function Note({ text, danger = false }: { text: string; danger?: boolean }) {
  return <Text selectable className={`text-caption p-3 ${danger ? "text-danger" : "text-fg-muted"}`}>{text}</Text>;
}
