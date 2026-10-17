import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { FilterChip } from "@/src/components/FilterChip";
import { SettingsRow } from "@/src/components/SettingsRow";
import type { DeviceFolderListing } from "@/src/data/device-runtime";
import { useTranslation } from "@/src/i18n";
import { browseDeviceFolder } from "@/src/platform/device-runtime";
import { useAppTheme } from "@/src/theme";
import { PrimaryButton } from "@/src/ui";

export type DeviceFolderBrowserState = ReturnType<typeof useDeviceFolderBrowser>;

/** Browses device folders while [active]; reopening returns to the last folder shown. */
export function useDeviceFolderBrowser(active: boolean) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<DeviceFolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const request = useRef(0);
  const listingRef = useRef<DeviceFolderListing | null>(null);

  const load = useCallback(async (path?: string): Promise<void> => {
    const current = ++request.current;
    setLoading(true);
    setFailure(null);
    try {
      const next = await browseDeviceFolder(path).catch((error: unknown) => {
        // A folder that disappeared since it was listed falls back to the first volume.
        if (path) return browseDeviceFolder();
        throw error;
      });
      if (current !== request.current) return;
      if (next) {
        listingRef.current = next;
        setListing(next);
      } else {
        setFailure(t("deviceRuntime.accessRequired"));
      }
    } catch {
      if (current === request.current) setFailure(t("deviceRuntime.error.failed"));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    void Promise.resolve().then(() => load(listingRef.current?.path));
    return () => { request.current += 1; };
  }, [active, load]);

  return { listing, loading, failure, load };
}

export function DeviceFolderBrowser({ browser }: { browser: DeviceFolderBrowserState }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { listing, loading, failure, load } = browser;
  const activeVolume = listing?.volumes.find((volume) => listing.path === volume.path || listing.path.startsWith(`${volume.path}/`))?.path;

  return <View className="min-h-60">
    {listing && listing.volumes.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ columnGap: theme.spacing.xs }}>
      {listing.volumes.map((volume) => <FilterChip key={volume.path} label={volume.label} icon="database" selected={activeVolume === volume.path} onPress={() => void load(volume.path)} />)}
    </ScrollView> : null}
    {listing ? <View className="flex-row items-center gap-2 py-2">
      <Text selectable className="text-body font-semibold text-fg shrink">{listing.label}</Text>
      {listing.spaceId ? <View className="px-2 py-0.5 rounded-full bg-surface-raised">
        <Text className="text-micro font-semibold text-fg-muted">{t("deviceRuntime.linked")}</Text>
      </View> : null}
      {loading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
    </View> : null}
    {failure ? <View className="gap-3 py-3">
      <Text accessibilityRole="alert" className="text-body text-fg-secondary">{failure}</Text>
      <PrimaryButton label={t("common.retry")} icon="refresh" disabled={loading} onPress={() => void load(listing?.path)} />
    </View> : listing ? <View style={{ opacity: loading ? 0.6 : 1, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      {listing.parent ? <SettingsRow icon="arrow-up" title={t("deviceRuntime.parentFolder")} disabled={loading} onPress={() => void load(listing.parent ?? undefined)} /> : null}
      {listing.folders.map((folder) => <SettingsRow key={folder.path} icon="folder" title={folder.name} disabled={loading} onPress={() => void load(folder.path)} />)}
      {listing.folders.length === 0 ? <Text className="text-body text-fg-faint py-3">{t("deviceRuntime.noSubfolders")}</Text> : null}
    </View> : <View className="flex-1 min-h-50 items-center justify-center">
      <ActivityIndicator color={theme.colors.accent} />
    </View>}
  </View>;
}

export function DeviceFolderPickerSheet({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (folder: DeviceFolderListing) => void }) {
  const { t } = useTranslation();
  const browser = useDeviceFolderBrowser(visible);
  return <AdaptiveSheet
    visible={visible}
    title={t("deviceRuntime.chooseFolder")}
    onClose={onClose}
    testID="device-folder-sheet"
    footer={<PrimaryButton label={t("deviceRuntime.useFolder")} icon="check" disabled={!browser.listing || browser.loading || Boolean(browser.failure)} onPress={() => { if (browser.listing) onSelect(browser.listing); }} />}
  >
    <DeviceFolderBrowser browser={browser} />
  </AdaptiveSheet>;
}
