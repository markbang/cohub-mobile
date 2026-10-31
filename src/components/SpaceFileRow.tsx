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
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import type { NativeMenuAction } from "@/src/components/NativeMenu";
import { AppIcon, type IconName } from "@/src/ui";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { formatRelativeTime } from "@/src/utils";

type SpaceFileRowProps = {
  entry: SpaceFsEntry;
  onPress: () => void;
  onLongPress?: () => void;
  /** The iOS context menu's items; without them it offers Copy path, as the long press does elsewhere. */
  menuActions?: readonly NativeMenuAction[];
  compact?: boolean;
};

const FILE_TYPE_ICONS: { extensions: string[]; icon: LucideIcon }[] = [
  { extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "cs", "php", "lua", "sh", "bash", "zsh", "html", "css", "scss", "vue", "svelte"], icon: FileCode },
  { extensions: ["json", "jsonc", "yml", "yaml", "toml", "ini", "env", "cfg", "conf"], icon: Braces },
  { extensions: ["csv", "tsv", "xls", "xlsx"], icon: FileSpreadsheet },
  { extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic"], icon: FileImage },
  { extensions: ["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"], icon: Music },
  { extensions: ["mp4", "mov", "webm", "avi", "mkv", "m4v"], icon: Video },
  { extensions: ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"], icon: FileArchive },
  { extensions: ["sqlite", "db", "sql"], icon: Database },
];

function fileTypeIcon(name: string): { icon: LucideIcon } {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const match = FILE_TYPE_ICONS.find((type) => type.extensions.includes(extension));
  return { icon: match?.icon ?? FileText };
}

export function formatSpaceFileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function SpaceFileRow({ entry, onPress, onLongPress, menuActions, compact = false }: SpaceFileRowProps) {
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
  const copyPath = () => {
    void Clipboard.setStringAsync(entry.path)
      .then(() => showToast({ title: t("file.pathCopied"), tone: "success" }))
      .catch((caught: unknown) => showToast({ title: t("file.copyPathFailed.title"), message: caught instanceof Error ? caught.message : t("file.copyPathFailed.body"), tone: "danger" }));
  };
  // iOS lifts the row into the system context menu, which owns the hold; the no-op keeps it from becoming a press.
  const handleLongPress = nativeContextMenus ? () => undefined : onLongPress ?? copyPath;

  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDirectory ? t("space.file.openFolder", { name: entry.name }) : t("space.file.openFile", { name: entry.name })}
      onPress={onPress}
      onLongPress={handleLongPress}
      className="min-h-16 flex-row items-center border-b border-border active:bg-surface-pressed"
      style={{ gap: compact ? 12 : 16, paddingHorizontal: compact ? 12 : 16 }}
    >
      {/* The glyph's shape tells the file type; only folders, the navigable rows, take the accent. */}
      <View className={`size-9 items-center justify-center rounded-sm ${isDirectory ? "bg-accent-soft" : "bg-surface-raised"}`}>
        {fileType ? <fileType.icon size={18} color={theme.colors.textMuted} strokeWidth={1.9} /> : <AppIcon name={icon} size={18} color={iconColor} />}
      </View>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-body font-semibold text-fg">{entry.name}</Text>
        <Text numberOfLines={1} className="mt-0.5 text-caption text-fg-muted">{detail}</Text>
      </View>
      {!compact ? <Text className="text-caption tabular-nums text-fg-faint">{entry.mtimeMs ? formatRelativeTime(new Date(entry.mtimeMs).toISOString()) : ""}</Text> : null}
      {isDirectory ? <AppIcon name="chevron-right" size={16} tone="faint" /> : null}
    </Pressable>
  );
  if (!nativeContextMenus) return row;
  return <NativeContextMenu menu="space-file-row" actions={menuActions ?? [{ icon: "copy", title: t("file.copyPath"), onPress: copyPath }]}>{row}</NativeContextMenu>;
}
