import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { loadBrowserPreference, saveBrowserPreference, useBrowserPreference, type BrowserPreference } from "@/src/data/browser-preference";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, IconButton, SectionHeader } from "@/src/ui";

export function BrowserSettings() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const current = useBrowserPreference();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const select = async (next: BrowserPreference) => {
    if (saving || (current.loaded && next === current.preference)) return;
    setSaving(true);
    setSaveError(false);
    try {
      await saveBrowserPreference(next);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  return <View testID="browser-settings">
    <SectionHeader title={t("settings.browser.section")} />
    {!current.loaded && !current.error ? <ActivityIndicator color={theme.colors.accent} className="p-6" /> : <View accessibilityRole="radiogroup">
      {(["system", "in-app"] as const).map((option) => {
        const selected = current.loaded && current.preference === option;
        const title = t(option === "system" ? "settings.browser.system" : "settings.browser.inApp");
        return <Pressable
          key={option}
          testID={`browser-option-${option}`}
          accessibilityRole="radio"
          accessibilityLabel={title}
          accessibilityState={{ checked: selected, selected, disabled: saving }}
          disabled={saving}
          onPress={() => void select(option)}
          className="min-h-13 flex-row items-center gap-3 border-b border-border bg-surface px-4 py-3 active:bg-surface-pressed disabled:opacity-60"
        >
          <AppIcon name={option === "system" ? "external-link" : "globe"} size={20} tone="muted" />
          <Text className={`flex-1 text-body ${selected ? "font-semibold text-fg" : "text-fg"}`}>{title}</Text>
          <View className="w-6 h-6 items-center justify-center">
            {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
          </View>
        </Pressable>;
      })}
    </View>}
    {current.error || saveError ? <View className="p-4 gap-2 flex-row items-center">
      <Text accessibilityRole="alert" className="text-caption text-danger flex-1">{t(saveError ? "settings.browser.saveFailed" : "settings.browser.loadFailed")}</Text>
      {current.error ? <IconButton name="refresh" label={t("common.retry")} disabled={saving} onPress={() => void loadBrowserPreference().catch(() => undefined)} /> : null}
    </View> : null}
  </View>;
}
