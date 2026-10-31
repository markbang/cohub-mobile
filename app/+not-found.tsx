import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";
import { Mascot } from "@/src/ui";
import { useTranslation } from "@/src/i18n";

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return <>
    <Stack.Screen options={{ title: t("route.notFound") }} />
    <View className="flex-1 items-center justify-center p-6 bg-background">
      <Mascot size={92} mood="worried" />
      <Text className="text-headline font-semibold text-fg mt-4">{t("notFound.heading")}</Text>
      <Link href="/(tabs)" style={{ marginTop: 16 }}><Text className="text-body font-semibold text-accent">{t("notFound.back")}</Text></Link>
    </View>
  </>;
}
