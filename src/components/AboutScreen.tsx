import { useRouter } from "expo-router";
import { Directory } from "expo-file-system";
import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { AppUpdateRow } from "@/src/components/AppUpdateBanner";
import { useDebugUnlock } from "@/src/components/useDebugUnlock";
import { exportDiagnostics, useDebugDiagnostics } from "@/src/data/debug-session";
import { getInstalledAppVersion } from "@/src/platform/app-updates";
import { openWebLink } from "@/src/platform/browser";
import { Field, FIELD_INPUT_CLASS, TopBar, Screen, SectionHeader, PrimaryButton, SettingsGroup } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

const REPOSITORY_URL = "https://github.com/markbang/cohub-mobile";
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
const COHUB_URL = "https://cohub.live";

export function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Screen>
      <TopBar title={t("about.title")} onBack={() => router.back()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <AboutContent />
      </ScrollView>
    </Screen>
  );
}

export function AboutContent({ onNotice }: { onNotice?: (notice: { title: string; message: string }) => void } = {}) {
  const theme = useAppTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [exportingLog, setExportingLog] = useState(false);
  const diagnostics = useDebugDiagnostics();
  const version = getInstalledAppVersion();
  const unlockDebug = useDebugUnlock(useCallback(() => router.push("/debug"), [router]));

  const saveDiagnosticLog = async () => {
    if (exportingLog) return;
    setExportingLog(true);
    try {
      // Local export: write the log into a folder the user picks, then they can attach the file
      // directly. No server round trip, so a diagnostics outage cannot block capture.
      const text = await exportDiagnostics();
      const directory = await Directory.pickDirectoryAsync();
      const name = `cohub-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
      const file = directory.createFile(name, "application/jsonl");
      if (!file.exists) file.create();
      await file.write(text);
      setNotice({ title: t("about.export.saved.title"), message: t("about.export.saved.body", { name }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Dismissing the folder picker is not a failure.
      if (/cancel/i.test(message)) return;
      setNotice({ title: t("about.export.failed"), message });
    } finally {
      setExportingLog(false);
    }
  };

  const openExternal = async (url: string, title: string) => {
    try {
      await openWebLink(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("about.linkUnavailable.body", { title });
      if (onNotice) onNotice({ title: t("about.linkUnavailable.title", { title }), message });
      else setNotice({ title: t("about.linkUnavailable.title", { title }), message });
    }
  };

  return (
    <View testID="about-content">
      <View className="items-center px-4 pb-2 pt-6">
        <Image source={require("../../assets/images/icon.png")} resizeMode="contain" className="size-20 rounded-lg" />
        <Text className="mt-4 text-title font-bold text-fg">{t("about.appName")}</Text>
        <Text className="mt-1 text-center text-subhead text-fg-muted">{t("about.tagline")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("about.versionLabel", { version })} onPress={unlockDebug} hitSlop={8} className="mt-3 rounded-full bg-accent-soft px-2.5 py-1">
          <Text className="text-caption tabular-nums text-accent">{t("about.version", { version })}</Text>
        </Pressable>
      </View>

      <SectionHeader title={t("about.section.application")} />
      <SettingsGroup>
        <SettingsRow icon="info" title={t("about.row.version")} detail={version} />
        <AppUpdateRow />
      </SettingsGroup>

      <SectionHeader title={t("about.section.diagnostics")} />
      <SettingsGroup>
        <SettingsRow icon="activity" title={t("about.diagnostics.title")} value={t("about.diagnostics.detail")} last={!diagnostics.enabled}>
          <Switch accessibilityLabel={t("about.diagnostics.title")} value={diagnostics.enabled} onValueChange={(value) => void diagnostics.setEnabled(value)} />
        </SettingsRow>
        {diagnostics.enabled ? <>
          <SettingsRow icon="download" title={t("about.export.save.title")} value={exportingLog ? t("common.loading") : t("about.export.save.detail")} onPress={() => void saveDiagnosticLog()} />
          <SettingsRow icon="messages" title={t("about.feedback.title")} value={t("about.feedback.detail")} last onPress={() => { setFeedbackError(null); setFeedbackId(null); setFeedbackText(""); setFeedbackOpen(true); }} />
        </> : null}
      </SettingsGroup>

      <SectionHeader title={t("about.section.links")} />
      <SettingsGroup>
        <SettingsRow external icon="code" title={t("about.row.source")} value={t("about.row.sourceDetail")} onPress={() => void openExternal(REPOSITORY_URL, t("about.row.source"))} />
        <SettingsRow external icon="book-open" title={t("about.row.releases")} value={t("about.row.releasesDetail")} onPress={() => void openExternal(RELEASES_URL, t("about.row.releases"))} />
        <SettingsRow external icon="globe" title={t("about.row.website")} value={t("about.row.websiteDetail")} last onPress={() => void openExternal(COHUB_URL, t("about.row.website"))} />
      </SettingsGroup>

      <SectionHeader title={t("about.section.legal")} />
      <SettingsGroup>
        <SettingsRow external icon="shield" title={t("about.row.license")} value={t("about.row.licenseDetail")} last onPress={() => void openExternal(LICENSE_URL, t("about.row.license"))} />
      </SettingsGroup>

      <Text className="mx-6 mt-2 text-center text-caption text-fg-faint">{t("about.builtWith")}</Text>

      {!onNotice ? (
        <AdaptiveSheet
          visible={notice !== null}
          title={notice?.title ?? t("about.linkError.title")}
          onClose={() => setNotice(null)}
          scrollable={false}
          testID="about-link-error-sheet"
        >
          <Text className="text-body text-fg-secondary">{notice?.message}</Text>
        </AdaptiveSheet>
      ) : null}

      <AdaptiveSheet visible={feedbackOpen} title={t("about.feedback.title")} onClose={() => { if (!feedbackSubmitting) setFeedbackOpen(false); }} scrollable={false}>
        {feedbackId ? <Text className="text-body text-success">{t("about.feedback.success", { id: feedbackId })}</Text> : <View className="gap-3">
          <Field hint={t("about.feedback.description")} error={feedbackError}>
            <TextInput value={feedbackText} onChangeText={setFeedbackText} multiline maxLength={4000} placeholder={t("about.feedback.placeholder")} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("about.feedback.title")} className={`min-h-30 ${FIELD_INPUT_CLASS}`} style={{ textAlignVertical: "top" }} />
          </Field>
          <PrimaryButton label={feedbackSubmitting ? t("common.loading") : t("about.feedback.submit")} disabled={feedbackSubmitting || !feedbackText.trim()} onPress={() => { setFeedbackSubmitting(true); setFeedbackError(null); void diagnostics.submitFeedback({ description: feedbackText, includeSession: true, includeConversation: false }).then((receipt) => setFeedbackId(receipt.id)).catch((error) => setFeedbackError(error instanceof Error ? error.message : t("about.feedback.error"))).finally(() => setFeedbackSubmitting(false)); }} />
        </View>}
      </AdaptiveSheet>
    </View>
  );
}

type Notice = { title: string; message: string };
