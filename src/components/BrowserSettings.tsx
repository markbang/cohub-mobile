import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { loadBrowserPreference, saveBrowserPreference, useBrowserPreference, type BrowserPreference } from "@/src/data/browser-preference";
import { useTranslation } from "@/src/i18n";
import { AppIcon, IconButton, LoadingState, SettingsGroup } from "@/src/ui";
import { GroupSeparator, GroupTile } from "@/src/components/GroupRow";

export function BrowserSettings() {
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
  const options = ["system", "in-app"] as const;
  return <View testID="browser-settings" className="pt-4">
    {!current.loaded && !current.error ? <LoadingState fill={false} /> : <SettingsGroup label={t("settings.browser.section")}>
      <View accessibilityRole="radiogroup">
        {options.map((option, index) => {
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
            className="min-h-13 flex-row items-center gap-3 bg-surface px-4 py-2 active:bg-surface-pressed disabled:opacity-60"
          >
            <GroupTile icon={option === "system" ? "external-link" : "globe"} />
            <Text className="min-w-0 flex-1 text-body text-fg">{title}</Text>
            <View className="w-5 items-center">{selected ? <AppIcon name="check" size={18} tone="accent" strokeWidth={2.4} /> : null}</View>
            {index < options.length - 1 ? <GroupSeparator /> : null}
          </Pressable>;
        })}
      </View>
    </SettingsGroup>}
    {current.error || saveError ? <View className="-mt-4 flex-row items-center gap-2 pl-8 pr-5">
      <Text accessibilityRole="alert" className="flex-1 text-caption text-danger">{t(saveError ? "settings.browser.saveFailed" : "settings.browser.loadFailed")}</Text>
      {current.error ? <IconButton name="refresh" label={t("common.retry")} disabled={saving} onPress={() => void loadBrowserPreference().catch(() => undefined)} /> : null}
    </View> : null}
  </View>;
}
