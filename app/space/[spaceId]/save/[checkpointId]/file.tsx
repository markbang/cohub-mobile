import type { SpaceFsFileResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { CodeBlock } from "@/src/components/CodeBlock";
import { UrlFilePreview } from "@/src/components/MediaViewers";
import { detectCodeLanguage } from "@/src/data/code-language";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { DataError, IconButton, LoadingDocument, Screen, TopBar } from "@/src/ui";

type Params = { spaceId: string; checkpointId: string; path: string };

export default function SaveFileScreen() {
  const { spaceId = "", checkpointId = "", path = "" } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useAppActions();
  // Not marked immutable: delivered URLs can expire, so a revisit re-reads the file.
  const fileQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:save`, checkpointId, "file", path],
    queryFn: (): Promise<SpaceFsFileResponse> => client!.space(spaceId).checkpoints(checkpointId).files.read(path),
    enabled: Boolean(client && path),
  });
  const file = fileQuery.data ?? null;
  const error = fileQuery.error ? fileQuery.error.message || t("file.openError") : null;
  const url = file?.delivery === "url" && file.url ? file.url : null;
  const text = file && !url && file.kind === "text" ? file.content : null;
  return <Screen>
    <TopBar title={path.split("/").pop() || t("file.title")} subtitle={path} onBack={() => router.back()} actions={url ? <IconButton name="external-link" label={t("file.openExternally")} onPress={() => void openWebLink(url).catch(() => undefined)} /> : undefined} />
    {error ? <DataError message={error} onRetry={() => void fileQuery.refetch()} />
      : !file ? <LoadingDocument framed />
      : url ? <UrlFilePreview url={url} path={path} mimeType={file.mimeType} />
      : text !== null ? <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}><CodeBlock code={text} language={detectCodeLanguage(path)} showLineNumbers /></ScrollView>
      : <View className="flex-1 items-center justify-center p-6"><Text className="text-center text-subhead text-fg-muted">{t("save.binaryFile")}</Text></View>}
  </Screen>;
}
