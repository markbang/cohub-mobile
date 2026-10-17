import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getDeviceLocale,
  useTranslation,
  type AppLocale,
  type LocalePreference,
} from "@/src/i18n";
import { AppIcon, SettingsGroup, TopBar, Screen, SectionHeader } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";

type LocaleOption = {
  value: LocalePreference;
  labelKey: "language.option.system" | "language.option.en" | "language.option.zh";
  detailKey:
    | "language.option.systemDetail"
    | "language.option.enDetail"
    | "language.option.zhDetail";
  code: string;
};

const LOCALE_OPTIONS: LocaleOption[] = [
  {
    value: "system",
    labelKey: "language.option.system",
    detailKey: "language.option.systemDetail",
    code: "A",
  },
  {
    value: "en",
    labelKey: "language.option.en",
    detailKey: "language.option.enDetail",
    code: "EN",
  },
  {
    value: "zh",
    labelKey: "language.option.zh",
    detailKey: "language.option.zhDetail",
    code: "中",
  },
];

export function LanguageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Screen>
      <TopBar
        title={t("language.title")}
        onBack={() => router.back()}
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LanguageContent />
      </ScrollView>
    </Screen>
  );
}

export function LanguageContent() {
  const { t, preference, setPreference } = useTranslation();

  return (
    <View testID="language-content">
      <View className="px-4 pt-6 pb-1">
        <Text className="text-title font-bold text-fg">
          {t("language.intro.title")}
        </Text>
        <Text
          className="text-body text-fg-muted mt-1.5 max-w-130"
        >
          {t("language.intro.body")}
        </Text>
      </View>

      <SectionHeader title={t("language.section.app")} />
      {/* A single-choice list: the check mark carries selection, the row keeps its surface. */}
      <SettingsGroup>
        <View accessibilityRole="radiogroup">
          {LOCALE_OPTIONS.map((option, index) => {
            const selected = preference === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={t(option.labelKey)}
                accessibilityState={{ selected, checked: selected }}
                aria-checked={selected}
                onPress={() => void setPreference(option.value)}
                className={`min-h-14 flex-row items-center gap-3 border-border bg-surface px-4 py-2.5 active:bg-surface-pressed`} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth } : null}
              >
                <View className={`size-9 items-center justify-center rounded-sm ${selected ? "bg-accent" : "bg-surface-raised"}`}>
                  <Text className={`text-caption font-semibold ${selected ? "text-on-accent" : "text-fg-muted"}`}>{option.code}</Text>
                </View>
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className={`text-body ${selected ? "font-semibold text-fg" : "text-fg"}`}>{t(option.labelKey)}</Text>
                  <Text numberOfLines={1} className="text-caption text-fg-muted">{t(option.detailKey)}</Text>
                </View>
                {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
              </Pressable>
            );
          })}
        </View>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow icon="globe" title={t("language.device.title")} value={deviceLocaleLabel(getDeviceLocale(), t)} last />
      </SettingsGroup>
    </View>
  );
}

function deviceLocaleLabel(
  deviceLocale: AppLocale,
  t: (key: "language.device.english" | "language.device.chinese") => string,
): string {
  return deviceLocale === "zh"
    ? t("language.device.chinese")
    : t("language.device.english");
}
