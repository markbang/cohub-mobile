import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { MediaPlayer, ModelViewer } from "@/src/components/MediaViewers";
import { modelFormat } from "@/src/data/media";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { IconButton, Screen, TopBar } from "@/src/ui";

type Params = { url?: string; kind?: string; title?: string; poster?: string; mimeType?: string };

export default function MediaViewerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { url = "", kind, title, poster, mimeType } = useLocalSearchParams<Params>();
  // Routes can be opened by links, so only plain HTTPS media is played.
  const safe = /^https:\/\//i.test(url);
  const format = kind === "model" ? modelFormat(url, mimeType) : null;
  return <Screen>
    <TopBar title={title || t("media.title")} onBack={() => router.back()} actions={safe ? <IconButton name="external-link" label={t("file.openExternally")} onPress={() => void openWebLink(url).catch(() => undefined)} /> : undefined} />
    {!safe || (kind === "model" && !format) || (kind !== "model" && kind !== "video" && kind !== "audio")
      ? <View className="flex-1 items-center justify-center p-6"><Text className="text-center text-subhead text-fg-muted">{t("media.unsupported")}</Text></View>
      : format ? <ModelViewer url={url} format={format} />
      : <MediaPlayer url={url} kind={kind === "audio" ? "audio" : "video"} poster={poster && /^https:\/\//i.test(poster) ? poster : null} />}
  </Screen>;
}
