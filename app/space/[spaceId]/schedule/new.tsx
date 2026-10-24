import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScheduleForm, scheduleProblem, type ScheduleValues } from "@/src/components/ScheduleForm";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { deviceTimeZone } from "@/src/data/cron";
import { useTranslation } from "@/src/i18n";
import { PrimaryButton, Screen, TopBar } from "@/src/ui";

export default function NewScheduleScreen() {
  const { spaceId = "" } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [values, setValues] = useState<ScheduleValues>(() => ({ title: "", prompt: "", cronExpression: "0 9 * * *", timezone: deviceTimeZone() }));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = scheduleProblem(values, true, t);

  const create = async () => {
    setSubmitted(true);
    if (!client || problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await client.space(spaceId).prompt({
        title: values.title.trim(),
        content: [{ type: "text", text: values.prompt.trim() }],
        schedule: { mode: "repeat", cronExpression: values.cronExpression.trim(), timezone: values.timezone.trim() },
      });
      if (result.mode !== "repeat") throw new Error(t("schedule.createFailed"));
      toast({ title: t("schedule.created") });
      router.replace({ pathname: "/space/[spaceId]/schedule/[jobId]", params: { spaceId, jobId: result.cronJobId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("schedule.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return <Screen keyboard>
    <TopBar title={t("schedule.newTitle")} onBack={() => router.back()} />
    <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 p-4" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
      <ScheduleForm values={values} onChange={setValues} withPrompt disabled={saving} />
      {submitted && problem ? <Text accessibilityRole="alert" className="text-caption text-danger">{problem}</Text> : null}
      {error ? <Text accessibilityRole="alert" selectable className="text-caption text-danger">{error}</Text> : null}
      <PrimaryButton label={t("schedule.create")} icon="calendar-clock" loading={saving} onPress={() => void create()} />
    </ScrollView>
  </Screen>;
}
