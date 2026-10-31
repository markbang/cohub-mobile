import { Form, Host, LabeledContent, Picker, Section, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, labelsHidden, listRowBackground, pickerStyle, scrollContentBackground, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { traceAction } from "@/src/data/interaction-trace";
import { getDeviceLocale, useTranslation, type LocalePreference } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { Screen, TopBar } from "@/src/ui";

export function LanguageScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t, preference, setPreference } = useTranslation();
  const options: { value: LocalePreference; label: string; detail: string }[] = [
    { value: "system", label: t("language.option.system"), detail: t("language.option.systemDetail") },
    { value: "en", label: t("language.option.en"), detail: t("language.option.enDetail") },
    { value: "zh", label: t("language.option.zh"), detail: t("language.option.zhDetail") },
  ];
  const row = listRowBackground(theme.colors.surface);
  return <Screen>
    <TopBar title={t("language.title")} onBack={() => router.back()} />
    <Host style={{ flex: 1 }} colorScheme={theme.mode} testID="language-content">
      <Form modifiers={[scrollContentBackground("hidden"), tint(theme.colors.accent)]}>
        <Section title={t("language.section.app")} footer={<Text>{t("language.intro.body")}</Text>}>
          <Picker<string>
            label={t("language.section.app")}
            selection={preference}
            onSelectionChange={(next) => {
              const option = options.find((candidate) => candidate.value === next);
              if (!option || option.value === preference) return;
              traceAction("select_choose", { title: "language", value: option.value });
              void setPreference(option.value);
            }}
            modifiers={[pickerStyle("inline"), labelsHidden(), row]}
          >
            {options.map((option) => <VStack key={option.value} alignment="leading" spacing={2} modifiers={[tag(option.value)]}>
              <Text modifiers={[foregroundStyle(theme.colors.text)]}>{option.label}</Text>
              <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(theme.colors.textMuted)]}>{option.detail}</Text>
            </VStack>)}
          </Picker>
        </Section>
        <Section>
          <LabeledContent label={t("language.device.title")} modifiers={[row]}>
            <Text modifiers={[foregroundStyle(theme.colors.textMuted)]}>{getDeviceLocale() === "zh" ? t("language.device.chinese") : t("language.device.english")}</Text>
          </LabeledContent>
        </Section>
      </Form>
    </Host>
  </Screen>;
}
