import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type GestureResponderEvent } from "react-native";
import { AppIcon, type IconName } from "@/src/ui";
export { LIST_AVATAR_SIZE } from "@/src/design/tokens";

export type ListRowStatus = "running" | "failed" | "stopped" | null;

/** Where a row sits in a run of rows that read as one item (a fork tree); only the run's end draws a separator. */
export type ListRowGroup = "single" | "first" | "middle" | "last";

/** 16 row padding + the leading avatar + its 14 gap. */
const FLAT_SEPARATOR_INSET = 16 + 46 + 14;

/**
 * The two-line, 72pt row behind every content list (docs/design-system.md §2.2): identity and time
 * on line 1, context on line 2, state carried by the leading glyph. Lists are flat on both platforms, as in
 * Mail and Messages: full-width rows with a hairline inset past the avatar.
 */
export function ListRow({ leading, title, titlePrefix, meta, subtitle, trailing, accessory, onPress, onPressIn, onLongPress, accessibilityLabel, accessibilityHint, accessibilityActions, onAccessibilityAction, testID, group = "single", compact = false }: {
  leading?: ReactNode;
  title: string;
  titlePrefix?: ReactNode;
  meta?: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  accessory?: ReactNode;
  /** Omit for an informational row; it then renders without press feedback. */
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Named actions for gestures a screen reader cannot perform, such as a long-press menu. */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  testID?: string;
  group?: ListRowGroup;
  compact?: boolean;
}) {
  const body = <>
    {leading ? <View className="justify-center pr-3.5">{leading}</View> : null}
    <View className="min-w-0 flex-1 flex-row items-center gap-2 py-3 pr-4">
      <View className="min-w-0 flex-1 justify-center gap-1">
        <View className="flex-row items-center gap-1.5">
          {titlePrefix}
          <Text numberOfLines={1} className="min-w-0 flex-1 text-body font-semibold text-fg">{title}</Text>
          {meta ? <Text className="text-caption tabular-nums text-fg-faint">{meta}</Text> : null}
        </View>
        {subtitle || trailing ? <View className="flex-row items-center gap-1.5">
          {typeof subtitle === "string"
            ? <Text numberOfLines={1} className="min-w-0 flex-1 text-subhead text-fg-muted">{subtitle}</Text>
            : <View className="min-w-0 flex-1">{subtitle}</View>}
          {trailing}
        </View> : null}
      </View>
      {accessory}
    </View>
  </>;
  const shell = `flex-row items-stretch pl-4 ${compact ? "min-h-14" : "min-h-18"}`;
  const separator = group === "single" || group === "last" ? <View className="absolute bottom-0 right-0 bg-border" style={{ left: leading ? FLAT_SEPARATOR_INSET : 16, height: StyleSheet.hairlineWidth }} /> : null;
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel} accessibilityActions={accessibilityActions} onAccessibilityAction={onAccessibilityAction} testID={testID} className={shell} style={CONTINUOUS}>{body}{separator}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      testID={testID}
      onPress={onPress}
      // Rows answer with a background highlight, not a haptic: a touch that starts a scroll lands here too.
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`${shell} active:bg-surface-pressed`}
      style={CONTINUOUS}
    >
      {body}
      {separator}
    </Pressable>
  );
}

/** Running is an accent ring; failed and stopped are corner badges with distinct glyphs, so color is never the only cue. */
export function AvatarStatus({ status, size, children }: { status: ListRowStatus; size: number; children: ReactNode }) {
  return (
    <View style={{ width: size, height: size }}>
      {children}
      {status === "running" ? <View pointerEvents="none" className="absolute border-2 border-accent" style={{ top: -3, left: -3, width: size + 6, height: size + 6, borderRadius: (size + 6) * 0.3, borderCurve: "continuous" }} /> : null}
      {status === "failed" || status === "stopped" ? (
        <View pointerEvents="none" className="absolute -bottom-1 -right-1 size-4.5 items-center justify-center rounded-full border-2 border-surface bg-surface">
          <AppIcon name={status === "failed" ? "alert" : "stop"} size={13} tone={status === "failed" ? "danger" : "muted"} strokeWidth={2.4} />
        </View>
      ) : null}
    </View>
  );
}

/** An icon and a tabular value standing in for a labelled count or duration. */
export function Meta({ icon, value, label, tone = "muted" }: { icon: IconName; value: string; label: string; tone?: "muted" | "faint" | "accent" }) {
  return (
    <View accessible accessibilityLabel={label} className="flex-row items-center gap-1">
      <AppIcon name={icon} size={13} tone={tone} />
      <Text className={`text-caption tabular-nums ${tone === "accent" ? "text-accent" : tone === "faint" ? "text-fg-faint" : "text-fg-muted"}`}>{value}</Text>
    </View>
  );
}

/** A small label chip; at most two per row. */
export function Tag({ label, tone = "accent" }: { label: string; tone?: "accent" | "info" }) {
  return (
    <View className={tone === "info" ? "max-w-24 rounded-xs bg-info-soft px-1.5 py-px" : "max-w-24 rounded-xs bg-accent-soft px-1.5 py-px"}>
      <Text numberOfLines={1} className={tone === "info" ? "text-micro font-semibold text-info" : "text-micro font-semibold text-accent"}>{label}</Text>
    </View>
  );
}

const CONTINUOUS = { borderCurve: "continuous" } as const;
