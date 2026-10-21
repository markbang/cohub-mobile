import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  checkForAppUpdate,
  getInstalledAppVersion,
  isUpdateSnoozed,
  type AppRelease,
} from "@/src/platform/app-updates";
import { currentUpdateChannel, switchUpdateChannel, type UpdateChannel } from "@/src/platform/update-channel";
import { AppIcon, Loader, PrimaryButton, Screen, SectionHeader } from "@/src/ui";
import type { IconName } from "@/src/icons";

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function formatBytes(value: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function short(value: string | null | undefined, size = 12) {
  if (!value) return "—";
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export default function DebugUpdatesScreen() {
  const [busy, setBusy] = useState<string | null>(null);
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [releaseChecked, setReleaseChecked] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  const [ota, setOta] = useState<string | null>(null);
  const [otaError, setOtaError] = useState<string | null>(null);

  const executionEnvironment = safe(
    () => String(Constants.executionEnvironment),
    "unknown",
  );
  const updatesEnabled = safe(() => Updates.isEnabled, false);

  const busyRef = useRef(false);
  const withBusy = useCallback(async (key: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  const checkRelease = useCallback(
    () =>
      withBusy("release", async () => {
        setReleaseError(null);
        try {
          const latest = await checkForAppUpdate({ force: true });
          setRelease(latest);
          setReleaseChecked(true);
          setSnoozed(latest ? await isUpdateSnoozed(latest.version) : null);
        } catch (error) {
          setReleaseError(error instanceof Error ? error.message : "检查更新失败");
        }
      }),
    [withBusy],
  );

  useEffect(() => {
    void Promise.resolve().then(() => checkRelease());
  }, [checkRelease]);

  const checkOta = useCallback(
    () =>
      withBusy("ota", async () => {
        setOtaError(null);
        setOta(null);
        try {
          const result = (await Updates.checkForUpdateAsync()) as {
            isAvailable?: boolean;
            manifest?: { id?: string } | null;
            isRollBackToEmbedded?: boolean;
          };
          setOta(
            [
              `isAvailable: ${String(result.isAvailable ?? false)}`,
              `rollback: ${String(result.isRollBackToEmbedded ?? false)}`,
              `manifest: ${result.manifest?.id ?? "—"}`,
            ].join("\n"),
          );
        } catch (error) {
          setOtaError(error instanceof Error ? error.message : "OTA 检查失败");
        }
      }),
    [withBusy],
  );

  const changeChannel = useCallback(
    (channel: UpdateChannel) =>
      withBusy(`channel:${channel}`, async () => {
        setOtaError(null);
        setOta(null);
        try {
          const result = await switchUpdateChannel(channel);
          if (result === "no-update") setOta(channel === "production" ? "已在 production 最新包" : `${channel} 没有适配当前原生包的更新，已保持 production`);
        } catch (error) {
          setOtaError(error instanceof Error ? error.message : "切换频道失败");
        }
      }),
    [withBusy],
  );

  const fetchAndReload = useCallback(
    () =>
      withBusy("fetch", async () => {
        setOtaError(null);
        try {
          const result = (await Updates.fetchUpdateAsync()) as {
            isNew?: boolean;
            manifest?: { id?: string } | null;
          };
          setOta(
            [`isNew: ${String(result.isNew ?? false)}`, `manifest: ${result.manifest?.id ?? "—"}`, "即将重启加载新包…"].join("\n"),
          );
          if (result.isNew) await Updates.reloadAsync();
        } catch (error) {
          setOtaError(error instanceof Error ? error.message : "下载并重启失败");
        }
      }),
    [withBusy],
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="已安装原生包" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row icon="info" label="应用版本" value={getInstalledAppVersion()} />
          <Row icon="fingerprint" label="Build" value={String(safe(() => Application.nativeBuildVersion, null) ?? "—")} />
          <Row icon="database" label="包名" value={safe(() => Application.applicationId, null) ?? "—"} />
          <Row icon="monitor" label="运行环境" value={String(executionEnvironment)} />
        </View>

        <SectionHeader title="expo-updates" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row
            icon={updatesEnabled ? "check-circle" : "cloud-off"}
            label="OTA 是否启用"
            value={updatesEnabled ? "enabled" : "disabled"}
            testID="debug.updates.enabled"
            tone={updatesEnabled ? "success" : "muted"}
          />
          <Row icon="zap" label="runtimeVersion" value={safe(() => Updates.runtimeVersion, null) ?? "—"} testID="debug.updates.runtime" />
          <Row icon="wifi" label="channel" value={safe(() => Updates.channel, null) ?? "—"} testID="debug.updates.channel" />
          <Row icon="layers" label="updateId" value={safe(() => Updates.updateId, null) ?? "—"} testID="debug.updates.updateId" />
          <Row icon="download" label="嵌入启动" value={String(safe(() => Updates.isEmbeddedLaunch, false))} testID="debug.updates.embedded" />
          <Row
            icon="alert"
            label="应急启动"
            value={
              safe(() => Updates.isEmergencyLaunch, false)
                ? `yes · ${safe(() => Updates.emergencyLaunchReason, null) ?? "—"}`
                : "no"
            }
          />
          <Row icon="refresh" label="checkAutomatically" value={safe(() => Updates.checkAutomatically, null) ?? "—"} />
        </View>
        {!updatesEnabled ? (
          <Text className="text-caption text-fg-muted mx-4 mt-2">
            Expo Go / 开发构建里 OTA 恒为 disabled，只有带 EXPO_PUBLIC_UPDATES_URL 的正式构建才会启用。
          </Text>
        ) : null}

        <SectionHeader title="expo-updates 操作" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <View className="p-4 gap-2">
            {(["production", "staging"] as const).filter((channel) => channel !== currentUpdateChannel()).map((channel) => <PrimaryButton
              key={channel}
              label={`切换到 ${channel}`}
              icon="layers"
              loading={busy === `channel:${channel}`}
              disabled={!updatesEnabled || busy !== null}
              onPress={() => void changeChannel(channel)}
            />)}
            <PrimaryButton
              label="检查 OTA 更新"
              icon="refresh"
              loading={busy === "ota"}
              disabled={!updatesEnabled || busy !== null}
              onPress={() => void checkOta()}
            />
            <PrimaryButton
              label="下载并重启"
              icon="download"
              variant="danger"
              loading={busy === "fetch"}
              disabled={!updatesEnabled || busy !== null}
              onPress={() => void fetchAndReload()}
            />
            {ota ? <Text selectable className="text-code text-fg-secondary">{ota}</Text> : null}
            {otaError ? <Text selectable className="text-caption text-danger">{otaError}</Text> : null}
          </View>
        </View>

        <SectionHeader title="Yaota 原生发布 (APK)" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {busy === "release" && !releaseChecked ? (
            <View className="p-5 items-center">
              <Loader />
            </View>
          ) : release ? (
            <>
              <Row icon="download" label="可更新版本" value={release.version} tone="accent" />
              <Row icon="info" label="标题" value={release.title ?? "—"} />
              <Row icon="layers" label="APK 资源" value={release.downloadName ?? "—"} />
              <Row icon="database" label="APK 大小" value={formatBytes(release.downloadSize)} />
              <Row icon="fingerprint" label="sha256" value={short(release.downloadSha256, 16)} />
              <Row icon="alert" label="已忽略(snooze)" value={snoozed == null ? "—" : snoozed ? "yes" : "no"} />
            </>
          ) : (
            <Row icon="check-circle" label="状态" value={releaseError ? "检查失败" : "已是最新原生版本"} tone={releaseError ? "danger" : "success"} />
          )}
          {releaseError ? <Row icon="alert" label="错误" value={releaseError} tone="danger" /> : null}
          <View className="p-4">
            <PrimaryButton
              label="重新检查 Yaota APK"
              icon="refresh"
              loading={busy === "release"}
              disabled={busy !== null}
              onPress={() => void checkRelease()}
            />
          </View>
        </View>

        <Text className="text-micro font-semibold text-fg-faint mx-4 mt-4">
          说明：OTA 只在“下次冷启动”生效；APK 更新只在存在更新版本的签名 APK 时才提示，纯 JS 更新不会触发 APK 下载。
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, label, value, testID, tone = "default" }: { icon: IconName; label: string; value: string; testID?: string; tone?: "default" | "success" | "danger" | "accent" | "muted" }) {
  const valueClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent" : tone === "muted" ? "text-fg-muted" : "text-fg";
  return (
    <View className="min-h-15 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <View className="w-8 h-8 rounded-sm items-center justify-center bg-surface-raised">
        <AppIcon name={icon} size={16} tone={tone === "danger" ? "danger" : tone === "success" ? "success" : "muted"} />
      </View>
      <Text className="text-caption text-fg-muted w-30">{label}</Text>
      <Text testID={testID} selectable numberOfLines={3} className={`flex-1 text-right text-caption ${valueClass}`}>{value}</Text>
    </View>
  );
}

