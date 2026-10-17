import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { AppIcon, type IconName } from "@/src/ui";

export type ListRowStatus = "running" | "failed" | "stopped" | null;

/**
 * The two-line row behind every content list (docs/design-system.md §2.2): identity and time
 * on line 1, context on line 2, state carried by the leading glyph. The separator starts at the
 * text column so leading avatars read as one column.
 */
export function ListRow({ leading, title, titlePrefix, meta, subtitle, trailing, accessory, onPress, onPressIn, onLongPress, accessibilityLabel, accessibilityHint, testID, separator = true, compact = false }: {
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
  testID?: string;
  separator?: boolean;
  compact?: boolean;
}) {
  const body = <>
    {leading ? <View className="justify-center pr-3">{leading}</View> : null}
    <View
      className="min-w-0 flex-1 flex-row items-center gap-2 border-border py-2.5 pr-4"
      style={separator ? styles.separator : null}
    >
      <View className="min-w-0 flex-1 justify-center gap-0.5">
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
  const shell = `flex-row items-stretch pl-4 ${compact ? "min-h-13" : "min-h-16"}`;
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel} testID={testID} className={shell}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPress={onPress}
      onPressIn={() => {
        onPressIn?.();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`${shell} active:bg-surface-pressed`}
    >
      {body}
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
        <View pointerEvents="none" className="absolute -bottom-1 -right-1 size-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
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

const styles = StyleSheet.create({
  separator: { borderBottomWidth: StyleSheet.hairlineWidth },
});
