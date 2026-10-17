import * as Clipboard from "expo-clipboard";
import type { SpaceFsEntry } from "@neta-art/cohub";
import type { LucideIcon } from "lucide-react-native";
import Braces from "lucide-react-native/icons/braces";
import Database from "lucide-react-native/icons/database";
import FileArchive from "lucide-react-native/icons/file-archive";
import FileCode from "lucide-react-native/icons/file-code";
import FileImage from "lucide-react-native/icons/file-image";
import FileSpreadsheet from "lucide-react-native/icons/file-spreadsheet";
import FileText from "lucide-react-native/icons/file-text";
import Music from "lucide-react-native/icons/eighth-notes";
import Video from "lucide-react-native/icons/video";
import { Pressable, Text, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { AppIcon, type IconName } from "@/src/ui";
import { FILE_TYPE_COLORS } from "@/src/design/tokens";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { formatRelativeTime } from "@/src/utils";

type SpaceFileRowProps = {
  entry: SpaceFsEntry;
  onPress: () => void;
  onLongPress?: () => void;
  compact?: boolean;
};

const FILE_TYPE_ICONS: { extensions: string[]; icon: LucideIcon; color: string }[] = [
  { extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "cs", "php", "lua", "sh", "bash", "zsh", "html", "css", "scss", "vue", "svelte"], icon: FileCode, color: FILE_TYPE_COLORS.code },
  { extensions: ["json", "jsonc", "yml", "yaml", "toml", "ini", "env", "cfg", "conf"], icon: Braces, color: FILE_TYPE_COLORS.config },
  { extensions: ["csv", "tsv", "xls", "xlsx"], icon: FileSpreadsheet, color: FILE_TYPE_COLORS.sheet },
  { extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic"], icon: FileImage, color: FILE_TYPE_COLORS.image },
  { extensions: ["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"], icon: Music, color: FILE_TYPE_COLORS.audio },
  { extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v"], icon: Video, color: FILE_TYPE_COLORS.video },
  { extensions: ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"], icon: FileArchive, color: FILE_TYPE_COLORS.archive },
  { extensions: ["sqlite", "db", "sql"], icon: Database, color: FILE_TYPE_COLORS.data },
];

function fileTypeIcon(name: string): { icon: LucideIcon; color: string } {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const match = FILE_TYPE_ICONS.find((type) => type.extensions.includes(extension));
  return { icon: match?.icon ?? FileText, color: match?.color ?? FILE_TYPE_COLORS.other };
}

export function formatSpaceFileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function SpaceFileRow({ entry, onPress, onLongPress, compact = false }: SpaceFileRowProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const showToast = useToast();
  const isDirectory = entry.type === "dir";
  const isSymlink = entry.type === "symlink";
  const icon: IconName = isDirectory ? "folder" : isSymlink ? "external-link" : "file-text";
  const fileType = isDirectory || isSymlink ? null : fileTypeIcon(entry.name);
  const iconColor = isDirectory ? theme.colors.accent : theme.colors.textMuted;
  const detail = isDirectory
    ? t("space.file.folder")
    : isSymlink
      ? t("space.file.symlink")
      : t("space.file.type", { type: entry.mimeType || t("space.file.generic"), size: formatSpaceFileBytes(entry.size) });
  const handleLongPress = onLongPress ?? (() => {
    void Clipboard.setStringAsync(entry.path)
      .then(() => showToast({ title: t("file.pathCopied") }))
      .catch((caught: unknown) => showToast({ title: t("file.copyPathFailed.title"), message: caught instanceof Error ? caught.message : t("file.copyPathFailed.body"), tone: "danger" }));
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDirectory ? t("space.file.openFolder", { name: entry.name }) : t("space.file.openFile", { name: entry.name })}
      onPress={onPress}
      onLongPress={handleLongPress}
      className="min-h-16 flex-row items-center border-b border-border active:bg-surface-pressed"
      style={{ gap: compact ? 10 : 14, paddingHorizontal: compact ? 12 : 16 }}
    >
      {/* File types tint a 12% wash of their own hue; folders and unknown files use tokens. */}
      <View className={`size-9 items-center justify-center rounded-sm ${fileType ? "" : isDirectory ? "bg-accent-soft" : "bg-surface"}`} style={fileType ? { backgroundColor: `${fileType.color}1f` } : null}>
        {fileType ? <fileType.icon size={17} color={fileType.color} /> : <AppIcon name={icon} size={17} color={iconColor} />}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-body font-semibold text-fg">{entry.name}</Text>
        <Text numberOfLines={1} className="mt-0.5 text-caption text-fg-muted">{detail}</Text>
      </View>
      {!compact ? <Text className="text-caption tabular-nums text-fg-faint">{entry.mtimeMs ? formatRelativeTime(new Date(entry.mtimeMs).toISOString()) : ""}</Text> : null}
      {isDirectory ? <AppIcon name="chevron-right" size={16} tone="faint" /> : null}
    </Pressable>
  );
}
