import type { RefObject } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { mentionDisplayText } from "@/src/data/space-mentions";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { IconButton } from "@/src/ui";

export function QueuedFollowupRow({ preview: rawPreview, pending, hidden = false, surfaceHidden = false, rowRef, onSteer, onCancel }: {
  preview: string;
  pending: boolean;
  hidden?: boolean;
  surfaceHidden?: boolean;
  rowRef?: RefObject<View | null>;
  onSteer?: () => void;
  onCancel?: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const preview = mentionDisplayText(rawPreview);
  return <Animated.View ref={rowRef} collapsable={false} testID="chat-queue-item" pointerEvents={hidden ? "none" : "auto"} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"} className={surfaceHidden ? "" : "bg-surface"} style={[styles.row, { opacity: hidden ? 0 : 1 }]}>
    <Text numberOfLines={1} className="text-caption text-fg flex-1 min-w-0">{preview}</Text>
    {pending ? <ActivityIndicator accessibilityLabel={t("chat.sending")} size="small" color={theme.colors.accent} /> : <>
      <Pressable accessibilityRole="button" accessibilityLabel={t("chat.steerAccessibility", { preview })} onPress={onSteer} className="min-h-11 justify-center rounded-sm bg-accent-soft px-2 active:bg-surface-pressed"><Text className="text-caption font-semibold text-accent">{t("chat.steerNow")}</Text></Pressable>
      <IconButton name="x" label={t("chat.cancelFollowup", { preview })} onPress={() => onCancel?.()} />
    </>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  row: { width: "100%", minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 },
});
