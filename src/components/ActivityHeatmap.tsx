import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import type { SpaceUsageHourlyStat } from "@neta-art/cohub";
import { colorWithOpacity, useAppTheme } from "@/src/theme";
import { localDateKey } from "@/src/data/activity";
import { Bone, Skeleton } from "@/src/ui/Skeleton";
import { useTranslation } from "@/src/i18n";

type HeatmapProps = {
  hourly: SpaceUsageHourlyStat[];
  days: number;
};

const LEGEND_CELL_SIZE = 11;
const CELL_GAP = 3;
const DAYS_IN_WEEK = 7;

export const ActivityHeatmap = memo(function ActivityHeatmap({ hourly, days }: HeatmapProps) {
  const theme = useAppTheme();
  const { t, locale } = useTranslation();

  const { grid, maxValue, weeks } = useMemo(() => {
    // Aggregate hourly data to daily totals
    const dailyMap = new Map<string, number>();
    
    for (const stat of hourly) {
      const date = new Date(stat.bucketStartAt);
      const dateKey = localDateKey(date);
      const current = dailyMap.get(dateKey) || 0;
      dailyMap.set(dateKey, current + stat.totalTokens);
    }

    // Calculate start date (today - days)
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days + 1);
    const rangeStart = new Date(startDate);

    // Adjust to start on Sunday
    const startDay = startDate.getDay();
    if (startDay !== 0) {
      startDate.setDate(startDate.getDate() - startDay);
    }

    // Build grid data
    const grid: { value: number; date: Date; isEmpty: boolean }[] = [];
    let maxValue = 0;
    const currentDate = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate total cells needed (round up to full weeks)
    const totalDays = days + rangeStart.getDay();
    const totalWeeks = Math.ceil(totalDays / DAYS_IN_WEEK);

    for (let i = 0; i < totalWeeks * DAYS_IN_WEEK; i++) {
      const dateKey = localDateKey(currentDate);
      const value = dailyMap.get(dateKey) || 0;
      const isEmpty = currentDate < rangeStart || currentDate > today;
      
      if (value > maxValue && !isEmpty) maxValue = value;
      grid.push({ value, date: new Date(currentDate), isEmpty });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { grid, maxValue, weeks: totalWeeks };
  }, [hourly, days]);

  const getColor = (intensity: number, isEmpty = false) => {
    if (isEmpty) return "transparent";
    if (intensity === 0) return theme.colors.border;
    
    if (intensity < 0.25) return colorWithOpacity(theme.colors.accent, 0.2);
    if (intensity < 0.5) return colorWithOpacity(theme.colors.accent, 0.4);
    if (intensity < 0.75) return colorWithOpacity(theme.colors.accent, 0.6);
    if (intensity < 0.9) return colorWithOpacity(theme.colors.accent, 0.8);
    return theme.colors.accent;
  };

  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const weekdays = Array.from({ length: DAYS_IN_WEEK }, (_, day) => weekdayFormatter.format(new Date(2024, 0, 7 + day)));
  const cellColor = (cell: (typeof grid)[number]) => getColor(maxValue > 0 ? cell.value / maxValue : 0, cell.isEmpty);

  return (
    <View className="self-stretch gap-2">
      <Text className="text-caption text-fg-muted">
        {t("activity.heatmap.range", { days })}
      </Text>

      {/* A short range reads left-to-right; stretching one week-column would make a seven-screen-tall grid. */}
      {days <= DAYS_IN_WEEK ? <View testID="activity-heatmap-week" style={{ flexDirection: "row", gap: CELL_GAP }}>
        {grid.filter((cell) => !cell.isEmpty).map((cell) => <View key={localDateKey(cell.date)} className="flex-1 min-w-0 gap-1">
          <Text numberOfLines={1} className="text-micro font-semibold text-fg-faint text-center">{weekdays[cell.date.getDay()]}</Text>
          <View accessible accessibilityLabel={`${localDateKey(cell.date)}: ${cell.value.toLocaleString()} tokens`} style={{ aspectRatio: 1, borderRadius: 3, backgroundColor: cellColor(cell) }} />
        </View>)}
      </View> : <View className="flex-row gap-2">
        <View style={{ gap: CELL_GAP }}>
          {weekdays.map((label, index) => <View key={index} className="flex-1 justify-center">
            <Text numberOfLines={1} className="text-micro font-semibold text-fg-faint">{index % 2 === 1 ? label : ""}</Text>
          </View>)}
        </View>
        <View testID="activity-heatmap-grid" style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: CELL_GAP }}>
          {Array.from({ length: weeks }, (_, weekIdx) => <View key={weekIdx} style={{ flex: 1, minWidth: 0, gap: CELL_GAP }}>
            {grid.slice(weekIdx * DAYS_IN_WEEK, (weekIdx + 1) * DAYS_IN_WEEK).map((cell) => <View
              key={localDateKey(cell.date)}
              accessible={!cell.isEmpty}
              accessibilityLabel={cell.isEmpty ? undefined : `${localDateKey(cell.date)}: ${cell.value.toLocaleString()} tokens`}
              style={{ aspectRatio: 1, borderRadius: 3, backgroundColor: cellColor(cell) }}
            />)}
          </View>)}
        </View>
      </View>}

      {/* Legend */}
      <View className="flex-row items-center justify-end gap-1">
        <Text className="text-micro font-semibold text-fg-faint">{t("activity.heatmap.less")}</Text>
        <View className="flex-row gap-0.5">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((intensity) => (
            <View
              key={intensity}
              style={{
                width: LEGEND_CELL_SIZE,
                height: LEGEND_CELL_SIZE,
                borderRadius: 3,
                backgroundColor: getColor(intensity),
              }}
            />
          ))}
        </View>
        <Text className="text-micro font-semibold text-fg-faint">{t("activity.heatmap.more")}</Text>
      </View>
    </View>
  );
});

export function ActivityHeatmapSkeleton({ weeks = 13 }: { weeks?: number }) {
  return (
    <Skeleton className="mx-4 gap-2 rounded-md bg-surface p-4" style={{ borderCurve: "continuous" }}>
      <View className="justify-center" style={{ height: 18 }}><Bone width="40%" height={9} /></View>
      <View className="flex-row gap-2">
        <View style={{ width: 24 }} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: CELL_GAP }}>
          {Array.from({ length: weeks }, (_, week) => <View key={week} style={{ flex: 1, minWidth: 0, gap: CELL_GAP }}>
            {Array.from({ length: DAYS_IN_WEEK }, (_, day) => <View key={day} className="bg-surface-raised" style={{ aspectRatio: 1, borderRadius: 3 }} />)}
          </View>)}
        </View>
      </View>
      <View className="flex-row justify-end" style={{ height: 14 }}><Bone width={120} height={9} /></View>
    </Skeleton>
  );
}
