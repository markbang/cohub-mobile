import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, type IconName } from "@/src/ui";
import { traceAction } from "@/src/data/interaction-trace";

/** A grouped settings row: 52 pt, separator inset past the icon, chevron only when it drills in. */
export function SettingsRow({ icon, title, value, detail, children, onPress, disabled = false, danger = false, last = false, external = false }: {
  icon: IconName;
  title: string;
  value?: string;
  detail?: string;
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  last?: boolean;
  /** Opens outside the app: shows an external-link glyph instead of a chevron and reads as a link. */
  external?: boolean;
}) {
  return (
    <PressableOrView onPress={onPress} disabled={disabled} title={title} icon={icon} role={external ? "link" : "button"}>
      <View className="min-w-0 flex-1 flex-row items-center gap-3 py-2" style={{ minHeight: ROW_HEIGHT }}>
        <AppIcon name={icon} size={20} tone={danger ? "danger" : "muted"} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className={`text-body ${danger ? "text-danger" : "text-fg"}`}>{title}</Text>
          {value ? <Text className="text-caption text-fg-muted">{value}</Text> : null}
        </View>
        {detail ? <Text numberOfLines={1} className="shrink text-right text-subhead text-fg-muted" style={{ maxWidth: "45%" }}>{detail}</Text> : null}
        {children}
        {onPress ? <AppIcon name={external ? "external-link" : "chevron-right"} size={16} tone="faint" /> : null}
      </View>
      {last ? null : <View className="absolute bottom-0 bg-border" style={{ left: SEPARATOR_INSET, right: 0, height: StyleSheet.hairlineWidth }} />}
    </PressableOrView>
  );
}

function PressableOrView({ onPress, disabled, title, icon, role, children }: { onPress?: () => void; disabled: boolean; title: string; icon: IconName; role: "button" | "link"; children: ReactNode }) {
  const className = "flex-row items-center bg-surface px-4";
  return onPress
    ? <Pressable accessibilityRole={role} accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { traceAction("settings_row", { icon, role }); onPress(); }} className={`${className} active:bg-surface-pressed disabled:opacity-55`}>{children}</Pressable>
    : <View className={className}>{children}</View>;
}

const ROW_HEIGHT = 52;
/** 16 row padding + 20 icon + 12 gap. */
const SEPARATOR_INSET = 48;
