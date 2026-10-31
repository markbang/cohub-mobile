import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { deviceDisplayStateKey, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, type DeviceRuntimeInstance } from "@/src/data/device-runtime";
import type { SpaceListSpace } from "@/src/data/space-list";
import { openDeviceControlSettings, shareDeviceDisplay, startDeviceRuntime, stopDeviceDisplay, stopDeviceRuntime, useDeviceDisplayStatus } from "@/src/platform/device-runtime";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Avatar, Loader, type IconName } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow } from "@/src/ui/ListRow";
import { displaySpaceName } from "@/src/utils";

type DeviceSpaceRowProps = {
  instance: DeviceRuntimeInstance;
  /** Null when the bound Space is not in the loaded list, e.g. after leaving it; the binding stays manageable. */
  space: SpaceListSpace | null;
  onPress: () => void;
};

/** A Space this device serves: its connection and this screen's sharing, managed in place. */
export function DeviceSpaceRow({ instance, space, onPress }: DeviceSpaceRowProps) {
  const { t } = useTranslation();
  const display = useDeviceDisplayStatus();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const name = displaySpaceName(space);
  const running = isDeviceRuntimeRunning(instance);
  const sharingHere = display?.sharedWith === instance.spaceId;

  const update = async (action: () => Promise<string | null> | void, failureKey: "deviceRuntime.error.failed" | "deviceRuntime.display.failed") => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      const outcome = await action();
      if (outcome) setHint(outcome);
    } catch {
      setHint(t(failureKey));
    } finally {
      setBusy(false);
    }
  };
  const connect = () => update(async () => {
    const refusal = await startDeviceRuntime(instance.spaceId, instance.root);
    return refusal ? t(deviceRuntimeRefusalKey(refusal)) : null;
  }, "deviceRuntime.error.failed");
  const share = () => update(async () => {
    const outcome = await shareDeviceDisplay(instance.spaceId);
    return outcome ? t(outcome === "declined" ? "deviceRuntime.display.declined" : "deviceRuntime.display.failed") : null;
  }, "deviceRuntime.display.failed");

  const failed = instance.state === "error";
  const stateLabel = t(deviceRuntimeStateKey(instance));
  return <View>
    <ListRow
      group="first"
      leading={<View className="flex-1 justify-center"><Avatar name={name} uri={space?.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} online={instance.state === "ready"} /></View>}
      title={name}
      titlePrefix={display && sharingHere ? <AppIcon name="monitor" size={13} tone="info" /> : null}
      // A failure is the one state worth words; otherwise the line shows which folder is served.
      subtitle={failed
        ? <Text numberOfLines={1} className="text-subhead text-danger">{stateLabel}</Text>
        : <View className="flex-row items-center gap-1"><AppIcon name="folder" size={12} tone="faint" /><Text numberOfLines={1} ellipsizeMode="middle" className="min-w-0 flex-1 text-subhead text-fg-muted">{instance.label}</Text></View>}
      accessory={busy || instance.state === "connecting" ? <Loader /> : null}
      accessibilityLabel={[t("ui.openNamed", { name }), stateLabel, display && sharingHere ? t(deviceDisplayStateKey(display, instance.spaceId)) : null].filter(Boolean).join(", ")}
      onPress={onPress}
    />
    {/* The actions close the row; they start at its text column: row padding + avatar + its gap. */}
    <View className="flex-row flex-wrap gap-2 border-border pb-3 pr-4" style={{ paddingLeft: 16 + LIST_AVATAR_SIZE + 14, borderBottomWidth: StyleSheet.hairlineWidth }}>
      {running
        ? <RowAction label={t("deviceRuntime.disconnect")} icon="x" disabled={busy} onPress={() => void update(() => stopDeviceRuntime(instance.spaceId), "deviceRuntime.error.failed")} />
        : <RowAction label={t("deviceRuntime.connect")} icon="wifi" disabled={busy} onPress={() => void connect()} />}
      {display ? sharingHere
        ? <>
          <RowAction label={t("deviceRuntime.display.stop")} icon="x" disabled={busy} onPress={() => void update(stopDeviceDisplay, "deviceRuntime.display.failed")} />
          {!display.control ? <RowAction label={t("deviceRuntime.display.allowControl")} icon="settings" disabled={busy} onPress={() => void update(openDeviceControlSettings, "deviceRuntime.display.failed")} /> : null}
        </>
        : <RowAction label={t("deviceRuntime.display.share")} icon="monitor" disabled={busy || !running} onPress={() => void share()} />
        : null}
      {hint ? <Text accessibilityRole="alert" className="w-full text-caption text-danger">{hint}</Text> : null}
    </View>
  </View>;
}

function RowAction({ label, icon, onPress, disabled }: { label: string; icon: IconName; onPress: () => void; disabled: boolean }) {
  // The compact capsule sits inside a 44pt touch target.
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={6} className="min-h-11 justify-center disabled:opacity-45">
    {({ pressed }) => <View className={`min-h-8 flex-row items-center gap-1.5 rounded-full px-3 ${pressed ? "bg-surface-pressed" : "bg-surface-raised"}`}>
      <AppIcon name={icon} size={14} tone="accent" />
      <Text numberOfLines={1} className="text-caption font-semibold text-fg">{label}</Text>
    </View>}
  </Pressable>;
}
