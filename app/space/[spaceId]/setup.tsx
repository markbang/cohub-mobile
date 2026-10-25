import type { SpaceSandboxRecord } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { SETUP_STATUS, sandboxSetupInfo, sandboxSetupLogPaths, sandboxSetupStatus, type SandboxSetupInfo } from "@/src/data/sandbox-setup";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useTranslation } from "@/src/i18n";
import { AppIcon, DataError, LoadingSections, PrimaryButton, Screen, SettingsGroup, StatusPill, TopBar } from "@/src/ui";

type SetupStep = NonNullable<SandboxSetupInfo["steps"]>[number];

const MONO = { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } as const;

export default function SpaceSetupScreen() {
  const { spaceId = "" } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [sandbox, setSandbox] = useState<SpaceSandboxRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const setup = sandboxSetupInfo(sandbox?.meta);
  const status = sandboxSetupStatus(setup);
  const local = sandbox?.provider === "local";

  const load = useCallback(async () => {
    if (!client || !spaceId) return;
    try {
      const result = await client.space(spaceId).sandbox.get();
      setSandbox(result.sandbox);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("space.setup.loadFailed"));
      throw caught;
    }
  }, [client, spaceId, t]);
  useSyncScope(`space:${spaceId}:sandbox-setup`, load, status === "running" || status === "waiting" ? 4_000 : 60_000);

  const restart = async () => {
    if (!client || restarting) return;
    setRestarting(true);
    try {
      await client.space(spaceId).sandbox.recreate();
      setConfirming(false);
      toast({ title: t("space.settings.sandbox.restarted") });
      await load().catch(() => undefined);
    } catch (caught) {
      toast({ title: t("space.settings.sandbox.restartFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setRestarting(false);
    }
  };

  const openLog = (path: string) => router.push({ pathname: "/space/[spaceId]/file", params: { spaceId, path } });

  return <Screen>
    <TopBar title={t("space.setup.title")} onBack={() => router.back()} />
    {error && sandbox === undefined ? <DataError message={error} onRetry={() => void load().catch(() => undefined)} /> : null}
    {sandbox === undefined ? (error ? null : <LoadingSections sections={[{ kind: "group", rows: 1 }, { kind: "caption" }, { kind: "group", rows: 3, label: true }]} />) : (
      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
        <SettingsGroup>
          <View className="min-h-13 flex-row items-center gap-3 bg-surface px-4 py-3">
            <AppIcon name="terminal" size={18} tone="accent" />
            <Text className="min-w-0 flex-1 text-body font-semibold text-fg">{t("space.setup.script")}</Text>
            {local ? null : <StatusPill label={[t(SETUP_STATUS[status].label), setup?.duration].filter(Boolean).join(" · ")} tone={SETUP_STATUS[status].tone} />}
          </View>
        </SettingsGroup>
        <Text className="-mt-4 mb-6 px-8 text-caption text-fg-muted">{t(local ? "space.setup.local" : "space.setup.hint")}</Text>
        {!local && setup?.error ? <Text selectable accessibilityRole="alert" className="-mt-3 mb-6 px-8 text-caption text-danger">{setup.error}</Text> : null}
        {!local && status === "succeeded" && !setup?.ran ? <Text className="-mt-3 mb-6 px-8 text-subhead text-fg-muted">{t("space.setup.empty")}</Text> : null}
        {!local && setup?.steps?.length ? <SettingsGroup label={t("space.setup.steps")}>
          {setup.steps.map((step, index) => <StepRow
            key={step.path}
            step={step}
            open={expanded === step.path}
            last={index === setup.steps!.length - 1}
            onToggle={() => setExpanded((current) => current === step.path ? null : step.path)}
            onOpenLog={openLog}
          />)}
        </SettingsGroup> : null}
        {!local && sandbox ? <PrimaryButton variant="secondary" icon="refresh" label={t("space.setup.restart")} onPress={() => setConfirming(true)} className="mx-4" /> : null}
        {error ? <Text accessibilityRole="alert" selectable className="mt-3 px-8 text-caption text-danger">{error}</Text> : null}
      </ScrollView>
    )}
    <ConfirmSheet
      visible={confirming}
      title={t("space.settings.sandbox.restartConfirm.title")}
      message={t("space.settings.sandbox.restartConfirm.body")}
      confirmLabel={t("space.settings.spec.restartNow")}
      confirmIcon="refresh"
      busy={restarting}
      onConfirm={() => void restart()}
      onClose={() => setConfirming(false)}
    />
  </Screen>;
}

function StepRow({ step, open, last, onToggle, onOpenLog }: { step: SetupStep; open: boolean; last: boolean; onToggle: () => void; onOpenLog: (path: string) => void }) {
  const { t } = useTranslation();
  const output = `${step.stdout}${step.stderr}`.trim();
  const logs = sandboxSetupLogPaths(step.logDir);
  const failed = step.status === "failed";
  return <View className="bg-surface">
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${step.path}, ${t(SETUP_STATUS[step.status].label)}`} onPress={onToggle} className="min-h-13 flex-row items-center gap-2 py-2.5 pl-4 pr-3 active:bg-surface-pressed">
      <AppIcon name={open ? "chevron-down" : "chevron-right"} size={16} tone="faint" />
      <Text numberOfLines={open ? undefined : 1} ellipsizeMode="middle" className="min-w-0 flex-1 text-subhead text-fg" style={MONO}>{step.path}</Text>
      <Text className={`text-caption tabular-nums ${failed ? "text-danger" : "text-fg-muted"}`}>{[t(SETUP_STATUS[step.status].label), step.duration].filter(Boolean).join(" · ")}</Text>
    </Pressable>
    {open ? <View className="gap-2 pb-3 pl-10 pr-4">
      {step.error ? <Text selectable className="text-caption text-danger">{step.error}</Text> : null}
      {output ? <ScrollView nestedScrollEnabled className="max-h-64 rounded-xs bg-surface-raised" contentContainerClassName="p-3">
        <Text selectable className="text-micro text-fg-secondary" style={MONO}>{output}</Text>
      </ScrollView> : null}
      <View className="flex-row flex-wrap items-center gap-x-4">
        <Text className="text-caption text-fg-muted">{t("space.setup.logs")}</Text>
        {(["stdout", "stderr"] as const).map((stream) => <Pressable key={stream} accessibilityRole="link" accessibilityLabel={`${stream}.log`} onPress={() => onOpenLog(logs[stream])} className="min-h-11 justify-center active:opacity-60">
          <Text className="text-caption font-semibold text-accent" style={MONO}>{stream}.log</Text>
        </Pressable>)}
      </View>
    </View> : null}
    {last ? null : <View className="absolute bottom-0 left-4 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
  </View>;
}
