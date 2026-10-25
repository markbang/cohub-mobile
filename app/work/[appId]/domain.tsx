import type { AppDomainDnsRecord, AppDomainListResponse, AppDomainRecord, AppDomainStatus } from "@neta-art/cohub";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { useToast } from "@/src/components/Toast";
import { appDomainParentZone } from "@/src/data/app-domains";
import { useAppDomains, type AppDomainProblem } from "@/src/data/use-app-domains";
import { useTranslation, type Translate, type TranslationKey } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppIcon, DataError, EmptyState, Field, FIELD_INPUT_CLASS, IconButton, Loader, LoadingSections, PrimaryButton, Screen, SettingsGroup, StatusPill, TopBar } from "@/src/ui";

type Params = { appId?: string | string[]; spaceId?: string | string[] };

const STATUS: Record<AppDomainStatus, { label: TranslationKey; tone: "warning" | "info" | "success" | "danger" | "neutral" }> = {
  pending: { label: "app.domain.status.pending", tone: "warning" },
  provisioning: { label: "app.domain.status.provisioning", tone: "info" },
  active: { label: "app.domain.status.active", tone: "success" },
  failed: { label: "app.domain.status.failed", tone: "danger" },
  removing: { label: "app.domain.status.removing", tone: "neutral" },
};

const PROBLEMS: Record<string, TranslationKey> = {
  domain_invalid: "app.domain.error.invalid",
  domain_reserved: "app.domain.error.reserved",
  domain_in_use: "app.domain.error.inUse",
  app_domain_exists: "app.domain.error.exists",
  app_not_eligible: "app.domain.notEligible",
  ownership_not_found: "app.domain.error.ownershipNotFound",
  verification_expired: "app.domain.error.verificationExpired",
  insufficient_balance: "app.domain.error.insufficientBalance",
  dns_moved: "app.domain.error.dnsMoved",
  certificate_failed: "app.domain.error.certificateFailed",
  provider_unavailable: "app.domain.error.providerUnavailable",
  custom_domains_disabled: "app.domain.unavailable",
  billing_unavailable: "app.domain.error.billingUnavailable",
};

const MONO = { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } as const;

function problemText(t: Translate, problem: AppDomainProblem, list: AppDomainListResponse, hostname: string) {
  const key = problem.code ? PROBLEMS[problem.code] : undefined;
  if (key) return t(key, { hostname, price: list.priceUsd, target: list.cnameTarget ?? "" });
  return problem.message || t("app.domain.error.generic");
}

export default function AppDomainScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const appId = (Array.isArray(params.appId) ? params.appId[0] : params.appId) ?? "";
  const spaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const domains = useAppDomains(appId, spaceId);
  const { list, busy, problem } = domains;
  const domain = list?.domains[0] ?? null;
  const [confirming, setConfirming] = useState(false);
  const insufficient = problem?.code === "insufficient_balance" || domain?.error?.code === "insufficient_balance";

  return <Screen>
    <TopBar title={t("app.domain.title")} onBack={() => router.back()} />
    {!list ? (domains.loadError ? <DataError message={domains.loadError} onRetry={domains.reload} /> : <LoadingSections sections={[{ kind: "field" }, { kind: "capsule" }]} />) : (
      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {domain ? <DomainDetail domain={domain} list={list} busy={busy} onCheck={() => void domains.check(domain.id)} onRemove={() => setConfirming(true)} />
          : !list.enabled ? <EmptyState icon="globe" title={t("app.domain.unavailable")} />
          : !list.eligible ? <EmptyState icon="globe" title={t("app.domain.title")} description={t("app.domain.notEligible")} />
          : <AddDomainForm price={list.priceUsd} busy={busy} onAdd={domains.add} />}
        {problem ? <Text accessibilityRole="alert" selectable className="px-8 text-caption text-danger">{problemText(t, problem, list, domain?.hostname ?? "")}</Text> : null}
        {insufficient ? <PrimaryButton variant="ghost" label={t("app.domain.addBalance")} icon="database" onPress={() => router.push("/settings/billing")} className="mx-4 mt-2 self-start" /> : null}
      </ScrollView>
    )}
    <ConfirmSheet
      visible={confirming && domain !== null}
      title={t("app.domain.remove")}
      subtitle={domain?.hostname}
      message={t("app.domain.removeConfirm")}
      confirmLabel={t("app.domain.remove")}
      confirmIcon="trash"
      busy={busy === "remove"}
      onConfirm={() => { if (domain) void domains.remove(domain.id).then(() => setConfirming(false)); }}
      onClose={() => setConfirming(false)}
    />
  </Screen>;
}

