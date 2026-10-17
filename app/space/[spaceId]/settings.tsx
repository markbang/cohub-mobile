import * as Clipboard from "expo-clipboard";
import type { CronJobRecord, SandboxSpecId, SpaceMember, SpaceRole, SpaceSandboxAutoDestroyPolicy, SpaceSandboxConfig } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { DeviceFolderPickerSheet } from "@/src/components/DeviceFolderBrowser";
import { useToast } from "@/src/components/Toast";
import { installSpaceMod } from "@/src/data/space-mods";
import { useApp } from "@/src/data/context";
import { deviceDisplayStateKey, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, type DeviceRuntimeRefusal } from "@/src/data/device-runtime";
import { deviceRuntimeSupported, openDeviceControlSettings, shareDeviceDisplay, startDeviceRuntime, stopDeviceDisplay, stopDeviceRuntime, useDeviceDisplayStatus, useDeviceRuntimeInstances } from "@/src/platform/device-runtime";
import { useSpaceSettings, type SpaceEnvironmentItem, type SpaceSettingsResourceState } from "@/src/data/use-space-settings";
import { useTranslation, type Translate } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, FIELD_INPUT_CLASS, IconButton, PrimaryButton, Screen, Segmented, TopBar, type IconName } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

const SPEC_OPTIONS = ["standard", "boost", "ultra"] as const;
const SLEEP_OPTIONS = ["never", "0.5h", "2h"] as const;

