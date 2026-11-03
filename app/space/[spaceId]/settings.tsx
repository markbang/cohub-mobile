import * as Clipboard from "expo-clipboard";
import type { CronJobRecord, SandboxSpecId, SpaceMember, SpaceRole, SpaceSandboxAutoDestroyPolicy, SpaceSandboxConfig } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { DeviceFolderPickerSheet } from "@/src/components/DeviceFolderBrowser";
import { AnchoredActionMenu, type AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import { NativeMenuButton, nativeMenus } from "@/src/components/NativeMenu";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { MenuPresence } from "@/src/ui/MorphMenuSurface";
import { cronSummaryText, formatRunTime } from "@/src/components/ScheduleForm";
import { nextCronRuns, summarizeCron } from "@/src/data/cron";
import { useToast } from "@/src/components/Toast";
import { installSpaceMod } from "@/src/data/space-mods";
import { useAppActions } from "@/src/data/context";
import { deviceDisplayStateKey, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, phoneControlErrorKey, phoneControlStageKey, phoneControlSteps, type DeviceRuntimeRefusal, type PhoneControlState } from "@/src/data/device-runtime";
import { deviceCliStateKey } from "@/src/data/device-cli";
import { deviceRuntimeSupported, installDeviceCli, openDeviceControlSettings, pairPhoneControl, phoneControlSupported, setupPhoneControl, shareDeviceDisplay, startDeviceRuntime, stopDeviceDisplay, stopDeviceRuntime, useDeviceCliState, useDeviceDisplayStatus, useDeviceRuntimeInstances } from "@/src/platform/device-runtime";
import { useSpaceSettings, type SpaceEnvironmentItem, type SpaceSettingsResourceState } from "@/src/data/use-space-settings";
import { SETUP_STATUS, sandboxSetupInfo, sandboxSetupStatus } from "@/src/data/sandbox-setup";
import { formatUsd } from "@/src/data/space-wallet";
import { useTranslation, type Translate } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppSwitch, AppIcon, Avatar, FIELD_INPUT_CLASS, IconButton, Loader, Screen, Segmented, TopBar, type IconName } from "@/src/ui";

const SPEC_OPTIONS = ["standard", "boost", "ultra"] as const satisfies readonly SandboxSpecId[];
// Bounds and production default mirror the server's sandbox idle policy (sandbox-controller).
const MIN_IDLE_TTL_SECONDS = 60;
const MAX_IDLE_TTL_SECONDS = 30 * 86400;
const DEFAULT_IDLE_TTL_SECONDS = 12 * 3600;
const IDLE_TTL_PRESETS = [1800, 3600, 7200, 43200, 86400, 604800] as const;
const CUSTOM_TTL_UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type CustomTtlUnit = keyof typeof CUSTOM_TTL_UNITS;
/** Matches `SettingsRow`: 52 pt rows, a 30 pt leading tile, separators inset past it (16 + 30 + 12). */
const ROW_HEIGHT = 52;
const TILE = 30;
const TILE_STYLE = { width: TILE, height: TILE, borderCurve: "continuous" } as const;
const SEPARATOR_INSET = 58;
const CONTINUOUS = { borderCurve: "continuous" } as const;

