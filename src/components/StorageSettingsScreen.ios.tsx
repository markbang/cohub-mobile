import { Button, Form, Host, Label, LabeledContent, Picker, Section, Text } from "@expo/ui/swift-ui";
import { disabled, foregroundStyle, listRowBackground, pickerStyle, scrollContentBackground, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { retentionLabel, useStorageSettings } from "@/src/components/use-storage-settings";
import { CACHE_RETENTION_OPTIONS } from "@/src/data/cache-retention";
import { traceAction } from "@/src/data/interaction-trace";
import { useTranslation } from "@/src/i18n";
import { SF_SYMBOLS } from "@/src/sf-symbols";
import { useAppTheme } from "@/src/theme";
import { Screen, TopBar } from "@/src/ui";

export function StorageSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const storage = useStorageSettings();
  const row = listRowBackground(theme.colors.surface);
  return <Screen>
    <TopBar title={t("settings.storage.title")} onBack={() => router.back()} />
    <Host style={{ flex: 1 }} colorScheme={theme.mode}>
      <Form modifiers={[scrollContentBackground("hidden"), tint(theme.colors.accent)]}>
        <Section>
          <LabeledContent label={<Label title={t("profile.data.spaces")} systemImage={SF_SYMBOLS.database} />} modifiers={[row]}>
            <Text modifiers={[foregroundStyle(theme.colors.textMuted)]}>{String(storage.spaceCount)}</Text>
          </LabeledContent>
          <LabeledContent label={<Label title={t("profile.data.chats")} systemImage={SF_SYMBOLS.messages} />} modifiers={[row]}>
            <Text modifiers={[foregroundStyle(theme.colors.textMuted)]}>{String(storage.chatCount)}</Text>
          </LabeledContent>
          <Picker<string>
            label={<Label title={t("profile.data.retention")} systemImage={SF_SYMBOLS.clock} />}
            selection={storage.retention}
            onSelectionChange={(next) => {
              const option = CACHE_RETENTION_OPTIONS.find((candidate) => candidate === next);
              if (!option || option === storage.retention) return;
              traceAction("select_choose", { title: t("profile.data.retention"), value: option });
              void storage.selectRetention(option);
            }}
            modifiers={[pickerStyle("menu"), disabled(storage.busy), row]}
            testID="cache-retention-select"
          >
            {CACHE_RETENTION_OPTIONS.map((option) => <Text key={option} modifiers={[tag(option)]}>{retentionLabel(option, t)}</Text>)}
          </Picker>
        </Section>
        <Section footer={storage.error && !storage.clearOpen ? <Text modifiers={[foregroundStyle(theme.colors.danger)]}>{storage.error}</Text> : undefined}>
          <Button role="destructive" systemImage={SF_SYMBOLS.trash} label={t("profile.data.clearCache")} onPress={storage.openClear} modifiers={[disabled(storage.busy), row]} />
        </Section>
      </Form>
    </Host>
    <ConfirmSheet
      visible={storage.clearOpen}
      title={t("profile.clearCache.title")}
      message={t("profile.clearCache.body")}
      confirmLabel={t("profile.clearCache.action")}
      confirmIcon="trash"
      busy={storage.busy}
      error={storage.error}
      onConfirm={() => void storage.confirmClearCache()}
      onClose={storage.closeClear}
      testID="clear-cache-sheet"
    />
  </Screen>;
}
