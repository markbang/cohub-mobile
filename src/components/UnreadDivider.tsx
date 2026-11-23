import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "@/src/i18n";

/** The New Messages divider: a hairline either side of the label, above the first Turn this device has not read. */
export function UnreadDivider() {
  const { t } = useTranslation();
  const rule = <View className="flex-1 bg-accent opacity-50" style={{ height: StyleSheet.hairlineWidth }} />;
  return <View className="flex-row items-center gap-2 px-4 py-2">
    {rule}
    <Text className="text-caption font-semibold text-accent">{t("chat.newMessages")}</Text>
    {rule}
  </View>;
}