export default function SpaceSettingsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useAppActions();
  const { env, setEnv, config, setConfig, sandbox, wallet, ports, allowedSpec, members, setMembers, invitations, setInvitations, mods, setMods, schedules, setSchedules, resources, loadResource } = useSpaceSettings(client, spaceId);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [visibleEnv, setVisibleEnv] = useState<Set<string>>(new Set());
  const [addModOpen, setAddModOpen] = useState(false);
  const [modSpaceId, setModSpaceId] = useState("");
  const [addingMod, setAddingMod] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const modSubmitLock = useRef(false);
  const [customTtlOpen, setCustomTtlOpen] = useState(false);
  const [customTtlValue, setCustomTtlValue] = useState("");
  const [customTtlUnit, setCustomTtlUnit] = useState<CustomTtlUnit>("hours");
  const [customTtlError, setCustomTtlError] = useState<string | null>(null);
  const [envOpen, setEnvOpen] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const idlePolicy = config?.autoDestroy.mode === "idle" ? config.autoDestroy : null;
  const sandboxBusy = busy || restarting || resources.config.loading;

  const openCustomTtl = () => {
    const seconds = idlePolicy?.ttlSeconds ?? DEFAULT_IDLE_TTL_SECONDS;
    const unit: CustomTtlUnit = seconds % 86400 === 0 ? "days" : seconds % 3600 === 0 ? "hours" : "minutes";
    setCustomTtlUnit(unit);
    setCustomTtlValue(String(Math.round(seconds / CUSTOM_TTL_UNITS[unit])));
    setCustomTtlError(null);
    setCustomTtlOpen(true);
  };

  const saveCustomTtl = () => {
    const amount = Number(customTtlValue.trim());
    const seconds = amount * CUSTOM_TTL_UNITS[customTtlUnit];
    if (!Number.isInteger(amount) || seconds < MIN_IDLE_TTL_SECONDS || seconds > MAX_IDLE_TTL_SECONDS) {
      setCustomTtlError(t("space.settings.sleep.invalid"));
      return;
    }
    setCustomTtlOpen(false);
    void updateSandbox({ autoDestroy: { mode: "idle", ttlSeconds: seconds } });
  };

  const addEnv = async () => {
    if (!client || !spaceId || !name.trim()) return;
    setBusy(true);
    try {
      const result = await client.space(spaceId).env.create({ name: name.trim(), value });
      setEnv(result.env);
      setEnvOpen(false);
      setName("");
      setValue("");
      toast({ title: t("space.settings.saved"), tone: "success" });
    } catch (error) {
      toast({ title: t("space.settings.saveFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const createInvite = async (role: "builder" | "guest") => {
    if (!client || !spaceId) return;
    try {
      const result = await client.space(spaceId).invitations.create({ role, ttlSeconds: 604800 });
      await Share.share({ title: t("space.settings.inviteTitle"), message: `https://cohub.live/invite/${result.token}` });
      setInvitations((current) => [...current, { token: result.token, role: result.role, status: "active" }]);
    } catch (error) {
      toast({ title: t("space.settings.inviteFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    }
  };

  const updateMemberRole = async (userId: string, role: "builder" | "guest") => {
    if (!client || !spaceId) return;
    try {
      const updated = await client.space(spaceId).members.update(userId, role);
      setMembers((current) => current.map((member) => member.userId === userId ? { ...member, role: updated.role } : member));
    } catch (error) {
      toast({ title: t("space.settings.memberUpdateFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    }
  };

  const removeMember = async (userId: string) => {
    if (!client || !spaceId) return;
    try {
      await client.space(spaceId).members.remove(userId);
      setMembers((current) => current.filter((member) => member.userId !== userId));
    } catch (error) {
      toast({ title: t("space.settings.memberRemoveFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    }
  };

  const updateSandbox = async (next: { spec?: SandboxSpecId; image?: SandboxImage | null; autoDestroy?: SpaceSandboxAutoDestroyPolicy }) => {
    if (!client || !spaceId) return;
    setBusy(true);
    try {
      const space = client.space(spaceId);
      const result = await space.updateConfig({ sandbox: next });
      const refreshed = await space.getConfig().catch(() => null);
      const sandbox = refreshed?.config.sandbox;
      const pendingRestart = next.spec || next.image !== undefined ? result.sandbox?.pendingRestart === true : false;
      if (sandbox) {
        setConfig({
          ...sandbox,
          specPendingRestart: pendingRestart || sandbox.specPendingRestart,
        });
      } else {
        // Without a fresh read, only the fields this screen owns are applied; preferences need the server.
        setConfig((current) => current ? {
          ...current,
          ...(next.spec ? { spec: next.spec } : {}),
          ...(next.autoDestroy ? { autoDestroy: next.autoDestroy } : {}),
          specPendingRestart: pendingRestart || current.specPendingRestart,
        } : current);
      }
      if (next.spec || next.image !== undefined) {
        toast({ title: specNeedsRestart(sandbox ?? null, pendingRestart) ? t("space.settings.spec.savedRestart") : t(next.spec ? "space.settings.spec.updated" : "space.settings.image.updated"), tone: "success" });
      } else {
        toast({ title: t("space.settings.saved"), tone: "success" });
      }
    } catch (error) {
      toast({ title: t("space.settings.saveFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const restartSandbox = async () => {
    if (!client || !spaceId) return;
    setRestarting(true);
    try {
      await client.space(spaceId).sandbox.recreate();
      const refreshed = await client.space(spaceId).getConfig().catch(() => null);
      if (refreshed?.config.sandbox) setConfig(refreshed.config.sandbox);
      else setConfig((current) => current ? { ...current, specPendingRestart: false, appliedSpec: current.spec ?? "standard" } : current);
      toast({ title: t("space.settings.sandbox.restarted"), tone: "success" });
    } catch (error) {
      toast({ title: t("space.settings.sandbox.restartFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setRestarting(false);
    }
  };

  const confirmRestart = () => {
    Alert.alert(
      t("space.settings.sandbox.restartConfirm.title"),
      t("space.settings.sandbox.restartConfirm.body"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("space.settings.spec.restartNow"), style: "destructive", onPress: () => void restartSandbox() },
      ],
    );
  };

  const addMod = async () => {
    if (!client || !spaceId || !modSpaceId.trim() || modSubmitLock.current) return;
    modSubmitLock.current = true;
    setAddingMod(true);
    setModError(null);
    try {
      const result = await installSpaceMod(client, spaceId, modSpaceId);
      // The create response is authoritative; a subsequent list failure must not invite a duplicate install.
      setMods((current) => [...current.filter((mod) => mod.id !== result.item.id), result.item]);
      setAddModOpen(false);
      setModSpaceId("");
      toast({ title: t("space.settings.modAdded"), message: t(result.sandboxRestarting ? "space.settings.modRestarting" : "space.settings.modAddedRestart"), tone: "success" });
    } catch (error) {
      setModError(error instanceof Error ? error.message : t("space.settings.modAddFailed"));
    } finally {
      modSubmitLock.current = false;
      setAddingMod(false);
    }
  };

  const sleepValue = idlePolicy ? String(idlePolicy.ttlSeconds) : "never";
  const sleepOptions = [
    { value: "never", label: t("space.settings.sleep.never") },
    ...idleTtlChoices(idlePolicy?.ttlSeconds ?? DEFAULT_IDLE_TTL_SECONDS).map((seconds) => ({ value: String(seconds), label: formatIdleTtl(seconds, t) })),
    { value: "custom", label: t("space.settings.sleep.custom") },
  ];
  const selectSleep = (next: string) => {
    if (next === "custom") openCustomTtl();
    else if (next === "never") void updateSandbox({ autoDestroy: { mode: "never" } });
    else void updateSandbox({ autoDestroy: { mode: "idle", ttlSeconds: Number(next) } });
  };
  const activeInvitations = invitations.filter((item) => item.status === "active").length;
  const portEntries = Object.entries(ports);

  return (
    <Screen>
      <TopBar title={t("space.settings")} onBack={() => router.back()} />
      <ScrollView contentContainerClassName="pt-4 pb-8" keyboardShouldPersistTaps="handled">
        <Section>
          <SettingsRow
            icon="wallet"
            title={t("space.wallet.title")}
            detail={wallet ? formatUsd(wallet.balanceUsd) : undefined}
            last
            onPress={() => router.push({ pathname: "/space/[spaceId]/wallet", params: { spaceId } })}
          />
        </Section>

        <Section label={t("space.settings.collaborators")} footer={activeInvitations > 0 ? t("space.settings.inviteCount", { count: activeInvitations }) : undefined}>
          <ResourceStatus state={resources.members} onRetry={() => void loadResource("members")} />
          {members.map((member) => {
            const displayName = memberDisplayName(member, t("settings.profile.fallbackName"));
            return (
              <Row
                key={member.userId}
                leading={<Avatar name={displayName} uri={member.profile?.avatarUrl} size={TILE} />}
                title={displayName}
                subtitle={roleLabel(member.role, t)}
                trailing={member.role !== "host" ? (
                  <MemberMenu
                    name={displayName}
                    actions={[
                      { icon: "user", title: member.role === "builder" ? t("space.settings.makeGuest") : t("space.settings.makeBuilder"), onPress: () => void updateMemberRole(member.userId, member.role === "builder" ? "guest" : "builder") },
                      { icon: "trash", title: t("space.settings.removeMember"), onPress: () => setRemoving({ userId: member.userId, name: displayName }) },
                    ]}
                  />
                ) : null}
              />
            );
          })}
          <ResourceStatus state={resources.invitations} onRetry={() => void loadResource("invitations")} />
          <AddRow label={t("space.settings.inviteBuilder")} onPress={() => void createInvite("builder")} />
          <AddRow label={t("space.settings.inviteGuest")} onPress={() => void createInvite("guest")} last />
        </Section>

        <Section label={t("space.settings.environment")}>
          <ResourceStatus state={resources.env} onRetry={() => void loadResource("env")} />
          {env.map((item) => (
            <EnvironmentRow
              key={item.name}
              item={item}
              visible={visibleEnv.has(item.name)}
              onToggle={() => setVisibleEnv((current) => {
                const next = new Set(current);
                if (next.has(item.name)) next.delete(item.name);
                else next.add(item.name);
                return next;
              })}
              onCopy={() => void Clipboard.setStringAsync(item.value).then(() => toast({ title: t("space.settings.copied"), tone: "success" }))}
            />
          ))}
          <AddRow label={t("space.settings.addEnvironment")} disabled={resources.env.loading} onPress={() => setEnvOpen(true)} last />
        </Section>

        {deviceRuntimeSupported && spaceId && sandbox?.provider === "local" ? <View className="mb-6 px-4"><DeviceRuntimeSection spaceId={spaceId} /></View> : null}

        {resources.config.loaded ? <>
          <Section label={t("space.settings.spec")}>
            <ResourceStatus state={resources.allowedSpec} onRetry={() => void loadResource("allowedSpec")} />
            <SpecOptionList
              config={config}
              value={config?.spec ?? "standard"}
              maxValue={allowedSpec}
              disabled={sandboxBusy || resources.allowedSpec.loading || !resources.allowedSpec.loaded}
              onChange={(spec) => void updateSandbox({ spec })}
              onLocked={() => toast({ title: t("space.settings.upgradeRequired"), message: t("space.settings.upgradeRequired.body"), tone: "danger" })}
            />
            {specNeedsRestart(config) ? (
              <Row
                leading={restarting ? <View className="items-center justify-center" style={TILE_STYLE}><Loader /></View> : <Tile icon="refresh" accent />}
                title={t("space.settings.spec.restartNow")}
                titleClassName="text-accent"
                subtitle={t("space.settings.spec.restartToApply")}
                disabled={restarting || busy}
                onPress={confirmRestart}
              />
            ) : null}
          </Section>
          {config?.preferences ? (
            <Section
              label={t("space.settings.image")}
              footer={config.preferences.applicable && config.preferences.warnings.includes("image_unavailable") ? t("space.settings.image.unavailable") : t(config.preferences.applicable ? "space.settings.image.hint" : "space.settings.image.local")}
            >
              <ImageOptionList preferences={config.preferences} disabled={sandboxBusy} onChange={(image) => void updateSandbox({ image })} />
            </Section>
          ) : null}
          <Section footer={idlePolicy ? t("space.settings.sleep.idleHint", { duration: formatIdleTtl(idlePolicy.ttlSeconds, t) }) : t("space.settings.sleep.neverHint")}>
            <SettingsSelectRow
              icon="moon"
              title={t("space.settings.sleep")}
              value={sleepValue}
              options={sleepOptions}
              disabled={sandboxBusy}
              onChange={selectSleep}
            />
            <SettingsRow
              icon="terminal"
              title={t("space.setup.title")}
              detail={sandbox?.provider === "local" ? undefined : t(SETUP_STATUS[sandboxSetupStatus(sandboxSetupInfo(sandbox?.meta))].label)}
              last
              onPress={() => router.push({ pathname: "/space/[spaceId]/setup", params: { spaceId } })}
            />
          </Section>
        </> : resources.config.loading || resources.config.error ? (
          <Section label={t("space.settings.sandbox")}>
            <ResourceStatus state={resources.config} onRetry={() => void loadResource("config")} />
          </Section>
        ) : null}

        {portEntries.length > 0 || resources.ports.loading || resources.ports.error ? (
          <Section label={t("space.settings.ports")}>
            <ResourceStatus state={resources.ports} onRetry={() => void loadResource("ports")} />
            {portEntries.map(([key, endpoint], index) => (
              <Row
                key={key}
                leading={<Tile icon="globe" />}
                title={t("space.settings.portLabel", { port: key })}
                subtitle={endpoint.url ?? t("space.settings.portUnavailable")}
                middleEllipsis
                role="link"
                trailing={endpoint.url ? <AppIcon name="external-link" size={16} tone="faint" /> : null}
                onPress={endpoint.url ? () => void openWebLink(endpoint.url!).catch(() => Linking.openURL(endpoint.url!)) : undefined}
                last={index === portEntries.length - 1}
              />
            ))}
          </Section>
        ) : null}

        <Section label={t("space.settings.mods")}>
          <ResourceStatus state={resources.mods} onRetry={() => void loadResource("mods")} />
          {mods.map((mod) => (
            <Row
              key={mod.id}
              leading={<Tile icon="layers" />}
              title={mod.name || mod.mountSlug}
              subtitle={mod.mountPath}
              detail={`Space: ${mod.modSpaceId}`}
              trailing={
                <AppSwitch
                  value={mod.enabled}
                  onValueChange={async (enabled) => {
                    if (!client || !spaceId) return;
                    const space = client.space(spaceId);
                    try {
                      await space.mods.update(mod.id, { enabled });
                      setMods((current) => current.map((m) => m.id === mod.id ? { ...m, enabled } : m));
                      toast({ title: enabled ? t("space.settings.modEnabled") : t("space.settings.modDisabled"), tone: "success" });
                      if (enabled) {
                        Alert.alert(t("space.settings.modEnabled"), t("space.settings.modEnabledRestart"));
                      }
                    } catch (error) {
                      toast({ title: t("space.settings.modToggleFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
                    }
                  }}
                />
              }
            />
          ))}
          <AddRow
            label={t("space.settings.addMod")}
            disabled={!client || !spaceId || resources.mods.loading}
            onPress={() => { setModError(null); setAddModOpen(true); }}
            last
          />
        </Section>

        <Section label={t("space.settings.schedules")}>
          <ResourceStatus state={resources.schedules} onRetry={() => void loadResource("schedules")} />
          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              onPress={() => router.push({ pathname: "/space/[spaceId]/schedule/[jobId]", params: { spaceId, jobId: schedule.id } })}
              onToggle={async (enabled) => {
                if (!client) return;
                try {
                  await client.cronJobs.toggle(schedule.id, enabled);
                  setSchedules((current) => current.map((s) => s.id === schedule.id ? { ...s, enabled } : s));
                  toast({ title: enabled ? t("space.settings.schedule.enabled") : t("space.settings.schedule.disabled"), tone: "success" });
                } catch (error) {
                  toast({ title: t("space.settings.schedule.toggleFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
                }
              }}
            />
          ))}
          <AddRow label={t("schedule.newTitle")} disabled={!spaceId} onPress={() => router.push({ pathname: "/space/[spaceId]/schedule/new", params: { spaceId } })} last />
        </Section>
      </ScrollView>
      <AdaptiveSheet
        visible={addModOpen}
        detent="fit"
        title={t("space.settings.addMod")}
        subtitle={t("space.settings.addModPrompt")}
        onClose={() => setAddModOpen(false)}
        dismissible={!addingMod}
        confirm={{ label: t("space.settings.addMod"), loading: addingMod, disabled: !client || !modSpaceId.trim(), onPress: () => void addMod() }}
        testID="space-add-mod-sheet"
      >
        <View className="gap-3">
          <TextInput
            testID="space-add-mod-input"
            value={modSpaceId}
            onChangeText={setModSpaceId}
            accessibilityLabel={t("space.settings.addModPrompt")}
            placeholder={t("space.settings.addModPrompt")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!addingMod}
            returnKeyType="done"
            onSubmitEditing={() => void addMod()}
            className={FIELD_INPUT_CLASS}
          />
          {modError ? <Text selectable accessibilityLiveRegion="polite" className="text-caption text-danger">{modError}</Text> : null}
        </View>
      </AdaptiveSheet>
      <AdaptiveSheet
        visible={customTtlOpen}
        detent="fit"
        title={t("space.settings.sleep.customTitle")}
        subtitle={t("space.settings.sleep.customPrompt")}
        onClose={() => setCustomTtlOpen(false)}
        confirm={{ label: t("common.save"), disabled: !customTtlValue.trim(), onPress: saveCustomTtl }}
      >
        <View className="gap-3">
          <TextInput
            value={customTtlValue}
            onChangeText={(text) => { setCustomTtlValue(text.replace(/[^0-9]/g, "")); setCustomTtlError(null); }}
            accessibilityLabel={t("space.settings.sleep.customTitle")}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={saveCustomTtl}
            className={FIELD_INPUT_CLASS}
          />
          <Segmented
            value={customTtlUnit}
            onChange={(unit) => { setCustomTtlUnit(unit); setCustomTtlError(null); }}
            options={[
              { value: "minutes", label: t("space.settings.sleep.unit.minutes") },
              { value: "hours", label: t("space.settings.sleep.unit.hours") },
              { value: "days", label: t("space.settings.sleep.unit.days") },
            ]}
          />
          {customTtlError ? <Text accessibilityRole="alert" className="text-caption text-danger">{customTtlError}</Text> : null}
        </View>
      </AdaptiveSheet>
      <AdaptiveSheet
        visible={envOpen}
        detent="fit"
        title={t("space.settings.addEnvironment")}
        onClose={() => setEnvOpen(false)}
        dismissible={!busy}
        confirm={{ label: t("space.settings.addEnvironment"), loading: busy, disabled: !name.trim(), onPress: () => void addEnv() }}
        testID="space-add-env-sheet"
      >
        <View className="gap-3">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="NAME"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel={t("space.settings.env.name")}
            className={FIELD_INPUT_CLASS}
          />
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={t("space.settings.env.value")}
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            accessibilityLabel={t("space.settings.env.value")}
            returnKeyType="done"
            onSubmitEditing={() => void addEnv()}
            className={FIELD_INPUT_CLASS}
          />
        </View>
      </AdaptiveSheet>
      <ConfirmSheet
        visible={removing !== null}
        title={t("space.settings.removeMember.title", { name: removing?.name ?? "" })}
        message={t("space.settings.removeMember.body")}
        confirmLabel={t("common.remove")}
        confirmIcon="trash"
        onConfirm={() => { if (removing) void removeMember(removing.userId); setRemoving(null); }}
        onClose={() => setRemoving(null)}
        testID="space-remove-member-sheet"
      />
    </Screen>
  );
}

function ResourceStatus({ state, onRetry }: { state: SpaceSettingsResourceState; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state.loading) return <View className="min-h-13 flex-row items-center gap-3 px-4"><Loader /><Text accessibilityLiveRegion="polite" className="text-subhead text-fg-muted">{t("space.settings.loading")}</Text></View>;
  if (!state.error) return null;
  return <View className="min-h-13 flex-row items-center gap-2 pl-4 pr-1"><Text selectable accessibilityRole="alert" className="flex-1 py-3 text-subhead text-danger">{state.error}</Text><IconButton name="refresh" label={t("common.retry")} onPress={onRetry} /></View>;
}

/** An inset grouped card under a section label, as `SettingsGroup`, with an optional footnote below it. */
function Section({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  return (
    <View className="mb-6 px-4">
      {label ? <Text accessibilityRole="header" className="px-4 pb-2 text-caption font-semibold text-fg-muted">{label}</Text> : null}
      <View className="overflow-hidden rounded-md bg-surface" style={CONTINUOUS}>{children}</View>
      {footer ? <Text className="px-4 pt-2 text-caption text-fg-muted">{footer}</Text> : null}
    </View>
  );
}

/** The neutral glyph tile `SettingsRow` uses, so custom rows line up with it. */
function Tile({ icon, accent = false }: { icon: IconName; accent?: boolean }) {
  return <View className="items-center justify-center rounded-xs bg-surface-raised" style={TILE_STYLE}><AppIcon name={icon} size={18} tone={accent ? "accent" : "secondary"} /></View>;
}

/** A grouped row with a 30 pt leading slot, so its separator lines up with `SettingsRow`. */
function Row({ leading, title, titleClassName = "text-fg", subtitle, detail, middleEllipsis = false, trailing, onPress, role = "button", disabled = false, last = false }: {
  leading: ReactNode;
  title: string;
  titleClassName?: string;
  subtitle?: string;
  detail?: string;
  middleEllipsis?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
  role?: "button" | "link";
  disabled?: boolean;
  last?: boolean;
}) {
  const body = <>
    <View className="min-w-0 flex-1 flex-row items-center gap-3 py-2" style={{ minHeight: ROW_HEIGHT }}>
      {leading}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className={`text-body ${titleClassName}`}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} ellipsizeMode={middleEllipsis ? "middle" : "tail"} className="text-caption text-fg-muted">{subtitle}</Text> : null}
        {detail ? <Text numberOfLines={1} ellipsizeMode="middle" className="text-micro tabular-nums text-fg-faint">{detail}</Text> : null}
      </View>
      {trailing}
    </View>
    {last ? null : <View className="absolute bottom-0 right-0 bg-border" style={{ left: SEPARATOR_INSET, height: StyleSheet.hairlineWidth }} />}
  </>;
  return onPress
    ? <Pressable accessibilityRole={role} accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className="flex-row items-center bg-surface px-4 active:bg-surface-pressed disabled:opacity-55">{body}</Pressable>
    : <View className="flex-row items-center bg-surface px-4">{body}</View>;
}

/** An action row at the end of a group, as iOS Settings closes a list with "Add…". */
function AddRow({ label, onPress, disabled = false, last = false }: { label: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  return <Row leading={<Tile icon="plus" accent />} title={label} titleClassName="text-accent" onPress={onPress} disabled={disabled} last={last} />;
}

function MemberMenu({ name, actions }: { name: string; actions: readonly AnchoredMenuAction[] }) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const label = t("space.settings.memberActions", { name });
  if (nativeMenus) return <NativeMenuButton appearance="plain" icon="more" label={label} actions={actions} />;
  return <>
    <View ref={anchorRef} collapsable={false} className={open ? "opacity-0" : undefined}>
      <IconButton name="more" label={label} onPress={() => setOpen(true)} />
    </View>
    <MenuPresence open={open}><AnchoredActionMenu anchorRef={anchorRef} title={name} actions={actions} onClose={() => setOpen(false)} testID="space-member-menu" /></MenuPresence>
  </>;
}

function EnvironmentRow({ item, visible, onToggle, onCopy }: { item: SpaceEnvironmentItem; visible: boolean; onToggle: () => void; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <Row
      leading={<Tile icon="code" />}
      title={item.name}
      subtitle={visible ? item.value : "•".repeat(Math.min(16, Math.max(8, item.value.length)))}
      onPress={onCopy}
      trailing={<IconButton name={visible ? "eye-off" : "eye"} label={visible ? t("space.settings.hideValue") : t("space.settings.showValue")} onPress={onToggle} />}
    />
  );
}

function DeviceRuntimeSection({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const instance = useDeviceRuntimeInstances()?.find((item) => item.spaceId === spaceId) ?? null;
  const running = isDeviceRuntimeRunning(instance);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const update = async (action: () => Promise<DeviceRuntimeRefusal | "declined" | null> | void) => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      const refusal = await action();
      if (refusal) setHint(t(deviceRuntimeRefusalKey(refusal)));
    } catch {
      setHint(t("deviceRuntime.error.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text className="text-headline font-semibold text-fg">{t("deviceRuntime.thisDevice")}</Text>
      <Text className="text-caption text-fg-muted mt-2">{t("deviceRuntime.hint")}</Text>
      <View className="flex-row items-center gap-2 p-4 mt-2 rounded-md bg-surface-raised">
        <AppIcon name="smartphone" size={18} tone={instance?.state === "ready" ? "success" : "muted"} />
        <View className="flex-1 min-w-0">
          <Text className={`text-body font-semibold ${instance?.state === "error" ? "text-danger" : "text-fg"}`}>{t(deviceRuntimeStateKey(instance))}</Text>
          {instance ? <Text selectable className="text-caption text-fg-muted mt-1">{instance.label}</Text> : null}
        </View>
        {busy || instance?.state === "connecting" ? <Loader /> : null}
      </View>
      {hint ? <Text accessibilityRole="alert" className="text-caption text-danger mt-2">{hint}</Text> : null}
      <DeviceCliLine />
      <View className="flex-row gap-2 mt-3">
        {running ? (
          <ActionButton label={t("deviceRuntime.disconnect")} icon="x" disabled={busy} onPress={() => void update(() => stopDeviceRuntime(spaceId))} />
        ) : instance ? (
          <>
            <ActionButton label={t("deviceRuntime.connect")} icon="wifi" disabled={busy} onPress={() => void update(() => startDeviceRuntime(spaceId, instance.root))} />
            <ActionButton label={t("deviceRuntime.changeFolder")} icon="folder" disabled={busy} onPress={() => setPicking(true)} />
          </>
        ) : (
          <ActionButton label={t("deviceRuntime.chooseFolder")} icon="folder" disabled={busy} onPress={() => setPicking(true)} />
        )}
      </View>
      <DeviceDisplayBlock spaceId={spaceId} serving={running} />
      <DeviceFolderPickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onSelect={(folder) => {
          setPicking(false);
          void update(() => startDeviceRuntime(spaceId, folder.path));
        }}
      />
    </View>
  );
}

function DeviceDisplayBlock({ spaceId, serving }: { spaceId: string; serving: boolean }) {
  const { t } = useTranslation();
  const status = useDeviceDisplayStatus();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  if (!status) return null;
  const sharingHere = status.sharedWith === spaceId;
  const phone = phoneControlSupported ? status.phoneControl : null;
  // Without phone control the screen is shared by recording, which needs the person to leave the phone to agents.
  const phoneReady = !phone || phone.stage === "ready";

  const update = async (action: () => Promise<"declined" | "failed" | null> | void) => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      const outcome = await action();
      if (outcome) setHint(t(outcome === "declined" ? "deviceRuntime.display.declined" : "deviceRuntime.display.failed"));
    } catch {
      setHint(t("deviceRuntime.display.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-5">
      {phone ? <PhoneControlBlock state={phone} /> : null}
      <Text className={`text-body font-semibold text-fg ${phone ? "mt-5" : ""}`}>{t("deviceRuntime.display.title")}</Text>
      <Text className="text-caption text-fg-muted mt-2">{t(serving ? "deviceRuntime.display.hint" : "deviceRuntime.display.connectFirst")}</Text>
      <View className="flex-row items-center gap-2 p-4 mt-2 rounded-md bg-surface-raised">
        <AppIcon name="monitor" size={18} tone={sharingHere ? "success" : "muted"} />
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-fg">{t(deviceDisplayStateKey(status, spaceId))}</Text>
          {status.sharedWith && !sharingHere ? <Text className="text-caption text-fg-muted mt-1">{t("deviceRuntime.display.sharedElsewhere")}</Text> : null}
        </View>
        {busy ? <Loader /> : null}
      </View>
      {hint ? <Text accessibilityRole="alert" className="text-caption text-danger mt-2">{hint}</Text> : null}
      <View className="flex-row gap-2 mt-3">
        {sharingHere ? (
          <>
            <ActionButton label={t("deviceRuntime.display.stop")} icon="x" disabled={busy} onPress={() => void update(stopDeviceDisplay)} />
            {!status.control ? <ActionButton label={t("deviceRuntime.display.allowControl")} icon="settings" disabled={busy} onPress={() => void update(openDeviceControlSettings)} /> : null}
          </>
        ) : (
          <ActionButton label={t(phoneReady ? "deviceRuntime.display.share" : "deviceRuntime.display.shareRecording")} icon="monitor" disabled={busy || !serving} onPress={() => void update(() => shareDeviceDisplay(spaceId))} />
        )}
      </View>
      {!sharingHere && !phoneReady ? <Text className="text-caption text-fg-muted mt-2">{t("deviceRuntime.display.shareRecordingHint")}</Text> : null}
      {sharingHere && !status.control ? <Text className="text-caption text-fg-muted mt-2">{t("deviceRuntime.display.controlHint")}</Text> : null}
    </View>
  );
}

function DeviceCliLine() {
  const { t } = useTranslation();
  const state = useDeviceCliState();
  const key = state ? deviceCliStateKey(state) : null;
  if (!state || !key) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 mt-2">
      <Text className={`text-caption ${state.error && state.status !== "installing" ? "text-danger" : "text-fg-muted"}`}>
        {t(key, { version: state.version ?? "", percent: String(Math.round((state.progress ?? 0) * 100)) })}
      </Text>
      {state.error && state.status !== "installing" ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("deviceRuntime.cli.retry")} hitSlop={12} onPress={() => void installDeviceCli().catch(() => undefined)}>
          <Text className="text-caption font-semibold text-accent">{t("deviceRuntime.cli.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PhoneControlBlock({ state }: { state: PhoneControlState }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");
  const steps = phoneControlSteps(state);
  const errorKey = phoneControlErrorKey(state);
  const canSetup = state.stage !== "starting" && state.stage !== "ready";
  const codeInput = state.stage === "code" && state.codeInput;

  const run = async (action: () => Promise<null>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const pair = (value: string) => {
    if (value.length !== 6) return;
    setCode("");
    void run(() => pairPhoneControl(value));
  };

  return (
    <View>
      <Text className="text-body font-semibold text-fg">{t("deviceRuntime.phoneControl.title")}</Text>
      <Text className="text-caption text-fg-muted mt-2">{t("deviceRuntime.phoneControl.hint")}</Text>
      <View className="flex-row items-center gap-2 p-4 mt-2 rounded-md bg-surface-raised">
        <AppIcon name="smartphone" size={18} tone={state.stage === "ready" ? "success" : "muted"} />
        <Text className="flex-1 min-w-0 text-body font-semibold text-fg">{t(phoneControlStageKey(state))}</Text>
        {busy || state.stage === "starting" ? <Loader /> : null}
      </View>
      {failed || errorKey ? <Text accessibilityRole="alert" className="text-caption text-danger mt-2">{t(failed ? "deviceRuntime.phoneControl.failed" : errorKey!)}</Text> : null}
      {state.error && state.detail ? <Text selectable className="text-caption text-fg-faint mt-1">{state.detail}</Text> : null}
      {steps ? (
        <View className="gap-2 mt-3">
          {steps.map((step, index) => (
            <View key={step.key} accessibilityState={{ selected: step.current }} className="flex-row gap-2">
              {step.done
                ? <AppIcon name="check" size={16} tone="success" />
                : <Text className={`w-4 text-center text-caption ${step.current ? "font-semibold text-fg" : "text-fg-faint"}`}>{index + 1}</Text>}
              <Text className={`flex-1 text-caption ${step.current ? "text-fg" : "text-fg-muted"}`}>{t(step.key)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {codeInput ? (
        <View className="flex-row gap-2 mt-3">
          <TextInput
            value={code}
            onChangeText={(text) => {
              const digits = text.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6) pair(digits);
            }}
            accessibilityLabel={t("deviceRuntime.phoneControl.codeLabel")}
            placeholder="······"
            placeholderTextColor={theme.colors.textFaint}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            editable={!busy}
            onSubmitEditing={() => pair(code)}
            className={`${FIELD_INPUT_CLASS} flex-1 tracking-widest`}
          />
          <ActionButton label={t("deviceRuntime.phoneControl.pair")} disabled={busy || code.length !== 6} onPress={() => pair(code)} />
        </View>
      ) : null}
      {canSetup && !codeInput ? (
        <View className="flex-row gap-2 mt-3">
          <ActionButton label={t(steps ? "deviceRuntime.phoneControl.openSettings" : "deviceRuntime.phoneControl.setup")} icon="settings" disabled={busy} onPress={() => void run(setupPhoneControl)} />
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({ label, icon, onPress, disabled = false }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-sm bg-surface-raised px-3 active:bg-surface-pressed disabled:opacity-45"
    >
      {icon ? <AppIcon name={icon} size={16} tone="accent" /> : null}
      <Text numberOfLines={1} className="text-caption text-fg shrink">{label}</Text>
    </Pressable>
  );
}

function SpecOptionList({
  config,
  value,
  maxValue,
  disabled,
  onChange,
  onLocked,
}: {
  config: SpaceSandboxConfig | null;
  value: SandboxSpecId;
  maxValue: SandboxSpecId;
  disabled: boolean;
  onChange: (value: SandboxSpecId) => void;
  onLocked: () => void;
}) {
  const { t } = useTranslation();
  const max = Math.max(0, SPEC_OPTIONS.indexOf(maxValue));
  return (
    <View accessibilityRole="radiogroup">
      {SPEC_OPTIONS.map((id, index) => {
        const selected = id === value;
        // Tiers above the plan's maximum stay visible but locked, so the upgrade path reads in place.
        const locked = index > max;
        const details = specDetails(config, id);
        const label = t(`space.settings.spec.${id}`);
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityLabel={[label, details.resources, locked ? details.requiredPlan : null].filter(Boolean).join(", ")}
            accessibilityState={{ checked: selected, disabled: disabled || locked }}
            disabled={disabled}
            onPress={() => {
              if (locked) onLocked();
              else if (!selected) onChange(id);
            }}
            className={`min-h-16 flex-row items-center gap-3 bg-surface px-4 py-3 active:bg-surface-pressed ${disabled ? "opacity-60" : ""}`}
          >
            {index > 0 ? <View className="absolute left-4 right-0 top-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} /> : null}
            <View className={`flex-1 min-w-0 ${locked ? "opacity-55" : ""}`}>
              <View className="flex-row items-center gap-2">
                <Text numberOfLines={1} className="shrink text-body font-semibold text-fg">{label}</Text>
                {locked && details.requiredPlan ? (
                  <View className="rounded-full bg-accent-soft px-2 py-0.5">
                    <Text className="text-micro font-semibold text-accent">{details.requiredPlan}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-caption text-fg-muted mt-0.5">{t(`space.settings.spec.${id}.desc`)}</Text>
            </View>
            {details.resources ? <Text className={`text-caption tabular-nums ${selected ? "text-fg" : "text-fg-muted"} ${locked ? "opacity-55" : ""}`}>{details.resources}</Text> : null}
            <View className="w-5 items-center">{selected ? <AppIcon name="check" size={18} tone="accent" strokeWidth={2.4} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

type SandboxImage = NonNullable<SpaceSandboxConfig["image"]>;
type SandboxPreferences = NonNullable<SpaceSandboxConfig["preferences"]>;

function imageLabel(image: SandboxImage, t: Translate) {
  return t(image === "game" ? "space.settings.image.game" : "space.settings.image.default");
}

/** "Follow" keeps the project and Mod preference; picking an image overrides it for this Space. */
function ImageOptionList({ preferences, disabled, onChange }: { preferences: SandboxPreferences; disabled: boolean; onChange: (image: SandboxImage | null) => void }) {
  const { t } = useTranslation();
  const inherited = [...preferences.sources].reverse().find((source) => source.source !== "override" && source.preferences.image)?.preferences.image ?? "default";
  const current = preferences.overrides.image ?? null;
  const options: { value: SandboxImage | null; label: string }[] = [
    { value: null, label: t("space.settings.image.follow", { image: imageLabel(inherited, t) }) },
    ...preferences.images.map((image) => ({ value: image, label: imageLabel(image, t) })),
  ];
  const locked = disabled || !preferences.applicable;
  return (
    <View accessibilityRole="radiogroup">
      {options.map((option, index) => {
        const selected = option.value === current;
        return (
          <Pressable
            key={option.value ?? "follow"}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled: locked }}
            disabled={locked}
            onPress={() => { if (!selected) onChange(option.value); }}
            className={`min-h-13 flex-row items-center gap-3 bg-surface px-4 py-3 active:bg-surface-pressed ${locked ? "opacity-60" : ""}`}
          >
            {index > 0 ? <View className="absolute left-4 right-0 top-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} /> : null}
            <Text className="min-w-0 flex-1 text-body text-fg">{option.label}</Text>
            <View className="w-5 items-center">{selected ? <AppIcon name="check" size={18} tone="accent" strokeWidth={2.4} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ScheduleRow({ schedule, onPress, onToggle }: { schedule: CronJobRecord; onPress: () => void; onToggle: (enabled: boolean) => Promise<void> }) {
  const { t, locale } = useTranslation();
  const [toggling, setToggling] = useState(false);
  // The record carries no run history, so the row previews the next run from the expression, as the detail screen does.
  const nextRun = useMemo(() => schedule.enabled ? nextCronRuns(schedule.cronExpression, schedule.timezone, 1)[0] : undefined, [schedule.cronExpression, schedule.enabled, schedule.timezone]);
  
  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await onToggle(enabled);
    } finally {
      setToggling(false);
    }
  };

  const title = schedule.title || t("space.settings.schedule.unnamed");
  return (
    <Row
      leading={<Tile icon="clock" />}
      title={title}
      subtitle={cronSummaryText(summarizeCron(schedule.cronExpression), schedule.cronExpression, t)}
      detail={nextRun ? `${t("space.settings.schedule.nextRun")}: ${formatRunTime(nextRun, schedule.timezone, locale)}` : undefined}
      onPress={onPress}
      trailing={<AppSwitch value={schedule.enabled} onValueChange={handleToggle} disabled={toggling} />}
    />
  );
}

function memberDisplayName(member: SpaceMember, fallback: string) {
  const displayName = member.profile?.displayName?.trim();
  const username = member.profile?.username?.trim();
  if (displayName && displayName !== member.userId) return displayName;
  if (username) return username;
  return fallback;
}

function roleLabel(role: SpaceRole, t: Translate) {
  if (role === "host") return t("space.settings.role.host");
  if (role === "builder") return t("space.settings.role.builder");
  return t("space.settings.role.guest");
}

function specNeedsRestart(config: SpaceSandboxConfig | null, pendingFromUpdate = false) {
  if (pendingFromUpdate) return true;
  if (!config) return false;
  if (config.specPendingRestart || config.preferences?.pendingRestart) return true;
  const spec = config.spec ?? "standard";
  return Boolean(config.appliedSpec && config.appliedSpec !== spec);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the server-provided spec catalog (`config.specs`), which the SDK types as `unknown`. */
function specDetails(config: SpaceSandboxConfig | null, id: SandboxSpecId): { resources: string | null; requiredPlan: string | null } {
  const spec = config?.specs?.[id];
  if (!isRecord(spec)) return { resources: null, requiredPlan: null };
  const limits = isRecord(spec.resources) && isRecord(spec.resources.limits) ? spec.resources.limits : null;
  const cpu = typeof limits?.cpu === "string" ? limits.cpu : null;
  const memory = typeof limits?.memory === "string" ? limits.memory.replace(/^(\d+(?:\.\d+)?)Gi$/, "$1 GB").replace(/^(\d+)Mi$/, "$1 MB") : null;
  return {
    resources: cpu && memory ? `${cpu} vCPU · ${memory}` : null,
    requiredPlan: typeof spec.requiredPlan === "string" ? spec.requiredPlan : null,
  };
}

function idleTtlChoices(current: number) {
  const presets: number[] = [...IDLE_TTL_PRESETS];
  // A value set elsewhere (web, CLI) stays visible and selected instead of snapping to a preset.
  return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}

function formatIdleTtl(seconds: number, t: Translate) {
  if (seconds % 86400 === 0) return t("space.settings.sleep.days", { count: seconds / 86400 });
  if (seconds % 3600 === 0) return t("space.settings.sleep.hours", { count: seconds / 3600 });
  if (seconds % 60 === 0) return t("space.settings.sleep.minutes", { count: seconds / 60 });
  return t("space.settings.sleep.seconds", { count: seconds });
}
