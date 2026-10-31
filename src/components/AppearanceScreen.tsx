import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ACCENTS, ACCENT_IDS, type AccentId } from "@/src/design/accents";
import {
  getAppThemeColors,
  setAccentPreference,
  setFontScalePreference,
  setPureBlackPreference,
  setThemePreference,
  type AppTheme,
  type FontScalePreference,
  type ThemePreference,
  useAccentPreference,
  useAppTheme,
  useFontScalePreference,
  usePureBlackPreference,
  useThemePreference,
} from "@/src/theme";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { AppSwitch, AppIcon, Segmented, SettingsGroup, TopBar, Screen, SectionHeader } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";

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

const ACCENT_LABELS: Record<AccentId, TranslationKey> = {
  ember: "appearance.accent.ember",
  blue: "appearance.accent.blue",
  violet: "appearance.accent.violet",
  rose: "appearance.accent.rose",
  teal: "appearance.accent.teal",
  green: "appearance.accent.green",
  amber: "appearance.accent.amber",
  graphite: "appearance.accent.graphite",
};

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
  const accent = useAccentPreference();
  const { width } = useWindowDimensions();
  const previewWidth = Math.max(108, Math.min(124, (width - 48) / 3.05));


  return (
    <View testID="appearance-content">
      <View className="px-4 pb-1 pt-5">
        <Text className="text-title font-bold text-fg">{t("appearance.intro.title")}</Text>
        <Text className="mt-1.5 max-w-130 text-subhead text-fg-muted">{t("appearance.intro.body")}</Text>
      </View>

      <SectionHeader title={t("appearance.section.theme")} />
      <Segmented
        className="mx-4"
        options={THEME_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey), icon: option.icon }))}
        value={preference}
        onChange={(value) => void setThemePreference(value)}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2.5 px-4 pb-1 pt-4"
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

      <SectionHeader title={t("appearance.section.accent")} />
      <SettingsGroup>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("appearance.section.accent")} className="flex-row flex-wrap bg-surface px-2 pt-3">
          {ACCENT_IDS.map((id) => (
            <AccentSwatch key={id} id={id} mode={theme.mode} selected={accent === id} label={t(ACCENT_LABELS[id])} onPress={() => void setAccentPreference(id)} />
          ))}
        </View>
        <Text className="bg-surface px-4 pb-3 pt-1 text-caption text-fg-muted">{t("appearance.accent.body", { name: t(ACCENT_LABELS[accent]) })}</Text>
      </SettingsGroup>

      <View className="mt-4">
        <SettingsGroup>
          <SettingsRow icon="moon" title={t("appearance.pureBlack.title")} value={t("appearance.pureBlack.body")} last>
            <AppSwitch
              accessibilityLabel={t("appearance.pureBlack.title")}
              value={pureBlack}
              disabled={preference === "light"}
              onValueChange={(value) => void setPureBlackPreference(value)}
            />
          </SettingsRow>
        </SettingsGroup>
      </View>

      <SectionHeader title={t("appearance.section.textSize")} />
      <Segmented
        className="mx-4"
        options={TEXT_SIZE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        value={fontScalePreference}
        onChange={(value) => void setFontScalePreference(value)}
      />
      <View className="mt-3">
        <SettingsGroup>
          <View className="flex-row items-center gap-3 bg-surface px-4 py-3">
            <AppIcon name="type" size={20} tone="muted" />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-chat text-fg">{t("appearance.textPreview.sample")}</Text>
              <Text className="text-caption text-fg-muted">{t("appearance.textPreview.body")}</Text>
            </View>
          </View>
        </SettingsGroup>
      </View>

      <SectionHeader title={t("appearance.section.palette")} />
      <SettingsGroup>
        <View className="gap-1 bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <View className="size-2 rounded-full bg-accent" />
            <Text className="text-body font-semibold text-fg">{preferenceLabel(preference, t)} · {appliedModeLabel(theme.mode, pureBlack, t)}</Text>
          </View>
          <Text className="text-caption text-fg-muted">{t("appearance.palette.applied")}</Text>
        </View>
      </SettingsGroup>
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

function AccentSwatch({ id, mode, selected, label, onPress }: { id: AccentId; mode: AppTheme["mode"]; selected: boolean; label: string; onPress: () => void }) {
  const { accent, accentText } = ACCENTS[id][mode];
  return (
    <View className="w-1/4 items-center pb-3">
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected, checked: selected }}
        onPress={onPress}
        hitSlop={4}
        className="size-12 items-center justify-center rounded-full active:opacity-70"
        // design-system: each swatch shows a preset other than the applied accent, so it reads that preset's color.
        style={{ borderWidth: 2, borderColor: selected ? accent : "transparent" }}
      >
        {/* design-system: swatch fill, see above. */}
        <View className="size-9 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
          {selected ? <AppIcon name="check" size={18} color={accentText} strokeWidth={2.6} /> : null}
        </View>
      </Pressable>
    </View>
  );
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
       
        // design-system: the preview draws a theme other than the active one, so it reads that palette in JS.
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
