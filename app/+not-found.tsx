import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
import { AppIcon } from "@/src/ui";
import { useTranslation } from "@/src/i18n";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return <>
    <Stack.Screen options={{ title: t("route.notFound") }} />
    <View className="flex-1 items-center justify-center p-6 bg-background">
      <View className="w-14 h-14 rounded-lg items-center justify-center bg-surface-raised"><AppIcon name="compass" size={25} tone="muted" /></View>
      <Text className="text-headline font-semibold text-fg mt-4">{t("notFound.heading")}</Text>
      <Link href="/(tabs)" style={{ marginTop: 16 }}><Text className="text-body font-semibold text-accent">{t("notFound.back")}</Text></Link>
    </View>
  </>;
}
