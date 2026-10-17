import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TokenDay } from "@/src/data/activity";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

export function TokenHeatmap({ days }: { days: TokenDay[] }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const day = days.find((item) => item.date === selected) ?? days.at(-1);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const opacity = [0, 0.25, 0.5, 0.75, 1];
  return <View className="px-4 gap-2">
    <View className="flex-row gap-1">
      {weeks.map((week) => <View key={week[0].date} className="flex-1 gap-1">
        {Array.from({ length: 7 }, (_, index) => {
          const item = week[index];
          return <Pressable key={index} disabled={!item} accessibilityRole="button" accessibilityLabel={item ? `${item.date}: ${item.tokens.toLocaleString()} tokens` : undefined} accessibilityState={{ selected: item?.date === day?.date }} onPress={() => setSelected(item.date)} style={({ pressed }) => ({ aspectRatio: 1, borderRadius: 3, overflow: "hidden", backgroundColor: item ? theme.colors.surfaceRaised : "transparent", borderWidth: 1, borderColor: item?.date === day?.date ? theme.colors.text : "transparent", opacity: pressed ? 0.6 : 1 })}>
            {item && item.level > 0 ? <View style={{ flex: 1, backgroundColor: theme.colors.success, opacity: opacity[item.level] }} /> : null}
          </Pressable>;
        })}
      </View>)}
    </View>
    <View className="flex-row justify-between">
      <Text className="text-micro font-semibold text-fg-muted">{days[0]?.date}</Text>
      <Text className="text-micro font-semibold text-fg-muted">{days.at(-1)?.date}</Text>
    </View>
    <Text accessibilityLiveRegion="polite" className="text-caption text-fg min-h-5">{day ? `${day.date} · ${day.tokens.toLocaleString()} tokens` : ""}</Text>
    <View className="flex-row items-center justify-end gap-1">
      <Text className="text-micro font-semibold text-fg-muted">{t("activity.heatmap.less")}</Text>
      {opacity.map((value, index) => <View key={index} className="w-2 h-2 rounded-xs overflow-hidden bg-surface-raised"><View style={{ flex: 1, backgroundColor: theme.colors.success, opacity: value }} /></View>)}
      <Text className="text-micro font-semibold text-fg-muted">{t("activity.heatmap.more")}</Text>
    </View>
  </View>;
}
