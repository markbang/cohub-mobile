import type { SpaceFsFileResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { CodeBlock } from "@/src/components/CodeBlock";
import { UrlFilePreview } from "@/src/components/MediaViewers";
import { detectCodeLanguage } from "@/src/data/code-language";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { DataError, IconButton, LoadingRows, Screen, TopBar } from "@/src/ui";

type Params = { spaceId: string; checkpointId: string; path: string };

export default function SaveFileScreen() {
  const { spaceId = "", checkpointId = "", path = "" } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useApp();
  const [file, setFile] = useState<SpaceFsFileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!client || !path) return;
    let active = true;
    void client.space(spaceId).checkpoints(checkpointId).files.read(path)
      .then((result) => { if (active) { setFile(result); setError(null); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : t("file.openError")); });
    return () => { active = false; };
  }, [attempt, checkpointId, client, path, spaceId, t]);
  const url = file?.delivery === "url" && file.url ? file.url : null;
  const text = file && !url && file.kind === "text" ? file.content : null;
  return <Screen>
    <TopBar title={path.split("/").pop() || t("file.title")} subtitle={path} onBack={() => router.back()} actions={url ? <IconButton name="external-link" label={t("file.openExternally")} onPress={() => void openWebLink(url).catch(() => undefined)} /> : undefined} />
    {error ? <DataError message={error} onRetry={() => setAttempt((value) => value + 1)} />
      : !file ? <LoadingRows count={5} />
      : url ? <UrlFilePreview url={url} path={path} mimeType={file.mimeType} />
      : text !== null ? <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}><CodeBlock code={text} language={detectCodeLanguage(path)} showLineNumbers /></ScrollView>
      : <View className="flex-1 items-center justify-center p-6"><Text className="text-center text-subhead text-fg-muted">{t("save.binaryFile")}</Text></View>}
  </Screen>;
}
