import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, BrandMark, Loader, Segmented } from "@/src/ui";
import type { CohubEnvironment } from "@/src/config";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

const ENVIRONMENT_OPTIONS: { value: CohubEnvironment; labelKey: TranslationKey }[] = [
  { value: "prod", labelKey: "auth.environment.prod" },
  { value: "dev", labelKey: "auth.environment.dev" },
];

export function AuthScreen({ onSignIn, loading, error, environment, onSelectEnvironment }: {
  onSignIn: () => Promise<void>;
  loading: boolean;
  error: string | null;
  environment: CohubEnvironment;
  onSelectEnvironment: (environment: CohubEnvironment) => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 justify-between bg-background px-5" style={{ paddingTop: insets.top + 30, paddingBottom: insets.bottom + 24 }}>
      <View className="items-center">
        <BrandMark size={54} />
        <Text className="text-display font-bold text-fg mt-5">Cohub</Text>
        <Text className="text-body text-fg-muted mt-2 text-center max-w-72">{t("auth.tagline")}</Text>
      </View>

      <View className="w-full max-w-105 self-center">
        <View className="flex-row items-center gap-3 border rounded-md p-4 border-border bg-surface">
          <View className="w-10 h-10 rounded-md items-center justify-center bg-accent-soft"><AppIcon name="sparkles" size={20} tone="accent" /></View>
          <View className="flex-1">
            <Text className="text-body font-semibold text-fg">{t("auth.feature.context.title")}</Text>
            <Text className="text-caption text-fg-muted mt-1">{t("auth.feature.context.body")}</Text>
          </View>
        </View>
        <View className="flex-row items-center gap-3 border rounded-md p-4 border-border bg-surface mt-2">
          <View className="w-10 h-10 rounded-md items-center justify-center bg-info-soft"><AppIcon name="sync" size={20} tone="info" /></View>
          <View className="flex-1">
            <Text className="text-body font-semibold text-fg">{t("auth.feature.sync.title")}</Text>
            <Text className="text-caption text-fg-muted mt-1">{t("auth.feature.sync.body")}</Text>
          </View>
        </View>
      </View>

      <View className="w-full max-w-105 self-center">
        <View className="mb-3">
          <Text className="text-micro font-semibold text-fg-faint mb-2">{t("auth.environment")}</Text>
          <Segmented
            disabled={loading}
            value={environment}
            onChange={onSelectEnvironment}
            options={ENVIRONMENT_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
          />
        </View>
        {error ? <View className="flex-row items-center gap-2 border rounded-md p-3 mb-2 bg-danger-soft border-danger"><AppIcon name="alert" size={16} tone="danger" /><Text className="text-caption text-danger flex-1">{error}</Text></View> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("auth.continue")}
          disabled={loading}
          onPress={() => void onSignIn()}
          className={`min-h-13 flex-row items-center justify-center gap-2 rounded-sm bg-accent active:bg-accent-pressed ${loading ? "opacity-65" : ""}`}
        >
          {loading ? <Loader color={theme.colors.accentText} /> : <AppIcon name="arrow-right" size={19} tone="onAccent" />}
          <Text className="text-body font-semibold text-on-accent">{loading ? t("auth.opening") : t("auth.continue")}</Text>
        </Pressable>
        <Text className="text-micro font-semibold text-fg-faint text-center mt-3">{t("auth.secure")}</Text>
      </View>
    </View>
  );
}