function AddDomainForm({ price, busy, onAdd }: { price: number; busy: string | null; onAdd: (input: string) => Promise<boolean> }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [hostname, setHostname] = useState("");
  const parent = appDomainParentZone(hostname);
  const submit = () => {
    if (!hostname.trim() || busy) return;
    void onAdd(hostname).then((added) => { if (added) setHostname(""); });
  };
  return <View className="mb-4 gap-3 px-4">
    <Field label={t("app.domain.title")} hint={t("app.domain.priceNote")}>
      <TextInput
        value={hostname}
        onChangeText={setHostname}
        onSubmitEditing={submit}
        placeholder="app.example.com"
        placeholderTextColor={theme.colors.textFaint}
        accessibilityLabel={t("app.domain.title")}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        returnKeyType="done"
        maxLength={253}
        editable={!busy}
        className={FIELD_INPUT_CLASS}
      />
    </Field>
    {parent ? <Text className="text-caption text-warning">{t("app.domain.subdomainWarning", { hostname: hostname.trim().toLowerCase(), parent })}</Text> : null}
    <PrimaryButton label={t("app.domain.add", { price })} loading={busy === "add"} disabled={!hostname.trim() || busy !== null} onPress={submit} />
  </View>;
}

function DomainDetail({ domain, list, busy, onCheck, onRemove }: { domain: AppDomainRecord; list: AppDomainListResponse; busy: string | null; onCheck: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const status = STATUS[domain.status];
  const removing = domain.status === "removing";
  const showRecords = domain.status === "pending" || domain.status === "provisioning" || domain.status === "failed";
  const notes = removing ? [] : [
    ...(!list.eligible ? [{ text: t("app.domain.notEligible"), danger: false }] : []),
    ...(domain.error ? [{ text: problemText(t, domain.error, list, domain.hostname), danger: domain.status === "failed" || domain.error.code === "dns_moved" }] : []),
  ];
  return <>
    <SettingsGroup>
      <View className="min-h-13 flex-row items-center gap-3 bg-surface py-2 pl-4 pr-2">
        <Text selectable className="min-w-0 flex-1 text-body font-semibold text-fg">{domain.hostname}</Text>
        <StatusPill label={t(status.label)} tone={status.tone} />
        {domain.status === "active" ? <IconButton name="external-link" label={t("app.domain.open", { hostname: domain.hostname })} size={40} onPress={() => void openWebLink(domain.url).catch(() => undefined)} /> : null}
      </View>
    </SettingsGroup>
    {notes.length ? <View className="-mt-4 mb-6 gap-1 px-8">
      {notes.map((note) => <Text key={note.text} selectable className={`text-caption ${note.danger ? "text-danger" : "text-fg-muted"}`}>{note.text}</Text>)}
    </View> : null}
    {showRecords ? <>
      <SettingsGroup label={t("app.domain.records")}>
        {domain.dnsRecords.map((record, index) => <DnsRecordRow key={record.type} record={record} last={index === domain.dnsRecords.length - 1} />)}
      </SettingsGroup>
      <Text className="-mt-4 mb-6 px-8 text-caption text-fg-muted">{t("app.domain.recordsHint")}</Text>
    </> : null}
    <SettingsGroup>
      {removing ? null : <ActionRow label={t("app.domain.check")} busy={busy === "check"} disabled={busy !== null} onPress={onCheck} />}
      <ActionRow label={t("app.domain.remove")} danger busy={busy === "remove"} disabled={busy !== null || removing} onPress={onRemove} separator={!removing} />
    </SettingsGroup>
  </>;
}

function DnsRecordRow({ record, last }: { record: AppDomainDnsRecord; last: boolean }) {
  const { t } = useTranslation();
  return <View className="gap-2 bg-surface py-3 pl-4 pr-1">
    <View className="flex-row items-center gap-1.5">
      <Text className="text-caption font-semibold text-fg-muted">{record.type}</Text>
      {record.satisfied ? <AppIcon name="check" size={14} tone="success" strokeWidth={2.4} /> : null}
    </View>
    <CopyLine label={t("app.domain.recordName")} value={record.name} />
    <CopyLine label={t("app.domain.recordValue")} value={record.value} />
    {last ? null : <View className="absolute bottom-0 left-4 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
  </View>;
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      toast({ title: t("app.domain.copied") });
    } catch (caught) {
      toast({ title: t("app.domain.error.generic"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    }
  };
  return <View className="flex-row items-center gap-1">
    <View className="min-w-0 flex-1 gap-0.5">
      <Text className="text-micro text-fg-faint">{label}</Text>
      <Text selectable className="text-subhead text-fg" style={MONO}>{value}</Text>
    </View>
    <IconButton name="copy" label={t("app.domain.copy", { field: label })} size={40} onPress={() => void copy()} />
  </View>;
}

function ActionRow({ label, onPress, busy, disabled, danger = false, separator = false }: { label: string; onPress: () => void; busy: boolean; disabled: boolean; danger?: boolean; separator?: boolean }) {
  const theme = useAppTheme();
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled, busy }}
    disabled={disabled}
    onPress={onPress}
    className={`min-h-13 flex-row items-center justify-center gap-2 bg-surface disabled:opacity-55 ${danger ? "active:bg-danger-soft" : "active:bg-surface-pressed"}`}
  >
    {busy ? <Loader color={danger ? theme.colors.danger : theme.colors.accent} /> : null}
    <Text className={`text-body font-semibold ${danger ? "text-danger" : "text-accent"}`}>{label}</Text>
    {separator ? <View className="absolute left-4 right-0 top-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} /> : null}
  </Pressable>;
}
