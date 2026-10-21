import { useEffect, useRef, useState } from "react";
import { AppState as NativeAppState, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { ReleaseNotes } from "@/src/components/ReleaseNotes";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Loader, PrimaryButton } from "@/src/ui";
import { openWebLink } from "@/src/platform/browser";
import {
  checkForAppUpdate,
  downloadAndInstallAndroidUpdate,
  openAndroidInstallPermissionSettings,
  type ApkUpdateProgress,
  getInstalledAppVersion,
  isUpdateSnoozed,
  snoozeAppUpdate,
  type AppRelease,
} from "@/src/platform/app-updates";

export function AppUpdateBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [snoozedVersion, setSnoozedVersion] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let active = true;

    const check = async () => {
      try {
        const latest = await checkForAppUpdate();
        const snoozed = latest ? await isUpdateSnoozed(latest.version) : false;
        if (!active) return;
        setSnoozedVersion(snoozed && latest ? latest.version : null);
        if (latest && !snoozed && presentedVersion.current !== latest.version) {
          presentedVersion.current = latest.version;
          setDetailsOpen(true);
        }
        setRelease((current) => {
          if (!latest || snoozed) return null;
          return current?.version === latest.version &&
            current.title === latest.title &&
            current.publishedAt === latest.publishedAt &&
            current.url === latest.url &&
            current.notes === latest.notes &&
            current.downloadUrl === latest.downloadUrl &&
            current.downloadName === latest.downloadName &&
            current.downloadSize === latest.downloadSize &&
            current.downloadSha256 === latest.downloadSha256
            ? current
            : latest;
        });
      } catch {
        // An update check is optional and must not affect app startup.
      }
    };

    void check();
    const subscription = NativeAppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  if (Platform.OS !== "android" || !release || release.version === snoozedVersion) return null;

  const dismiss = () => {
    void snoozeAppUpdate(release.version).catch(() => undefined);
    setSnoozedVersion(release.version);
    setRelease(null);
    setDetailsOpen(false);
  };

  return (
    <>
      <View pointerEvents="box-none" className="absolute left-3 right-3 z-100 items-center" style={{ top: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("update.banner.accessibility", { version: release.version })}
          onPress={() => setDetailsOpen(true)}
         
          className="min-h-14 w-full max-w-130 flex-row items-center gap-2.5 rounded-md bg-surface px-3 shadow-float active:bg-surface-pressed"
          style={{ borderCurve: "continuous" }}
        >
          <View className="size-9 items-center justify-center rounded-sm bg-accent-soft">
            <AppIcon name="download" size={18} tone="accent" />
          </View>
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="text-body font-semibold text-fg">{t("update.available", { version: release.version })}</Text>
            <Text numberOfLines={1} className="mt-px text-caption text-fg-muted">{release.title ?? t("update.viewNotes")}</Text>
          </View>
          <AppIcon name="chevron-right" size={17} tone="faint" />
        </Pressable>
      </View>

      <AppUpdateDetailsSheet
        key={`banner-${release.version}`}
        release={release}
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onLater={dismiss}
      />
    </>
  );
}

