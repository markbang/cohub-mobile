import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, Mascot, PrimaryButton, Segmented } from "@/src/ui";
import { ROUNDED_TITLE } from "@/src/ui/rounded";
import type { CohubEnvironment } from "@/src/config";
import { BRAND } from "@/src/design/brand";
import { useTranslation, type TranslationKey } from "@/src/i18n";

const ENVIRONMENT_OPTIONS: { value: CohubEnvironment; labelKey: TranslationKey }[] = [
  { value: "prod", labelKey: "auth.environment.prod" },
  { value: "dev", labelKey: "auth.environment.dev" },
];

const INK = { color: BRAND.ink };

export function AuthScreen({ onSignIn, loading, error, environment, onSelectEnvironment }: {
  onSignIn: () => Promise<void>;
  loading: boolean;
  error: string | null;
  environment: CohubEnvironment;
  onSelectEnvironment: (environment: CohubEnvironment) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <View className="flex-1 bg-surface">
      {/* The icon, opened up to fill the screen: ink reads on every stop of its gradient, in both themes. */}
      <StatusBar style="dark" />
      <LinearGradient colors={BRAND.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, paddingTop: insets.top, paddingBottom: 28 }}>
        <View className="min-h-0 flex-1 items-center justify-center px-6">
          <Mascot size={Math.min(148, height * 0.19)} blink />
          <Text style={[ROUNDED_TITLE, INK]} className="mt-4 text-display font-bold">Cohub</Text>
          <Text style={INK} className="mt-1 max-w-72 text-center text-body">{t("auth.tagline")}</Text>
        </View>
      </LinearGradient>

      <View className="-mt-7 rounded-t-lg bg-surface px-5 pt-6" style={{ paddingBottom: insets.bottom + 12, borderCurve: "continuous" }}>
        <View className="w-full max-w-105 gap-4 self-center">
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-sm bg-accent-soft" style={{ borderCurve: "continuous" }}><AppIcon name="sparkles" size={20} tone="accent" /></View>
            <View className="flex-1">
              <Text className="text-body font-semibold text-fg">{t("auth.feature.context.title")}</Text>
              <Text className="text-caption text-fg-muted">{t("auth.feature.context.body")}</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-sm bg-accent-soft" style={{ borderCurve: "continuous" }}><AppIcon name="sync" size={20} tone="accent" /></View>
            <View className="flex-1">
              <Text className="text-body font-semibold text-fg">{t("auth.feature.sync.title")}</Text>
              <Text className="text-caption text-fg-muted">{t("auth.feature.sync.body")}</Text>
            </View>
          </View>
          <View>
            <Text className="mb-2 text-micro font-semibold text-fg-faint">{t("auth.environment")}</Text>
            <Segmented
              disabled={loading}
              value={environment}
              onChange={onSelectEnvironment}
              options={ENVIRONMENT_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            />
          </View>
          {error ? <View className="flex-row items-center gap-2 rounded-sm bg-danger-soft p-3" style={{ borderCurve: "continuous" }}><AppIcon name="alert" size={16} tone="danger" /><Text className="flex-1 text-caption text-danger">{error}</Text></View> : null}
          <View>
            <PrimaryButton label={loading ? t("auth.opening") : t("auth.continue")} icon="arrow-right" loading={loading} onPress={() => void onSignIn()} />
            <Text className="mt-3 text-center text-micro font-semibold text-fg-faint">{t("auth.secure")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
