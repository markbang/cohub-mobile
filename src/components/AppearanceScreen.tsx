import { useRouter } from "expo-router";
import { useState } from "react";
import { useApp } from "@/src/data/context";
import { Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getAppThemeColors,
  setCustomThemeEnabled,
  useCustomThemeState,
  setFontScalePreference,
  setPureBlackPreference,
  setThemePreference,
  type AppTheme,
  type FontScalePreference,
  type ThemePreference,
  useAppTheme,
  useFontScalePreference,
  usePureBlackPreference,
  useThemePreference,
} from "@/src/theme";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { AppIcon, TopBar, Screen, SectionHeader } from "@/src/ui";

const THEME_OPTIONS: { value: ThemePreference; labelKey: TranslationKey; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "system", labelKey: "appearance.theme.system", icon: "monitor" },
  { value: "light", labelKey: "appearance.theme.light", icon: "sun" },
  { value: "dark", labelKey: "appearance.theme.dark", icon: "moon" },
];

const TEXT_SIZE_OPTIONS: { value: FontScalePreference; labelKey: TranslationKey }[] = [
  { value: "small", labelKey: "appearance.textSize.small" },
  { value: "default", labelKey: "appearance.textSize.default" },
  { value: "large", labelKey: "appearance.textSize.large" },
  { value: "xlarge", labelKey: "appearance.textSize.xlarge" },
];

type PreviewColors = Pick<AppTheme["colors"], "background" | "surface" | "surfaceRaised" | "border" | "accent" | "text" | "textMuted">;

export function AppearanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Screen>
      <TopBar title={t("appearance.title")} onBack={() => router.back()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AppearanceContent />
      </ScrollView>
    </Screen>
  );
}

