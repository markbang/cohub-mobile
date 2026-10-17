import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TokenDay } from "@/src/data/activity";
import { useTranslation } from "@/src/i18n";

export function TokenHeatmap({ days }: { days: TokenDay[] }) {
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
          return <Pressable key={index} disabled={!item} accessibilityRole="button" accessibilityLabel={item ? `${item.date}: ${item.tokens.toLocaleString()} tokens` : undefined} accessibilityState={{ selected: item?.date === day?.date }} onPress={() => setSelected(item.date)} className={`overflow-hidden rounded-xs border active:opacity-60 ${item ? "bg-surface-raised" : ""} ${item?.date === day?.date ? "border-fg" : "border-transparent"}`} style={{ aspectRatio: 1 }}>
            {item && item.level > 0 ? <View className="flex-1 bg-success" style={{ opacity: opacity[item.level] }} /> : null}
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
      {opacity.map((value, index) => <View key={index} className="w-2 h-2 rounded-xs overflow-hidden bg-surface-raised"><View className="flex-1 bg-success" style={{ opacity: value }} /></View>)}
      <Text className="text-micro font-semibold text-fg-muted">{t("activity.heatmap.more")}</Text>
    </View>
  </View>;
}
