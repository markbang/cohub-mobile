import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { NoticeSheet } from "@/src/components/SystemDialogs";
import OPEN_SOURCE_LICENSES from "@/src/data/open-source-licenses.json";
import { openWebLink } from "@/src/platform/browser";
import { EmptyState, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { useTranslation } from "@/src/i18n";

type OpenSourcePackage = { name: string; version: string; license: string; url: string; licenseText: string | null };

const PACKAGES: OpenSourcePackage[] = OPEN_SOURCE_LICENSES.packages;
const CARD = { borderCurve: "continuous" } as const;
const MONO = { fontFamily: "SpaceMono" } as const;

export function LicensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Screen>
      <TopBar title={t("licenses.title")} onBack={() => router.back()} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        <Text className="mx-4 mb-3 text-subhead text-fg-muted">{t("licenses.description")}</Text>
        <View className="mb-4 flex-row gap-3 px-4">
          <Stat label={t("licenses.direct")} value={String(PACKAGES.length)} />
          <Stat label={t("licenses.transitive")} value={String(OPEN_SOURCE_LICENSES.transitiveCount)} />
        </View>
        <SettingsGroup>
          {PACKAGES.map((item, index) => (
            <SettingsRow
              key={item.name}
              icon="box"
              title={item.name}
              value={`${item.license} · v${item.version}`}
              last={index === PACKAGES.length - 1}
              onPress={() => router.push({ pathname: "/licenses/[name]", params: { name: item.name } })}
            />
          ))}
        </SettingsGroup>
      </ScrollView>
    </Screen>
  );
}

export function LicenseDetailScreen({ name }: { name: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const item = PACKAGES.find((entry) => entry.name === name);

  const openHomepage = async (url: string) => {
    try {
      await openWebLink(url);
    } catch (error) {
      setNotice({ title: t("about.linkError.title"), message: error instanceof Error ? error.message : t("about.linkUnavailable.body", { title: url }) });
    }
  };

  return (
    <Screen>
      <TopBar title={item?.name ?? t("licenses.title")} onBack={() => router.back()} />
      {item ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
          <Card>
            <Field label={t("licenses.field.name")}><Text selectable className="text-body text-fg">{item.name}</Text></Field>
            <Field label={t("licenses.field.version")}><Text selectable className="text-body tabular-nums text-fg">{item.version}</Text></Field>
            <Field label={t("licenses.field.license")}><Text selectable className="text-body text-fg">{item.license}</Text></Field>
            <Field label={t("licenses.field.homepage")}>
              <Text accessibilityRole="link" onPress={() => void openHomepage(item.url)} className="text-body text-accent">{item.url}</Text>
            </Field>
          </Card>
          <Card>
            <Field label={t("licenses.field.text")}>
              {item.licenseText
                ? <Text selectable className="text-code text-fg" style={MONO}>{item.licenseText}</Text>
                : <Text className="text-body text-fg-muted">{t("licenses.noText")}</Text>}
            </Field>
          </Card>
        </ScrollView>
      ) : (
        <EmptyState icon="circle-x" title={t("licenses.notFound")} />
      )}
      <NoticeSheet notice={notice} fallbackTitle={t("about.linkError.title")} onClose={() => setNotice(null)} testID="license-link-error-sheet" />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-md bg-surface px-4 py-3" style={CARD}>
      <Text className="text-caption text-fg-muted">{label}</Text>
      <Text className="text-title font-semibold tabular-nums text-fg">{value}</Text>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View className="mx-4 mb-4 gap-4 rounded-md bg-surface p-4" style={CARD}>{children}</View>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-caption text-fg-muted">{label}</Text>
      {children}
    </View>
  );
}