export function AppearanceContent() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const preference = useThemePreference();
  const pureBlack = usePureBlackPreference();
  const fontScalePreference = useFontScalePreference();
  const customTheme = useCustomThemeState();
  const { sync } = useApp();
  const [savingCustomTheme, setSavingCustomTheme] = useState(false);
  const customStatus = customTheme.loading ? "appearance.custom.loading"
    : customTheme.css === null ? "appearance.custom.empty" : "appearance.custom.body";
  const { width } = useWindowDimensions();
  const previewWidth = Math.max(108, Math.min(124, (width - 48) / 3.05));

  return (
    <View testID="appearance-content">
      <View style={styles.intro}>
        <Text className="text-title font-bold text-fg">{t("appearance.intro.title")}</Text>
        <Text className="text-body text-fg-muted mt-1.5 max-w-130">{t("appearance.intro.body")}</Text>
      </View>

      <SectionHeader title={t("appearance.section.theme")} />
      <View style={[styles.segmented, { marginHorizontal: 16, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.background }]}>
        {THEME_OPTIONS.map((option, index) => {
          const selected = preference === option.value;
          const label = t(option.labelKey);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              onPress={() => void setThemePreference(option.value)}
             
              style={({ pressed }) => [
                styles.segment,
                index > 0 ? { borderLeftWidth: 1, borderLeftColor: theme.colors.borderStrong } : null,
                { backgroundColor: selected ? theme.colors.accentSoft : pressed ? theme.colors.surfacePressed : "transparent" },
              ]}
            >
              <AppIcon name={option.icon} size={15} tone={selected ? "accent" : "muted"} />
              <Text className={`text-caption ${selected ? "text-accent" : "text-fg-secondary"}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}
      >
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value;
          const previewMode = option.value === "system" ? theme.mode : option.value;
          return (
            <ThemePreviewCard
              key={option.value}
              label={t(option.labelKey)}
              mode={previewMode}
              pureBlack={pureBlack && previewMode === "dark"}
              selected={selected}
              width={previewWidth}
              onPress={() => void setThemePreference(option.value)}
            />
          );
        })}
      </ScrollView>

      <View style={[styles.group, { marginTop: 16, marginHorizontal: 16, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <View style={[styles.settingRow, { borderBottomColor: theme.colors.border }]}>
          <View style={[styles.settingIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
            <AppIcon name="palette" size={17} tone="muted" />
          </View>
          <View style={styles.settingText}>
            <Text className="text-body font-semibold text-fg">{t("appearance.custom.title")}</Text>
            <Text className="text-caption text-fg-muted mt-0.5">{t(customStatus)}</Text>
          </View>
          <Switch
            accessibilityLabel={t("appearance.custom.title")}
            value={customTheme.enabled}
            disabled={savingCustomTheme}
            onValueChange={(value) => {
              setSavingCustomTheme(true);
              void setCustomThemeEnabled(value).catch(() => undefined).finally(() => setSavingCustomTheme(false));
            }}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.accentBorder }}
            thumbColor={customTheme.enabled ? theme.colors.accent : theme.colors.textFaint}
            ios_backgroundColor={theme.colors.borderStrong}
          />
        </View>
        {customTheme.error || customTheme.warnings.length ? (
          <View className="px-4 pb-3">
            <Text accessibilityRole="alert" selectable className="text-caption text-danger">
              {customTheme.error ?? t("appearance.custom.partial")}
            </Text>
            {customTheme.warnings.length ? <Text selectable className="text-caption text-fg-muted mt-1">{customTheme.warnings.join("\n")}</Text> : null}
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => sync.invalidate("config-theme")} className="p-4 active:bg-surface-pressed">
          <Text className="text-body font-semibold text-accent">{t("appearance.custom.refresh")}</Text>
        </Pressable>
      </View>

      <View style={[styles.group, { marginTop: 16, marginHorizontal: 16, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <View style={[styles.settingRow, { borderBottomColor: theme.colors.border }]}>
          <View style={[styles.settingIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
            <AppIcon name="moon" size={17} tone="muted" />
          </View>
          <View style={styles.settingText}>
            <Text className="text-body font-semibold text-fg">{t("appearance.pureBlack.title")}</Text>
            <Text numberOfLines={2} className="text-caption text-fg-muted mt-0.5">{t("appearance.pureBlack.body")}</Text>
          </View>
          <Switch
            accessibilityLabel={t("appearance.pureBlack.title")}
            value={pureBlack}
            disabled={preference === "light"}
            onValueChange={(value) => void setPureBlackPreference(value)}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.accentBorder }}
            thumbColor={pureBlack ? theme.colors.accent : theme.colors.textFaint}
            ios_backgroundColor={theme.colors.borderStrong}
          />
        </View>
      </View>

      <SectionHeader title={t("appearance.section.textSize")} />
      <View style={[styles.segmented, { marginHorizontal: 16, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.background }]}>
        {TEXT_SIZE_OPTIONS.map((option, index) => {
          const selected = fontScalePreference === option.value;
          const label = t(option.labelKey);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              onPress={() => void setFontScalePreference(option.value)}
              style={({ pressed }) => [
                styles.segment,
                index > 0 ? { borderLeftWidth: 1, borderLeftColor: theme.colors.borderStrong } : null,
                { backgroundColor: selected ? theme.colors.accentSoft : pressed ? theme.colors.surfacePressed : "transparent" },
              ]}
            >
              <Text className={`text-caption ${selected ? "text-accent" : "text-fg-secondary"}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.group, { marginTop: 12, marginHorizontal: 16, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <View style={[styles.settingIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
            <AppIcon name="type" size={17} tone="muted" />
          </View>
          <View style={styles.settingText}>
            <Text className="text-chat text-fg">{t("appearance.textPreview.sample")}</Text>
            <Text className="text-caption text-fg-muted mt-0.5">{t("appearance.textPreview.body")}</Text>
          </View>
        </View>
      </View>

      <SectionHeader title={t("appearance.section.palette")} />
      <View style={[styles.currentPalette, { marginHorizontal: 16, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <View className="flex-row items-center gap-2">
          <View className="w-2 h-2 rounded-xs bg-accent" />
          <Text className="text-body font-semibold text-fg">{preferenceLabel(preference, t)} · {appliedModeLabel(theme.mode, pureBlack, t)}</Text>
        </View>
        <Text className="text-caption text-fg-muted mt-1">{t("appearance.palette.applied")}</Text>
      </View>
    </View>
  );
}

function preferenceLabel(preference: ThemePreference, t: (key: TranslationKey) => string) {
  const option = THEME_OPTIONS.find((item) => item.value === preference);
  return t(option?.labelKey ?? "appearance.theme.system");
}

function appliedModeLabel(mode: AppTheme["mode"], pureBlack: boolean, t: (key: TranslationKey) => string) {
  if (mode === "dark") return pureBlack ? t("appearance.mode.pureBlack") : t("appearance.mode.dark");
  return t("appearance.mode.light");
}

function ThemePreviewCard({ label, mode, pureBlack, selected, width, onPress }: { label: string; mode: "light" | "dark"; pureBlack: boolean; selected: boolean; width: number; onPress: () => void }) {
  const theme = useAppTheme();
  const colors: PreviewColors = getAppThemeColors(mode, pureBlack);
  return (
    <View style={{ width }}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected, checked: selected }}
        aria-checked={selected}
        onPress={onPress}
       
        style={({ pressed }) => ({
          width,
          aspectRatio: 0.62,
          padding: 4,
          borderRadius: 17,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? theme.colors.accent : colors.border,
          backgroundColor: colors.background,
          opacity: pressed ? 0.82 : 1,
        })}
      >
        <View style={{ flex: 1, borderRadius: 12, overflow: "hidden", backgroundColor: colors.background }}>
          <View style={{ height: 30, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface }}>
            <View style={{ width: "54%", height: 5, borderRadius: 3, backgroundColor: colors.text, opacity: 0.85 }} />
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: selected ? colors.accent : colors.surfaceRaised }} />
          </View>
          <View className="flex-1 p-2">
            <View style={{ width: "72%", height: 5, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.8 }} />
            <View style={{ width: "48%", height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6 }} />
            <View style={{ width: "58%", height: 34, borderRadius: 7, backgroundColor: colors.surfaceRaised, marginTop: 13 }} />
          </View>
          <View style={{ height: 30, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent }} />
            <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.textMuted, opacity: 0.65 }} />
          </View>
        </View>
      </Pressable>
      <Text numberOfLines={1} className="text-caption text-fg-secondary text-center mt-2">{label}</Text>
    </View>
  );
}

const styles = {
  intro: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 4 },
  segmented: { minHeight: 48, borderWidth: 1, borderRadius: 24, flexDirection: "row" as const, overflow: "hidden" as const },
  segment: { flex: 1, minHeight: 46, paddingHorizontal: 8, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6 },
  group: { borderWidth: 1, borderRadius: 14, overflow: "hidden" as const },
  settingRow: { minHeight: 72, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row" as const, alignItems: "center" as const, gap: 11, borderBottomWidth: 1 },
  settingIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const },
  settingText: { flex: 1, minWidth: 0 },
  currentPalette: { padding: 14, borderWidth: 1, borderRadius: 13 },
} satisfies Record<string, object>;
