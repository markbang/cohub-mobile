import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { AppIcon } from "@/src/ui";

type FilterChipProps = {
  label: string;
  icon?: ComponentProps<typeof AppIcon>["name"];
  /** A count or window shown after the label, e.g. "3" or "24h". */
  suffix?: string;
  /** Spoken in place of the suffix when the short form needs explaining. */
  suffixLabel?: string;
  selected: boolean;
  onPress: () => void;
};

export function FilterChip({ label, icon, suffix, suffixLabel, selected, onPress }: FilterChipProps) {
  // The compact capsule sits inside a full-sized touch target and can grow with text.
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={suffix ? `${label}, ${suffixLabel ?? suffix}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className="min-h-12 min-w-12 justify-center"
    >
      {({ pressed }) => (
        <View className={`min-h-9 flex-row items-center justify-center gap-1.5 overflow-hidden rounded-full px-3.5 py-1 ${selected ? pressed ? "bg-accent-pressed" : "bg-accent" : pressed ? "bg-surface-pressed" : "bg-surface"}`}>
          {icon ? <AppIcon name={icon} size={14} tone={selected ? "onAccent" : "muted"} /> : null}
          <Text className={`text-subhead font-semibold ${selected ? "text-on-accent" : "text-fg-secondary"}`}>{label}</Text>
          {suffix ? <Text className={`text-caption tabular-nums ${selected ? "text-on-accent" : "text-fg-faint"}`}>{suffix}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}
