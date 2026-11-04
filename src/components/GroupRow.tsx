import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, type IconName } from "@/src/ui";

/** Matches `SettingsRow`: 52 pt rows, a 30 pt leading slot, separators inset past it (16 + 30 + 12). */
const ROW_HEIGHT = 52;
export const GROUP_TILE = 30;
const TILE_STYLE = { width: GROUP_TILE, height: GROUP_TILE, borderCurve: "continuous" } as const;
const SEPARATOR_INSET = 58;

/** The neutral glyph tile `SettingsRow` uses, so custom rows line up with it. */
export function GroupTile({ icon, accent = false, children }: { icon?: IconName; accent?: boolean; children?: ReactNode }) {
  return <View className="items-center justify-center rounded-xs bg-surface-raised" style={TILE_STYLE}>{icon ? <AppIcon name={icon} size={18} tone={accent ? "accent" : "secondary"} /> : children}</View>;
}

/** A leading slot without a tile, for a spinner or a rank, aligned with tiled rows. */
export function GroupSlot({ children }: { children: ReactNode }) {
  return <View className="items-center justify-center" style={TILE_STYLE}>{children}</View>;
}

/**
 * A row inside `SettingsGroup` for content `SettingsRow` cannot carry: an avatar or custom leading,
 * a trailing control, or a third line. Its separator lines up with `SettingsRow`.
 */
export function GroupRow({ leading, title, titleClassName = "text-fg", subtitle, detail, middleEllipsis = false, trailing, onPress, accessibilityLabel, role = "button", disabled = false, last = false }: {
  leading: ReactNode;
  title: string;
  titleClassName?: string;
  subtitle?: string;
  detail?: string;
  middleEllipsis?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Pressable rows only. */
  accessibilityLabel?: string;
  role?: "button" | "link";
  disabled?: boolean;
  last?: boolean;
}) {
  const body = <>
    <View className="min-w-0 flex-1 flex-row items-center gap-3 py-2" style={{ minHeight: ROW_HEIGHT }}>
      {leading}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className={`text-body ${titleClassName}`}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} ellipsizeMode={middleEllipsis ? "middle" : "tail"} className="text-caption text-fg-muted">{subtitle}</Text> : null}
        {detail ? <Text numberOfLines={2} ellipsizeMode="middle" className="text-micro tabular-nums text-fg-faint">{detail}</Text> : null}
      </View>
      {trailing}
    </View>
    {last ? null : <GroupSeparator />}
  </>;
  return onPress
    ? <Pressable accessibilityRole={role} accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(", ")} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className="flex-row items-center bg-surface px-4 active:bg-surface-pressed disabled:opacity-55">{body}</Pressable>
    // Never `accessible` as a whole: a trailing switch or button must stay its own element.
    : <View className="flex-row items-center bg-surface px-4">{body}</View>;
}

/** `text` insets to the row padding, for rows without a leading tile. */
export function GroupSeparator({ inset = "tile", edge = "bottom" }: { inset?: "tile" | "text"; edge?: "top" | "bottom" }) {
  return <View className={`absolute right-0 bg-border ${edge === "top" ? "top-0" : "bottom-0"}`} style={{ left: inset === "tile" ? SEPARATOR_INSET : 16, height: StyleSheet.hairlineWidth }} />;
}

/** An action row at the end of a group, as iOS Settings closes a list with "Add…". */
export function GroupAddRow({ label, icon = "plus", onPress, disabled = false, last = false }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean; last?: boolean }) {
  return <GroupRow leading={<GroupTile icon={icon} accent />} title={label} titleClassName="text-accent" onPress={onPress} disabled={disabled} last={last} />;
}
