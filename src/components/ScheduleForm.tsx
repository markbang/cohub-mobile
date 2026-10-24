import { useMemo } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { FilterChip } from "@/src/components/FilterChip";
import { CRON_PRESETS, isValidTimeZone, nextCronRuns, parseCron, summarizeCron, type CronSummary } from "@/src/data/cron";
import { useTranslation, type Translate } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { Field, FIELD_INPUT_CLASS } from "@/src/ui";

export type ScheduleValues = { title: string; prompt: string; cronExpression: string; timezone: string };

const MONO = { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } as const;

export function cronSummaryText(summary: CronSummary, expression: string, t: Translate): string {
  if (summary.kind === "preset") return t(summary.id === "weekdays" ? "schedule.summary.weekdays" : "schedule.summary.daily", { time: summary.time });
  if (summary.kind === "hourly") return t("schedule.summary.hourly", { minute: String(summary.minute).padStart(2, "0") });
  if (summary.kind === "minutes") return t("schedule.summary.minutes", { count: summary.every });
  if (summary.kind === "weekday") return t("schedule.summary.weekday", { day: t(`schedule.weekday.${summary.weekday}` as "schedule.weekday.0"), time: summary.time });
  return expression;
}

export function formatRunTime(date: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function scheduleProblem(values: ScheduleValues, withPrompt: boolean, t: Translate): string | null {
  if (!values.title.trim()) return t("schedule.error.title");
  if (withPrompt && !values.prompt.trim()) return t("schedule.error.prompt");
  if (!parseCron(values.cronExpression)) return t("schedule.error.expression");
  if (!isValidTimeZone(values.timezone.trim())) return t("schedule.error.timezone");
  return null;
}

export function ScheduleForm({ values, onChange, withPrompt, disabled = false }: { values: ScheduleValues; onChange: (values: ScheduleValues) => void; withPrompt: boolean; disabled?: boolean }) {
  const theme = useAppTheme();
  const { t, locale } = useTranslation();
  const timezone = values.timezone.trim();
  const runs = useMemo(() => nextCronRuns(values.cronExpression, timezone, 3), [timezone, values.cronExpression]);
  const valid = Boolean(parseCron(values.cronExpression));
  const set = (patch: Partial<ScheduleValues>) => onChange({ ...values, ...patch });
  return <View className="gap-4">
    <Field label={t("schedule.field.title")}>
      <TextInput value={values.title} onChangeText={(title) => set({ title })} editable={!disabled} maxLength={200} placeholder={t("schedule.field.titlePlaceholder")} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("schedule.field.title")} className={FIELD_INPUT_CLASS} />
    </Field>
    {withPrompt ? <Field label={t("schedule.field.prompt")} hint={t("schedule.field.promptHint")}>
      <TextInput value={values.prompt} onChangeText={(prompt) => set({ prompt })} editable={!disabled} multiline textAlignVertical="top" placeholder={t("schedule.field.promptPlaceholder")} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("schedule.field.prompt")} className={`min-h-32 ${FIELD_INPUT_CLASS}`} />
    </Field> : null}
    <Field label={t("schedule.field.repeat")} error={values.cronExpression.trim() && !valid ? t("schedule.error.expression") : null} hint={valid ? cronSummaryText(summarizeCron(values.cronExpression), values.cronExpression, t) : t("schedule.field.repeatHint")}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1" keyboardShouldPersistTaps="handled">
        {CRON_PRESETS.map((preset) => <FilterChip key={preset.id} label={t(`schedule.preset.${preset.id}`)} selected={values.cronExpression.trim() === preset.expression} onPress={() => { if (!disabled) set({ cronExpression: preset.expression }); }} />)}
      </ScrollView>
      <TextInput value={values.cronExpression} onChangeText={(cronExpression) => set({ cronExpression })} editable={!disabled} autoCapitalize="none" autoCorrect={false} placeholder="0 9 * * *" placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("schedule.field.repeat")} className={FIELD_INPUT_CLASS} style={MONO} />
    </Field>
    <Field label={t("schedule.field.timezone")} error={timezone && !isValidTimeZone(timezone) ? t("schedule.error.timezone") : null}>
      <TextInput value={values.timezone} onChangeText={(next) => set({ timezone: next })} editable={!disabled} autoCapitalize="none" autoCorrect={false} placeholder="Asia/Shanghai" placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("schedule.field.timezone")} className={FIELD_INPUT_CLASS} />
    </Field>
    {runs.length ? <View className="gap-1 rounded-sm bg-surface-raised px-3 py-2.5" style={{ borderCurve: "continuous" }}>
      <Text className="text-caption font-semibold text-fg-muted">{t("schedule.nextRuns")}</Text>
      {runs.map((run) => <Text key={run.getTime()} className="text-subhead tabular-nums text-fg">{formatRunTime(run, timezone, locale)}</Text>)}
    </View> : null}
  </View>;
}