export function AppUpdateDetailsSheet({
  release,
  visible,
  onClose,
  onLater,
}: {
  release: AppRelease;
  visible: boolean;
  onClose: () => void;
  onLater?: () => void;
}) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<ApkUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installerReturned, setInstallerReturned] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const releaseDate = formatReleaseDate(release.publishedAt);
  const assetDetail = release.downloadName
    ? `${release.downloadName}${release.downloadSize !== null ? ` · ${formatBytes(release.downloadSize)}` : ""}`
    : null;

  const runOperation = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setOpening(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("update.failed"));
    } finally {
      if (operation.current === controller) operation.current = null;
      setOpening(false);
      setProgress(null);
    }
  };

  const installUpdate = () => runOperation(async (signal) => {
    setInstallerReturned(false);
    setProgress({ phase: "downloading", fraction: 0 });
    await downloadAndInstallAndroidUpdate(release, { signal, onProgress: setProgress });
    if (!signal.aborted) setInstallerReturned(true);
  });
  const downloading = progress?.phase === "downloading";
  const isAndroid = Platform.OS === "android";

  return (
    <AdaptiveSheet
      visible={visible}
      title={t("update.sheet.title")}
      subtitle={t("update.sheet.subtitle", { version: release.version })}
      onClose={onClose}
      dismissible={!opening}
      scrollable
      footer={
        <View className="flex-row justify-end items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={downloading ? t("update.cancel") : t("update.notNow")}
            onPress={() => {
              if (downloading) operation.current?.abort();
              else (onLater ?? onClose)();
            }}
            disabled={opening && !downloading}
            className="min-h-12 justify-center px-4 active:opacity-60"
          >
            <Text className="text-body font-semibold text-fg-secondary">{downloading ? t("update.cancel") : t("update.notNow")}</Text>
          </Pressable>
          <PrimaryButton
            label={isAndroid ? t("update.install") : t("update.openRelease")}
            icon={isAndroid ? "download" : "external-link"}
            loading={opening}
            disabled={isAndroid && !release.downloadUrl}
            onPress={() => void (isAndroid ? installUpdate() : runOperation(() => openWebLink(release.url)))}
            className="flex-1 min-w-0 min-h-12 px-4"
          />
        </View>
      }
      testID="app-update-sheet"
    >
      <View className="flex-row items-center gap-3 p-3 border rounded-md bg-surface-raised border-border">
        <View className="w-10 h-10 rounded-md items-center justify-center bg-accent-soft">
          <AppIcon name="download" size={20} tone="accent" />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-headline font-semibold text-fg">{release.title ?? `Cohub ${release.version}`}</Text>
          <Text className="text-caption text-fg-muted mt-1">
            {[release.version, releaseDate].filter(Boolean).join(" · ")}
          </Text>
          {assetDetail ? <Text numberOfLines={2} className="text-caption text-accent mt-1">{assetDetail}</Text> : null}
        </View>
      </View>

      <View className="flex-row items-start gap-2 p-3 border rounded-md mt-3 bg-accent-soft border-accent-border">
        <AppIcon name="info" size={17} tone="accent" />
        <Text className="text-body text-fg-secondary flex-1">
          {progress?.phase === "downloading" ? t("update.status.downloading", { percent: Math.round(progress.fraction * 100) })
            : progress?.phase === "verifying" ? t("update.status.verifying")
            : progress?.phase === "installing" ? t("update.status.installing")
            : installerReturned ? t("update.status.installerReturned")
            : isAndroid ? release.downloadUrl ? t("update.status.apkReady") : t("update.status.noApk")
            : t("update.status.notesAvailable")}
        </Text>
      </View>

      {isAndroid ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("update.installPermission")}
          disabled={opening}
          onPress={() => void runOperation(() => openAndroidInstallPermissionSettings())}
          className="mt-4 min-h-12 flex-row items-center gap-2 rounded-sm bg-surface-raised px-3 active:bg-surface-pressed disabled:opacity-55"
        >
          <AppIcon name="shield" size={16} tone="accent" />
          <Text className="text-body font-semibold text-accent flex-1">{t("update.installPermission")}</Text>
          <AppIcon name="chevron-right" size={16} tone="faint" />
        </Pressable>
      ) : null}

      <View className="mt-4">
        <ReleaseNotes content={release.notes} />
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("update.openOnGitHub")}
        onPress={() => void runOperation(() => openWebLink(release.url))}
        disabled={opening}
        className="mt-4 min-h-12 flex-row items-center gap-2 rounded-sm bg-surface-raised px-3 active:bg-surface-pressed disabled:opacity-55"
      >
        <AppIcon name="external-link" size={16} tone="accent" />
        <Text className="text-body font-semibold text-accent flex-1">{t("update.openOnGitHub")}</Text>
        <AppIcon name="chevron-right" size={16} tone="faint" />
      </Pressable>
      {error ? <Text selectable className="text-caption text-danger mt-2">{error}</Text> : null}
    </AdaptiveSheet>
  );
}

export function AppUpdateRow() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "current" | "error">("idle");

  if (Platform.OS !== "android") return null;

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setRelease(null);
    setDetailsOpen(false);
    setStatus("idle");
    try {
      const latest = await checkForAppUpdate({ force: true });
      setRelease(latest);
      setStatus(latest ? "idle" : "current");
      if (latest) setDetailsOpen(true);
    } catch {
      setStatus("error");
    } finally {
      setChecking(false);
    }
  };

  const title = release ? t("update.available", { version: release.version }) : t("update.row.check");
  const detail = checking
    ? t("update.row.checking")
    : status === "current"
      ? t("update.row.upToDate", { version: getInstalledAppVersion() })
      : status === "error"
        ? t("update.row.githubError")
        : release?.downloadUrl
          ? t("update.row.apkReady")
          : release
            ? t("update.row.notesReady")
            : t("update.row.checkLatest");

  return (
    <>
      <Pressable
        testID="app-update-row"
        accessibilityRole="button"
        accessibilityLabel={release ? t("update.row.a11yView", { version: release.version }) : t("update.row.a11y")}
        accessibilityState={{ busy: checking }}
        disabled={checking}
        onPress={() => void check()}
        className="min-h-13 flex-row items-center gap-3 bg-surface px-4 py-2 active:bg-surface-pressed disabled:opacity-65"
      >
        {checking ? <Loader /> : <AppIcon name={release ? "download" : "refresh"} size={20} tone={release ? "accent" : "muted"} />}
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-body text-fg">{title}</Text>
          <Text numberOfLines={2} className={`text-caption ${release ? "text-accent" : "text-fg-muted"}`}>{detail}</Text>
        </View>
        {!checking ? <AppIcon name={release ? "external-link" : "chevron-right"} size={16} tone="faint" /> : null}
      </Pressable>
      {release ? <AppUpdateDetailsSheet key={`row-${release.version}`} release={release} visible={detailsOpen} onClose={() => setDetailsOpen(false)} /> : null}
    </>
  );
}

function formatReleaseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
