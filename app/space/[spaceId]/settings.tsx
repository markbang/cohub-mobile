import * as Clipboard from "expo-clipboard";
import type { CronJobRecord, SandboxSpecId, SpaceMember, SpaceRole, SpaceSandboxAutoDestroyPolicy, SpaceSandboxConfig } from "@neta-art/cohub";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { DeviceFolderPickerSheet } from "@/src/components/DeviceFolderBrowser";
import { FilterChip } from "@/src/components/FilterChip";
import { SettingsRow } from "@/src/components/SettingsRow";
import { cronSummaryText } from "@/src/components/ScheduleForm";
import { summarizeCron } from "@/src/data/cron";
import { useToast } from "@/src/components/Toast";
import { installSpaceMod } from "@/src/data/space-mods";
import { useApp } from "@/src/data/context";
import { deviceDisplayStateKey, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, type DeviceRuntimeRefusal } from "@/src/data/device-runtime";
import { deviceRuntimeSupported, openDeviceControlSettings, shareDeviceDisplay, startDeviceRuntime, stopDeviceDisplay, stopDeviceRuntime, useDeviceDisplayStatus, useDeviceRuntimeInstances } from "@/src/platform/device-runtime";
import { useSpaceSettings, type SpaceEnvironmentItem, type SpaceSettingsResourceState } from "@/src/data/use-space-settings";
import { SETUP_STATUS, sandboxSetupInfo, sandboxSetupStatus } from "@/src/data/sandbox-setup";
import { formatWalletUsd } from "@/src/data/space-wallet";
import { useTranslation, type Translate } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppSwitch, AppIcon, Avatar, FIELD_INPUT_CLASS, IconButton, Loader, Screen, Segmented, TopBar, type IconName } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

const SPEC_OPTIONS = ["standard", "boost", "ultra"] as const satisfies readonly SandboxSpecId[];
// Bounds and production default mirror the server's sandbox idle policy (sandbox-controller).
const MIN_IDLE_TTL_SECONDS = 60;
const MAX_IDLE_TTL_SECONDS = 30 * 86400;
const DEFAULT_IDLE_TTL_SECONDS = 12 * 3600;
const IDLE_TTL_PRESETS = [1800, 3600, 7200, 43200, 86400, 604800] as const;
const CUSTOM_TTL_UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type CustomTtlUnit = keyof typeof CUSTOM_TTL_UNITS;