export default function SpaceSettingsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const { env, setEnv, config, setConfig, ports, allowedSpec, members, setMembers, invitations, setInvitations, mods, setMods, schedules, setSchedules, resources, loadResource } = useSpaceSettings(client, spaceId);
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

  const updateSandbox = async (next: { spec?: SandboxSpecId; autoDestroy?: SpaceSandboxAutoDestroyPolicy }) => {
    if (!client || !spaceId) return;
    setBusy(true);
    try {
      const space = client.space(spaceId);
      const result = await space.updateConfig({ sandbox: next });
      const refreshed = await space.getConfig().catch(() => null);
      const sandbox = refreshed?.config.sandbox;
      const pendingRestart = next.spec ? result.sandbox?.pendingRestart === true : false;
      if (sandbox) {
        setConfig({
          ...sandbox,
          specPendingRestart: pendingRestart || sandbox.specPendingRestart,
        });
      } else {
        setConfig((current) => current ? {
          ...current,
          ...next,
          specPendingRestart: pendingRestart || current.specPendingRestart,
        } : current);
      }
      if (next.spec) {
        toast({ title: specNeedsRestart(sandbox ?? null, pendingRestart) ? t("space.settings.spec.savedRestart") : t("space.settings.spec.updated") });
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

        {deviceRuntimeSupported && spaceId ? <DeviceRuntimeSection spaceId={spaceId} /> : null}

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.sandbox")}</Text>
          <ResourceStatus state={resources.config} onRetry={() => void loadResource("config")} />
          {resources.config.loaded ? <>
          <Text className="text-caption text-fg-muted mt-2">{t("space.settings.spec")}</Text>
          <ResourceStatus state={resources.allowedSpec} onRetry={() => void loadResource("allowedSpec")} />
          <SegmentedControl
            values={SPEC_OPTIONS}
            value={config?.spec ?? "standard"}
            maxValue={allowedSpec}
            disabled={busy || restarting || resources.config.loading || resources.allowedSpec.loading || !resources.allowedSpec.loaded}
            labels={[t("space.settings.spec.standard"), t("space.settings.spec.boost"), t("space.settings.spec.ultra")]}
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
                {restarting ? <ActivityIndicator color={theme.colors.accent} size="small" /> : <AppIcon name="refresh" size={14} tone="accent" />}
                <Text className="text-caption text-accent">{t("space.settings.spec.restartNow")}</Text>
              </Pressable>
            </View>
          ) : null}
          <Text className="text-caption text-fg-muted mt-5">{t("space.settings.sleep")}</Text>
          <SegmentedControl
            values={SLEEP_OPTIONS}
            value={sleepFromConfig(config)}
            labels={[t("space.settings.sleep.never"), t("space.settings.sleep.halfHour"), t("space.settings.sleep.twoHours")]}
            disabled={busy || restarting || resources.config.loading}
            onChange={(selected) => void updateSandbox({ autoDestroy: sleepToPolicy(selected) })}
          />
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
                <Text numberOfLines={1} selectable className="text-caption text-fg-muted mt-1">
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
              <View key={mod.id} className="py-3 border-b border-border">
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} className="text-body font-semibold text-fg">{mod.name || mod.mountSlug}</Text>
                  <Text className="text-caption text-fg-muted mt-0.5">{mod.mountPath}</Text>
                  <Text className="text-caption text-fg-muted mt-0.5">Space: {mod.modSpaceId}</Text>
                </View>
                <Switch
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
                  trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  thumbColor={theme.colors.background}
                />
              </View>
            ))
          )}
        </View>

        <View>
          <Text className="text-headline font-semibold text-fg">{t("space.settings.schedules")}</Text>
          <ResourceStatus state={resources.schedules} onRetry={() => void loadResource("schedules")} />
          {schedules.length === 0 ? (
            resources.schedules.loaded && !resources.schedules.error && !resources.schedules.loading ? <Text className="text-body text-fg-muted mt-2">{t("space.settings.noSchedules")}</Text> : null
          ) : (
            schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
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
      {addModOpen ? <AdaptiveSheet
        visible
        title={t("space.settings.addMod")}
        subtitle={t("space.settings.addModPrompt")}
        onClose={() => setAddModOpen(false)}
        dismissible={!addingMod}
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
          <PrimaryButton label={t("space.settings.addMod")} icon="plus" loading={addingMod} disabled={!client || !modSpaceId.trim()} onPress={() => void addMod()} />
        </View>
      </AdaptiveSheet> : null}
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
  const theme = useAppTheme();
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
        {busy || instance?.state === "connecting" ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
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
  const theme = useAppTheme();
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
        {busy ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
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

function SegmentedControl<T extends string>({
  values,
  value,
  labels,
  maxValue,
  disabled,
  onChange,
  onLocked,
}: {
  values: readonly T[];
  value: T;
  labels: readonly string[];
  maxValue?: T;
  disabled?: boolean;
  onChange: (value: T) => void;
  onLocked?: () => void;
}) {
  const max = maxValue ? Math.max(0, values.indexOf(maxValue)) : values.length - 1;
  return (
    <Segmented
      className="mt-2"
      disabled={disabled}
      onLocked={onLocked}
      value={value}
      onChange={onChange}
      // Tiers above the plan's maximum stay visible but locked, so the upgrade path reads in place.
      options={values.map((item, index) => ({ value: item, label: labels[index] ?? item, locked: index > max }))}
    />
  );
}

function ScheduleRow({ schedule, onToggle }: { schedule: CronJobRecord; onToggle: (enabled: boolean) => Promise<void> }) {
  const theme = useAppTheme();
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
    <View className="flex-row items-center gap-2 py-3 border-b border-border">
      <View className="flex-1 min-w-0">
        <Text numberOfLines={1} className="text-body font-semibold text-fg">{schedule.title || t("space.settings.schedule.unnamed")}</Text>
        <Text className="text-caption text-fg-muted mt-0.5">{schedule.cronExpression}</Text>
        {schedule.updatedAt && (
          <Text className="text-micro font-semibold text-fg-faint mt-1">
            {t("space.settings.schedule.lastRun")}: {formatRelativeTime(schedule.updatedAt)}
          </Text>
        )}
      </View>
      <Switch
        value={schedule.enabled}
        onValueChange={handleToggle}
        disabled={toggling}
        trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
        thumbColor={theme.colors.surface}
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
  if (config.specPendingRestart) return true;
  const spec = config.spec ?? "standard";
  return Boolean(config.appliedSpec && config.appliedSpec !== spec);
}

function sleepFromConfig(config: SpaceSandboxConfig | null) {
  if (config?.autoDestroy?.mode === "never") return "never";
  if (config?.autoDestroy?.ttlSeconds === 1800) return "0.5h";
  return "2h";
}

function sleepToPolicy(value: (typeof SLEEP_OPTIONS)[number]): SpaceSandboxAutoDestroyPolicy {
  if (value === "never") return { mode: "never" };
  return { mode: "idle", ttlSeconds: value === "0.5h" ? 1800 : 7200 };
}
