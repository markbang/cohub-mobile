import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { slashCommandLabel, type SlashCommandItem } from "@/src/data/slash-commands";
import type { SlashCommandMenuState } from "@/src/data/use-composer-slash";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { IconButton } from "@/src/ui";
import { PopoverSurface } from "@/src/ui/PopoverSurface";

/** Non-modal so the composer keeps focus and the keyboard while the query is typed. */
export function SlashCommandMenu({ menu, onSelect, onDismiss, style }: { menu: SlashCommandMenuState; onSelect: (item: SlashCommandItem) => void; onDismiss: () => void; style?: ViewStyle }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const status = menu.query.trim()
    ? t("slash.count", { count: menu.items.length })
    : menu.failed
      ? t("slash.unavailable")
      : menu.loading
        ? t("slash.loading")
        : t("slash.hint");
  // Grows up out of the composer it sits on.
  return <PopoverSurface origin={["50%", "100%", 0]} fromScale={0.92} testID="slash-command-menu" accessibilityLabel={t("slash.title")} className="overflow-hidden rounded-lg border-border bg-surface shadow-float" style={[{ borderWidth: StyleSheet.hairlineWidth, borderCurve: "continuous" }, style]}>
    <View className="flex-row items-center gap-2 pl-4 pr-1 py-1">
      <View className="flex-1 min-w-0">
        <Text className="text-body font-semibold text-fg">{t("slash.title")}</Text>
        <Text numberOfLines={1} className={`text-micro font-semibold ${menu.failed ? "text-danger" : "text-fg-muted"}`}>{status}</Text>
      </View>
      <IconButton name="x" label={t("slash.dismiss")} size={40} onPress={onDismiss} />
    </View>
    {menu.items.length === 0 ? <View className="min-h-22 items-center justify-center px-5 pb-3">
      {menu.loading ? <ActivityIndicator accessibilityLabel={t("slash.loading")} size="small" color={theme.colors.accent} /> : <>
        <Text className="text-body font-semibold text-fg text-center">{t("slash.empty")}</Text>
        <Text className="text-caption text-fg-muted mt-1 text-center">{t("slash.emptyHint")}</Text>
      </>}
    </View> : <ScrollView style={styles.list} keyboardShouldPersistTaps="always" keyboardDismissMode="none">
      {menu.items.map((item) => {
        const label = slashCommandLabel(item);
        return <Pressable key={`${item.kind}:${item.name}`} accessibilityRole="button" accessibilityLabel={t("slash.select", { name: label })} onPress={() => onSelect(item)} className="min-h-13 flex-row items-center gap-3 px-3 py-1.5 active:bg-surface-pressed">
          <View className="size-9 items-center justify-center rounded-sm bg-surface-raised">
            <Text className="text-body font-semibold text-fg-muted">/</Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="text-body font-semibold text-fg">/{label}</Text>
            <Text numberOfLines={1} className="mt-px text-caption text-fg-muted">{item.argumentHint ?? item.description}</Text>
          </View>
        </Pressable>;
      })}
    </ScrollView>}
  </PopoverSurface>;
}

const styles = StyleSheet.create({
  list: { maxHeight: 232, flexGrow: 0 },
});