export default function SpaceSettingsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
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
  // Schedules, the wallet, and the startup report change on the screens this one opens.
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focused.current) for (const key of ["schedules", "wallet", "sandbox", "config"] as const) void loadResource(key);
    focused.current = true;
  }, [loadResource]));
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
      setName("");
      setValue("");
      toast({ title: t("space.settings.saved") });
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
        toast({ title: specNeedsRestart(sandbox ?? null, pendingRestart) ? t("space.settings.spec.savedRestart") : t(next.spec ? "space.settings.spec.updated" : "space.settings.image.updated") });
      } else {
        toast({ title: t("space.settings.saved") });
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
      toast({ title: t("space.settings.sandbox.restarted") });
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
      toast({ title: t("space.settings.modAdded"), message: t(result.sandboxRestarting ? "space.settings.modRestarting" : "space.settings.modAddedRestart") });
    } catch (error) {
      setModError(error instanceof Error ? error.message : t("space.settings.modAddFailed"));
    } finally {
      modSubmitLock.current = false;
      setAddingMod(false);
    }
  };

  return (
    <Screen>
      <TopBar title={t("space.settings")} onBack={() => router.back()} />
      <ScrollView contentContainerClassName="gap-6 p-4" keyboardShouldPersistTaps="handled">
        <View className="overflow-hidden rounded-md" style={{ borderCurve: "continuous" }}>
          <SettingsRow
            icon="wallet"
            title={t("space.wallet.title")}
            detail={wallet ? formatWalletUsd(wallet.balanceUsd, locale) : undefined}
            last
            onPress={() => router.push({ pathname: "/space/[spaceId]/wallet", params: { spaceId } })}
          />
        </View>

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.collaborators")}</Text>
          <ResourceStatus state={resources.members} onRetry={() => void loadResource("members")} />
          {members.map((member) => {
            const displayName = memberDisplayName(member, t("settings.profile.fallbackName"));
            return (
              <View key={member.userId} className="flex-row items-center gap-2 py-2 border-b border-border">
                <Avatar name={displayName} uri={member.profile?.avatarUrl} size={36} />
                <View className="flex-1 min-w-0 gap-0.5">
                  <Text numberOfLines={1} className="text-body font-semibold text-fg">{displayName}</Text>
                  <Text className="text-caption text-fg-muted">{roleLabel(member.role, t)}</Text>
                </View>
                {member.role !== "host" ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void updateMemberRole(member.userId, member.role === "builder" ? "guest" : "builder")}
                      hitSlop={8}
                      className="active:opacity-60"
                    >
                      <Text className="text-caption text-accent">
                        {member.role === "builder" ? t("space.settings.makeGuest") : t("space.settings.makeBuilder")}
                      </Text>
                    </Pressable>
                    <IconButton name="x" label={t("space.settings.removeMember")} tone="danger" onPress={() => void removeMember(member.userId)} />
                  </>
                ) : null}
              </View>
            );
          })}
          <ResourceStatus state={resources.invitations} onRetry={() => void loadResource("invitations")} />
          <View className="flex-row gap-2 mt-3">
            <ActionButton label={t("space.settings.inviteBuilder")} icon="plus" onPress={() => void createInvite("builder")} />
            <ActionButton label={t("space.settings.inviteGuest")} icon="plus" onPress={() => void createInvite("guest")} />
          </View>
          {invitations.filter((item) => item.status === "active").map((item) => (
            <Text key={item.token} className="text-micro font-semibold text-fg-muted mt-2">
              {t("space.settings.inviteActive", { role: roleLabel(item.role, t) })}
            </Text>
          ))}
        </View>

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.environment")}</Text>
          <ResourceStatus state={resources.env} onRetry={() => void loadResource("env")} />
          <View className="flex-row gap-2 mt-3 items-center">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="NAME"
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="NAME"
              className={`flex-1 ${FIELD_INPUT_CLASS}`}
            />
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="VALUE"
              placeholderTextColor={theme.colors.textFaint}
              autoCorrect={false}
              accessibilityLabel="VALUE"
              className={`flex-1 ${FIELD_INPUT_CLASS}`}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("space.settings.addEnvironment")}
              disabled={busy || resources.env.loading || !name.trim()}
              onPress={() => void addEnv()}
              className="size-12 items-center justify-center rounded-sm bg-accent active:bg-accent-pressed disabled:opacity-45"
            >
              <AppIcon name="plus" size={18} tone="onAccent" />
            </Pressable>
          </View>
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
              onCopy={() => void Clipboard.setStringAsync(item.value).then(() => toast({ title: t("space.settings.copied") }))}
            />
          ))}
        </View>

        {deviceRuntimeSupported && spaceId && sandbox?.provider === "local" ? <DeviceRuntimeSection spaceId={spaceId} /> : null}

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.sandbox")}</Text>
          <ResourceStatus state={resources.config} onRetry={() => void loadResource("config")} />
          {resources.config.loaded ? <>
          <Text className="text-caption text-fg-muted mt-2">{t("space.settings.spec")}</Text>
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
            <View className="flex-row items-center flex-wrap gap-2 mt-2">
              <View className="px-2 py-1 rounded-full bg-warning-soft">
                <Text className="text-micro font-semibold text-warning">{t("space.settings.spec.restartToApply")}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("space.settings.spec.restartNow")}
                disabled={restarting || busy}
                onPress={confirmRestart}
                className="min-h-11 flex-row items-center gap-1.5 active:opacity-70 disabled:opacity-45"
              >
                {restarting ? <Loader /> : <AppIcon name="refresh" size={14} tone="accent" />}
                <Text className="text-caption text-accent">{t("space.settings.spec.restartNow")}</Text>
              </Pressable>
            </View>
          ) : null}
          {config?.preferences ? <>
            <Text className="text-caption text-fg-muted mt-5">{t("space.settings.image")}</Text>
            <ImageOptionList
              preferences={config.preferences}
              disabled={sandboxBusy}
              onChange={(image) => void updateSandbox({ image })}
            />
            <Text className="text-caption text-fg-faint mt-1">{t(config.preferences.applicable ? "space.settings.image.hint" : "space.settings.image.local")}</Text>
            {config.preferences.applicable && config.preferences.warnings.includes("image_unavailable") ? <Text className="text-caption text-warning mt-1">{t("space.settings.image.unavailable")}</Text> : null}
          </> : null}
          <View className="mt-5 overflow-hidden rounded-md" style={{ borderCurve: "continuous" }}>
            <SettingsRow
              icon="terminal"
              title={t("space.setup.title")}
              detail={sandbox?.provider === "local" ? undefined : t(SETUP_STATUS[sandboxSetupStatus(sandboxSetupInfo(sandbox?.meta))].label)}
              last
              onPress={() => router.push({ pathname: "/space/[spaceId]/setup", params: { spaceId } })}
            />
          </View>
          <Text className="text-caption text-fg-muted mt-5">{t("space.settings.sleep")}</Text>
          <Segmented
            className="mt-2"
            disabled={sandboxBusy}
            value={idlePolicy ? "idle" : "never"}
            options={[{ value: "idle", label: t("space.settings.sleep.afterIdle") }, { value: "never", label: t("space.settings.sleep.never") }]}
            onChange={(mode) => void updateSandbox({ autoDestroy: mode === "never" ? { mode: "never" } : { mode: "idle", ttlSeconds: DEFAULT_IDLE_TTL_SECONDS } })}
          />
          {idlePolicy ? (
            <View className={`flex-row flex-wrap mt-1 ${sandboxBusy ? "opacity-45" : ""}`}>
              {idleTtlChoices(idlePolicy.ttlSeconds).map((seconds) => (
                <FilterChip
                  key={seconds}
                  label={formatIdleTtl(seconds, t)}
                  selected={seconds === idlePolicy.ttlSeconds}
                  onPress={() => { if (!sandboxBusy && seconds !== idlePolicy.ttlSeconds) void updateSandbox({ autoDestroy: { mode: "idle", ttlSeconds: seconds } }); }}
                />
              ))}
              <FilterChip label={t("space.settings.sleep.custom")} icon="square-pen" selected={false} onPress={() => { if (!sandboxBusy) openCustomTtl(); }} />
            </View>
          ) : null}
          <Text className="text-caption text-fg-faint mt-1">
            {idlePolicy ? t("space.settings.sleep.idleHint", { duration: formatIdleTtl(idlePolicy.ttlSeconds, t) }) : t("space.settings.sleep.neverHint")}
          </Text>
          </> : null}
        </View>

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.ports")}</Text>
          <ResourceStatus state={resources.ports} onRetry={() => void loadResource("ports")} />
          {Object.entries(ports).map(([key, endpoint]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => endpoint.url ? void openWebLink(endpoint.url).catch(() => Linking.openURL(endpoint.url!)) : undefined}
              className="mt-2 flex-row items-center gap-3 rounded-md bg-surface-raised p-4 active:bg-surface-pressed"
            >
              <AppIcon name="globe" size={18} tone="accent" />
              <View className="flex-1 min-w-0">
                <Text className="text-body font-semibold text-fg">{t("space.settings.portLabel", { port: key })}</Text>
                <Text numberOfLines={1} ellipsizeMode="middle" className="text-caption text-fg-muted mt-1">
                  {endpoint.url ?? t("space.settings.portUnavailable")}
                </Text>
              </View>
              <AppIcon name="external-link" size={16} tone="muted" />
            </Pressable>
          ))}
        </View>

        <View>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-headline font-semibold text-fg">{t("space.settings.mods")}</Text>
            <IconButton
              name="plus"
              label={t("space.settings.addMod")}
              tone="accent"
              disabled={!client || !spaceId || resources.mods.loading}
              onPress={() => { setModError(null); setAddModOpen(true); }}
            />
          </View>
          <ResourceStatus state={resources.mods} onRetry={() => void loadResource("mods")} />
          {mods.length === 0 ? (
            resources.mods.loaded && !resources.mods.error && !resources.mods.loading ? <Text className="text-body text-fg-muted mt-2">{t("space.settings.noMods")}</Text> : null
          ) : (
            mods.map((mod) => (
              <View key={mod.id} className="flex-row items-center gap-3 py-3 border-b border-border">
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} className="text-body font-semibold text-fg">{mod.name || mod.mountSlug}</Text>
                  <Text numberOfLines={1} className="text-caption text-fg-muted mt-0.5">{mod.mountPath}</Text>
                  <Text numberOfLines={1} ellipsizeMode="middle" className="text-micro text-fg-faint mt-0.5">Space: {mod.modSpaceId}</Text>
                </View>
                <AppSwitch
                  value={mod.enabled}
                  onValueChange={async (enabled) => {
                    if (!client || !spaceId) return;
                    const space = client.space(spaceId);
                    try {
                      await space.mods.update(mod.id, { enabled });
                      setMods((current) => current.map((m) => m.id === mod.id ? { ...m, enabled } : m));
                      toast({ title: enabled ? t("space.settings.modEnabled") : t("space.settings.modDisabled") });
                      if (enabled) {
                        Alert.alert(t("space.settings.modEnabled"), t("space.settings.modEnabledRestart"));
                      }
                    } catch (error) {
                      toast({ title: t("space.settings.modToggleFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
                    }
                  }}
                />
              </View>
            ))
          )}
        </View>

        <View>
          <View className="flex-row items-center justify-between">
            <Text className="text-headline font-semibold text-fg">{t("space.settings.schedules")}</Text>
            <IconButton name="plus" label={t("schedule.newTitle")} tone="accent" disabled={!spaceId} onPress={() => router.push({ pathname: "/space/[spaceId]/schedule/new", params: { spaceId } })} />
          </View>
          <ResourceStatus state={resources.schedules} onRetry={() => void loadResource("schedules")} />
          {schedules.length === 0 ? (
            resources.schedules.loaded && !resources.schedules.error && !resources.schedules.loading ? <Text className="text-body text-fg-muted mt-2">{t("space.settings.noSchedules")}</Text> : null
          ) : (
            schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                onPress={() => router.push({ pathname: "/space/[spaceId]/schedule/[jobId]", params: { spaceId, jobId: schedule.id } })}
                onToggle={async (enabled) => {
                  if (!client) return;
                  try {
                    await client.cronJobs.toggle(schedule.id, enabled);
                    setSchedules((current) => current.map((s) => s.id === schedule.id ? { ...s, enabled } : s));
                    toast({ title: enabled ? t("space.settings.schedule.enabled") : t("space.settings.schedule.disabled") });
                  } catch (error) {
                    toast({ title: t("space.settings.schedule.toggleFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
                  }
                }}
              />
            ))
          )}
        </View>
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
    </Screen>
  );
}

function ResourceStatus({ state, onRetry }: { state: SpaceSettingsResourceState; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state.loading) return <Text accessibilityLiveRegion="polite" className="text-caption text-fg-muted mt-2">{t("space.settings.loading")}</Text>;
  if (!state.error) return null;
  return <View className="flex-row items-center gap-2"><Text selectable accessibilityRole="alert" className="text-caption flex-1 text-danger">{state.error}</Text><IconButton name="refresh" label={t("common.retry")} onPress={onRetry} /></View>;
}

function EnvironmentRow({ item, visible, onToggle, onCopy }: { item: SpaceEnvironmentItem; visible: boolean; onToggle: () => void; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="py-3 border-b gap-1.5 border-border">
      <Text className="text-body font-semibold text-fg">{item.name}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable accessibilityRole="button" accessibilityLabel={t("space.settings.copyValue")} onPress={onCopy} className="flex-1">
          <Text selectable={visible} numberOfLines={1} className="text-caption text-fg-muted">
            {visible ? item.value : "•".repeat(Math.min(24, Math.max(8, item.value.length)))}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? t("space.settings.hideValue") : t("space.settings.showValue")}
          onPress={onToggle}
          hitSlop={8}
        >
          <AppIcon name={visible ? "eye-off" : "eye"} size={17} tone="muted" />
        </Pressable>
      </View>
    </View>
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
      <Text className="text-caption text-fg-muted mt-1.5">{t("deviceRuntime.hint")}</Text>
      <View className="flex-row items-center gap-2 p-4 mt-2 rounded-md bg-surface-raised">
        <AppIcon name="smartphone" size={18} tone={instance?.state === "ready" ? "success" : "muted"} />
        <View className="flex-1 min-w-0">
          <Text className={`text-body font-semibold ${instance?.state === "error" ? "text-danger" : "text-fg"}`}>{t(deviceRuntimeStateKey(instance))}</Text>
          {instance ? <Text selectable className="text-caption text-fg-muted mt-1">{instance.label}</Text> : null}
        </View>
        {busy || instance?.state === "connecting" ? <Loader /> : null}
      </View>
      {hint ? <Text accessibilityRole="alert" className="text-caption text-danger mt-2">{hint}</Text> : null}
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
      <Text className="text-body font-semibold text-fg">{t("deviceRuntime.display.title")}</Text>
      <Text className="text-caption text-fg-muted mt-1.5">{t(serving ? "deviceRuntime.display.hint" : "deviceRuntime.display.connectFirst")}</Text>
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
          <ActionButton label={t("deviceRuntime.display.share")} icon="monitor" disabled={busy || !serving} onPress={() => void update(() => shareDeviceDisplay(spaceId))} />
        )}
      </View>
      {sharingHere && !status.control ? <Text className="text-caption text-fg-muted mt-2">{t("deviceRuntime.display.controlHint")}</Text> : null}
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
      className="min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-sm bg-surface-raised px-2.5 active:bg-surface-pressed disabled:opacity-45"
    >
      {icon ? <AppIcon name={icon} size={15} tone="accent" /> : null}
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
    <View accessibilityRole="radiogroup" className="mt-2 overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
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
            className={`min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-surface-pressed ${index > 0 ? "border-t border-border" : ""} ${disabled ? "opacity-60" : ""}`}
          >
            <View className={`size-5 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-border"}`}>
              {selected ? <View className="size-2.5 rounded-full bg-accent" /> : null}
            </View>
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
            {details.resources ? <Text className={`text-caption font-semibold tabular-nums ${selected ? "text-fg" : "text-fg-muted"} ${locked ? "opacity-55" : ""}`}>{details.resources}</Text> : null}
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
    <View accessibilityRole="radiogroup" className="mt-2 overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
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
            className={`min-h-13 flex-row items-center gap-3 px-4 py-3 active:bg-surface-pressed ${index > 0 ? "border-t border-border" : ""} ${locked ? "opacity-60" : ""}`}
          >
            <View className={`size-5 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-border"}`}>
              {selected ? <View className="size-2.5 rounded-full bg-accent" /> : null}
            </View>
            <Text className="min-w-0 flex-1 text-body text-fg">{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ScheduleRow({ schedule, onPress, onToggle }: { schedule: CronJobRecord; onPress: () => void; onToggle: (enabled: boolean) => Promise<void> }) {
  const { t } = useTranslation();
  const [toggling, setToggling] = useState(false);
  
  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await onToggle(enabled);
    } finally {
      setToggling(false);
    }
  };

  return (
    <View className="flex-row items-center gap-2 border-b border-border">
      <Pressable accessibilityRole="button" accessibilityLabel={schedule.title || t("space.settings.schedule.unnamed")} onPress={onPress} className="min-w-0 flex-1 py-3 active:opacity-70">
        <Text numberOfLines={1} className="text-body font-semibold text-fg">{schedule.title || t("space.settings.schedule.unnamed")}</Text>
        <Text className="text-caption text-fg-muted mt-0.5">{cronSummaryText(summarizeCron(schedule.cronExpression), schedule.cronExpression, t)}</Text>
        {schedule.updatedAt && (
          <Text className="text-micro font-semibold text-fg-faint mt-1">
            {t("space.settings.schedule.lastRun")}: {formatRelativeTime(schedule.updatedAt)}
          </Text>
        )}
      </Pressable>
      <AppSwitch
        value={schedule.enabled}
        onValueChange={handleToggle}
        disabled={toggling}
      />
    </View>
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
