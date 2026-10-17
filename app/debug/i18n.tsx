import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { getDeviceLocale, useTranslation, type LocalePreference } from "@/src/i18n";
import { en } from "@/src/i18n/en";
import { zh } from "@/src/i18n/zh";
import { useAppTheme } from "@/src/theme";
import { Screen, SectionHeader } from "@/src/ui";

const PREFERENCES: LocalePreference[] = ["system", "en", "zh"];
const LIMIT = 120;

export default function DebugI18nScreen() {
  const theme = useAppTheme();
  const { t, locale, preference, setPreference } = useTranslation();
  const [query, setQuery] = useState("");

  const keys = useMemo(() => Object.keys(en).sort() as (keyof typeof en)[], []);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? keys.filter((key) => key.toLowerCase().includes(needle) || en[key].toLowerCase().includes(needle) || zh[key].toLowerCase().includes(needle))
      : keys;
    return filtered.slice(0, LIMIT);
  }, [keys, query]);

  const missing = useMemo(() => keys.filter((key) => !zh[key]), [keys]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="当前语言" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row label="locale" value={locale} testID="debug.i18n.locale" />
          <Row label="preference" value={preference} testID="debug.i18n.preference" />
          <Row label="device" value={getDeviceLocale()} />
          <Row label="keys" value={`${keys.length}（缺失 ${missing.length}）`} testID="debug.i18n.keys" />
        </View>

        <SectionHeader title="切换" />
        <View className="px-4 flex-row gap-2">
          {PREFERENCES.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: preference === option }}
              onPress={() => void setPreference(option)}
              className={`min-h-9 justify-center rounded-full px-3 ${preference === option ? "bg-accent-soft" : "bg-surface active:bg-surface-pressed"}`}
            >
              <Text className={`text-caption ${preference === option ? "text-accent" : "text-fg-muted"}`}>{option}</Text>
            </Pressable>
          ))}
          <View className="flex-1" />
          <Text className="text-micro font-semibold text-fg-faint self-center">{`t("common.retry") = ${t("common.retry")}`}</Text>
        </View>

        <SectionHeader title="Key 检索" />
        <View className="px-4">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索 key 或中英文文案"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            className="text-body text-fg min-h-12 px-3 border border-border rounded-md bg-background"
          />
        </View>
        <View className="mx-4 border rounded-md overflow-hidden mt-3 border-border bg-surface">
          {matches.length === 0 ? (
            <Text className="text-caption text-fg-muted p-4">没有匹配的 key</Text>
          ) : matches.map((key) => (
            <View key={key} className="px-3 py-2 border-b border-border gap-1">
              <Text selectable className="text-micro text-accent" style={MONO}>{key}</Text>
              <Text selectable className="text-caption text-fg-secondary">{en[key]}</Text>
              <Text selectable className="text-caption text-fg-muted">{zh[key]}</Text>
            </View>
          ))}
          {matches.length >= LIMIT ? (
            <Text className="text-micro font-semibold text-fg-faint p-3">仅显示前 {LIMIT} 条，请继续输入缩小范围</Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View className="min-h-12 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <Text className="text-caption text-fg-muted w-28">{label}</Text>
      <Text testID={testID} selectable className="text-caption text-fg flex-1 text-right">{value}</Text>
    </View>
  );
}

const MONO = { fontFamily: "SpaceMono" } as const;
