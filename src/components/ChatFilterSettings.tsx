import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { loadSessionFilterMinutes, saveSessionFilterMinutes, useSessionFilterPreference } from "@/src/data/session-filter-preference";
import { MAX_SESSION_FILTER_MINUTES, parseSessionFilterMinutes } from "@/src/data/session-status";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { FIELD_INPUT_CLASS, IconButton, PrimaryButton } from "@/src/ui";

export function ChatFilterSettings() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const preference = useSessionFilterPreference();
  return <View className="p-4 gap-3">
    {preference.error ? <View className="flex-row items-center gap-2">
      <Text className="text-caption text-danger flex-1">{preference.error}</Text>
      <IconButton name="refresh" label={t("common.retry")} onPress={() => void loadSessionFilterMinutes().catch(() => undefined)} />
    </View> : null}
    {!preference.loaded && !preference.error ? <ActivityIndicator color={theme.colors.accent} /> : <ChatFilterForm key={preference.minutes} minutes={preference.minutes} />}
  </View>;
}

function ChatFilterForm({ minutes }: { minutes: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [input, setInput] = useState(String(minutes));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    let next: number;
    try {
      next = parseSessionFilterMinutes(input);
    } catch {
      setError(t("settings.chats.invalid", { max: MAX_SESSION_FILTER_MINUTES }));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSessionFilterMinutes(next);
      toast({ title: t("settings.chats.saved") });
    } catch {
      setError(t("settings.chats.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  return <View className="gap-3">
    <Text className="text-headline font-semibold text-fg">{t("settings.chats.window")}</Text>
    <Text className="text-caption text-fg-muted">{t("chats.filter.running")} / {t("chats.filter.completed")}</Text>
    <TextInput
      testID="chat-filter-minutes"
      accessibilityLabel={t("settings.chats.window")}
      keyboardType="number-pad"
      value={input}
      onChangeText={setInput}
      editable={!saving}
      maxLength={4}
      selectTextOnFocus
      className={`${FIELD_INPUT_CLASS} ${error ? "border border-danger" : ""}`}
    />
    <Text className="text-caption text-fg-muted">{t("settings.chats.range", { max: MAX_SESSION_FILTER_MINUTES })}</Text>
    {error ? <Text accessibilityRole="alert" className="text-caption text-danger">{error}</Text> : null}
    <PrimaryButton label={t("common.save")} icon="check" loading={saving} disabled={saving} onPress={() => void save()} className="self-start" />
  </View>;
}
