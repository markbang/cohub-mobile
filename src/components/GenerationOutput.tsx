import type { GenerationContentBlock } from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { Image, PixelRatio, Pressable, Text, View, useWindowDimensions } from "react-native";
import { setImageViewerPayload } from "@/src/data/image-viewer";
import { imageThumbnailUrl, modelFormat, videoPosterUrl } from "@/src/data/media";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { AppIcon, type IconName } from "@/src/ui";

const CONTINUOUS = { borderCurve: "continuous" } as const;

function sourceUrl(block: Exclude<GenerationContentBlock, { type: "text" }>): string | null {
  if (block.source.type === "url") return block.source.url;
  return block.type === "image" ? `data:${block.source.mediaType};base64,${block.source.data}` : null;
}

export function GenerationBlock({ block }: { block: GenerationContentBlock }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  if (block.type === "text") return <Text selectable className="text-chat text-fg">{block.text}</Text>;
  const url = sourceUrl(block);
  const tileWidth = width - 32;
  if (block.type === "image") {
    if (!url) return null;
    return <Pressable accessibilityRole="button" accessibilityLabel={t("media.openImage")} onPress={() => { setImageViewerPayload({ uris: [url], index: 0 }); router.push("/image-viewer"); }} className="overflow-hidden rounded-md bg-surface-raised active:opacity-80" style={CONTINUOUS}>
      <Image source={{ uri: imageThumbnailUrl(url, tileWidth, PixelRatio.get()) }} resizeMode="contain" style={{ width: "100%", height: 320 }} />
    </Pressable>;
  }
  const playable = url && /^https:\/\//i.test(url) ? url : null;
  if (block.type === "video") {
    const poster = playable ? videoPosterUrl(playable, tileWidth, PixelRatio.get()) : null;
    return <Pressable accessibilityRole="button" accessibilityLabel={t("media.playVideo")} disabled={!playable} onPress={() => { if (playable) router.push({ pathname: "/media-viewer", params: { url: playable, kind: "video", ...(poster ? { poster } : {}) } }); }} className="h-60 items-center justify-center overflow-hidden rounded-md bg-surface-raised active:opacity-80" style={CONTINUOUS}>
      {poster ? <Image source={{ uri: poster }} resizeMode="cover" className="absolute inset-0" /> : null}
      <View className="size-14 items-center justify-center rounded-full bg-surface-float shadow-float"><AppIcon name="play" size={24} tone="fg" /></View>
    </Pressable>;
  }
  const format = block.type === "3d" && playable ? modelFormat(playable, typeof block.meta?.mimeType === "string" ? block.meta.mimeType : null) : null;
  const icon: IconName = block.type === "audio" ? "mic" : "box";
  const label = block.type === "audio" ? t("media.audio") : format ? t("media.model", { format: format.toUpperCase() }) : t("media.modelFile");
  const open = () => {
    if (!playable) return;
    if (block.type === "audio") router.push({ pathname: "/media-viewer", params: { url: playable, kind: "audio" } });
    else if (format) router.push({ pathname: "/media-viewer", params: { url: playable, kind: "model" } });
    else void openWebLink(playable).catch(() => undefined);
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!playable} onPress={open} className="min-h-14 flex-row items-center gap-3 rounded-md bg-surface px-4 py-3 active:bg-surface-pressed disabled:opacity-55" style={CONTINUOUS}>
    <View className="size-9 items-center justify-center rounded-sm bg-accent-soft"><AppIcon name={icon} size={18} tone="accent" /></View>
    <Text numberOfLines={1} className="min-w-0 flex-1 text-body text-fg">{label}</Text>
    <AppIcon name={block.type === "3d" && !format ? "external-link" : "play"} size={16} tone="muted" />
  </Pressable>;
}
