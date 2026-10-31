import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { NoticeSheet } from "@/src/components/SystemDialogs";
import { AppUpdateRow } from "@/src/components/AppUpdateBanner";
import { useDebugUnlock } from "@/src/components/useDebugUnlock";
import { submitFeedback, type FeedbackAttachment } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { getInstalledAppVersion } from "@/src/platform/app-updates";
import { openWebLink } from "@/src/platform/browser";
import { AppSwitch, AppIcon, Field, FIELD_INPUT_CLASS, TopBar, Screen, SectionHeader, PrimaryButton, SettingsGroup } from "@/src/ui";
import { ROUNDED_TITLE } from "@/src/ui/rounded";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

const REPOSITORY_URL = "https://github.com/markbang/cohub-mobile";
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
const COHUB_URL = "https://cohub.live";
const MAX_ATTACHMENTS = 5;

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
  const [feedbackIncludeLog, setFeedbackIncludeLog] = useState(true);
  const [feedbackAttachments, setFeedbackAttachments] = useState<FeedbackAttachment[]>([]);
  const attachmentLimit = feedbackIncludeLog ? MAX_ATTACHMENTS - 1 : MAX_ATTACHMENTS;
  const version = getInstalledAppVersion();
  const unlockDebug = useDebugUnlock(useCallback(() => router.push("/debug"), [router]));

  const appendAttachments = (next: FeedbackAttachment[]) => {
    if (feedbackAttachments.length + next.length > attachmentLimit) {
      setFeedbackError(t("about.feedback.attachments.limit", { count: attachmentLimit }));
    }
    setFeedbackAttachments((current) => [...current, ...next].slice(0, attachmentLimit));
  };

  const pickFeedbackFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/octet-stream", size: asset.size ?? 0 })));
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : t("about.feedback.attachmentsUnavailable"));
    }
  };

  const pickFeedbackPhotos = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFeedbackError(t("about.feedback.photoOff"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.88 });
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName || `image-${index + 1}.jpg`, mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 })));
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : t("about.feedback.attachmentsUnavailable"));
    }
  };

  const sendFeedback = () => {
    setFeedbackSubmitting(true);
    setFeedbackError(null);
    void submitFeedback({ description: feedbackText, includeLog: feedbackIncludeLog, attachments: feedbackAttachments })
      .then((receipt) => {
        setFeedbackId(receipt.id);
        setFeedbackAttachments([]);
      })
      .catch((error) => setFeedbackError(error instanceof Error ? error.message : t("about.feedback.error")))
      .finally(() => setFeedbackSubmitting(false));
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
        <Text style={ROUNDED_TITLE} className="mt-4 text-title font-bold text-fg">{t("about.appName")}</Text>
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

      <SectionHeader title={t("about.section.support")} />
      <SettingsGroup>
        <SettingsRow icon="messages" title={t("about.feedback.title")} value={t("about.feedback.detail")} last onPress={() => { setFeedbackError(null); setFeedbackId(null); setFeedbackText(""); setFeedbackAttachments([]); setFeedbackIncludeLog(true); setFeedbackOpen(true); }} />
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
        <NoticeSheet notice={notice} fallbackTitle={t("about.linkError.title")} onClose={() => setNotice(null)} testID="about-link-error-sheet" />
      ) : null}

      <AdaptiveSheet visible={feedbackOpen} title={t("about.feedback.title")} onClose={() => { if (!feedbackSubmitting) setFeedbackOpen(false); }}>
        {feedbackId ? (
          <View className="gap-3">
            <Text className="text-body text-success">{t("about.feedback.success", { id: feedbackId })}</Text>
            <PrimaryButton variant="secondary" label={t("common.done")} onPress={() => setFeedbackOpen(false)} />
          </View>
        ) : <View className="gap-3">
          <Field label={t("about.feedback.label")} hint={t("about.feedback.description")} error={feedbackError}>
            <TextInput value={feedbackText} onChangeText={setFeedbackText} multiline maxLength={4000} placeholder={t("about.feedback.placeholder")} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("about.feedback.title")} className={`min-h-30 ${FIELD_INPUT_CLASS}`} style={{ textAlignVertical: "top" }} />
          </Field>
          <Field label={t("about.feedback.attachments.label")} hint={t("about.feedback.attachments.hint")}>
            <View className="gap-2">
              {feedbackAttachments.map((attachment, index) => (
                <View key={`${attachment.uri}-${index}`} className="flex-row items-center gap-2 rounded-sm bg-surface-raised px-3 py-2">
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-body text-fg">{attachment.name}</Text>
                  <Text className="text-caption text-fg-muted">{formatFileSize(attachment.size)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("about.feedback.attachments.remove", { name: attachment.name })} hitSlop={8} disabled={feedbackSubmitting} onPress={() => setFeedbackAttachments((current) => current.filter((_, item) => item !== index))} className="active:opacity-55">
                    <AppIcon name="x" size={18} tone="muted" />
                  </Pressable>
                </View>
              ))}
              {feedbackAttachments.length < attachmentLimit ? (
                <View className="flex-row gap-2">
                  <PrimaryButton variant="secondary" label={t("about.feedback.attachments.file")} icon="paperclip" disabled={feedbackSubmitting} onPress={() => void pickFeedbackFiles()} className="flex-1" />
                  <PrimaryButton variant="secondary" label={t("about.feedback.attachments.photo")} icon="images" disabled={feedbackSubmitting} onPress={() => void pickFeedbackPhotos()} className="flex-1" />
                </View>
              ) : null}
            </View>
          </Field>
          <SettingsRow icon="activity" title={t("about.feedback.log.title")} value={t("about.feedback.log.detail")} disabled={feedbackSubmitting} last>
            <AppSwitch
              accessibilityLabel={t("about.feedback.log.title")}
              value={feedbackIncludeLog}
              disabled={feedbackSubmitting}
              onValueChange={(value) => {
                traceAction("feedback_log_toggle", { value });
                setFeedbackIncludeLog(value);
                if (value) setFeedbackAttachments((current) => current.slice(0, MAX_ATTACHMENTS - 1));
              }}
              ios_backgroundColor={theme.colors.borderStrong}
            />
          </SettingsRow>
          <PrimaryButton label={feedbackSubmitting ? t("common.loading") : t("about.feedback.submit")} disabled={feedbackSubmitting || !feedbackText.trim()} onPress={sendFeedback} />
        </View>}
      </AdaptiveSheet>
    </View>
  );
}

type Notice = { title: string; message: string };

function formatFileSize(value: number) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
