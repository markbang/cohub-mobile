import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { SpaceMentionMenuState } from "@/src/data/use-composer-mentions";
import type { SpaceMentionSuggestion } from "@/src/data/space-mentions";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { Avatar, IconButton } from "@/src/ui";
import { PopoverSurface } from "@/src/ui/PopoverSurface";
import { displaySpaceName } from "@/src/utils";

/** Non-modal so the composer keeps focus and the keyboard while the query is typed. */
export function SpaceMentionMenu({ menu, onSelect, onDismiss, style }: { menu: SpaceMentionMenuState; onSelect: (item: SpaceMentionSuggestion) => void; onDismiss: () => void; style?: ViewStyle }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const status = !menu.query.trim()
    ? t("mentions.hint")
    : menu.remoteFailed
      ? t("mentions.localOnly")
      : menu.loading
        ? t("mentions.searching")
        : t("mentions.count", { count: menu.items.length });
  // Grows up out of the composer it sits on.
  return <PopoverSurface origin={["50%", "100%", 0]} fromScale={0.92} testID="space-mention-menu" accessibilityLabel={t("mentions.title")} className="overflow-hidden rounded-lg border-border bg-surface shadow-float" style={[{ borderWidth: StyleSheet.hairlineWidth, borderCurve: "continuous" }, style]}>
    <View className="flex-row items-center gap-2 pl-4 pr-1 py-1">
      <View className="flex-1 min-w-0">
        <Text className="text-body font-semibold text-fg">{t("mentions.title")}</Text>
        <Text numberOfLines={1} className={`text-micro font-semibold ${menu.remoteFailed ? "text-danger" : "text-fg-muted"}`}>{status}</Text>
      </View>
      <IconButton name="x" label={t("mentions.dismiss")} size={40} onPress={onDismiss} />
    </View>
    {menu.items.length === 0 ? <View className="min-h-22 items-center justify-center px-5 pb-3">
      {menu.loading ? <ActivityIndicator accessibilityLabel={t("mentions.searching")} size="small" color={theme.colors.accent} /> : <>
        <Text className="text-body font-semibold text-fg text-center">{t("mentions.empty")}</Text>
        <Text className="text-caption text-fg-muted mt-1 text-center">{t("mentions.emptyHint")}</Text>
      </>}
    </View> : <ScrollView style={styles.list} keyboardShouldPersistTaps="always" keyboardDismissMode="none">
      {menu.items.map((item) => {
        const name = item.name ?? displaySpaceName(null);
        return <Pressable key={item.spaceId} accessibilityRole="button" accessibilityLabel={t("mentions.select", { name })} onPress={() => onSelect(item)} className="min-h-13 flex-row items-center gap-3 px-3 py-1.5 active:bg-surface-pressed">
          <Avatar name={name} uri={item.avatarUrl} size={36} />
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="text-body font-semibold text-fg">{name}</Text>
            {item.description ? <Text numberOfLines={1} className="mt-px text-caption text-fg-muted">{item.description}</Text> : null}
          </View>
        </Pressable>;
      })}
    </ScrollView>}
  </PopoverSurface>;
}

const styles = StyleSheet.create({
  list: { maxHeight: 232, flexGrow: 0 },
});
