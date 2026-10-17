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
        <View className={`min-h-8 flex-row items-center justify-center gap-1 overflow-hidden rounded-full px-3 ${pressed ? "bg-surface-pressed" : selected ? "bg-accent-soft" : ""}`}>
          {icon ? <AppIcon name={icon} size={13} tone={selected ? "accent" : "muted"} /> : null}
          <Text className={`text-subhead font-semibold ${selected ? "text-accent" : "text-fg-muted"}`}>{label}</Text>
          {suffix ? <Text className={`text-caption tabular-nums ${selected ? "text-accent" : "text-fg-faint"}`}>{suffix}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}
