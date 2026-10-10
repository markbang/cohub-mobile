import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { deviceDisplayStateKey, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, type DeviceRuntimeInstance } from "@/src/data/device-runtime";
import type { SpaceListSpace } from "@/src/data/space-list";
import { openDeviceControlSettings, shareDeviceDisplay, startDeviceRuntime, stopDeviceDisplay, stopDeviceRuntime, useDeviceDisplayStatus } from "@/src/platform/device-runtime";
import { useTranslation } from "@/src/i18n";
import { useAppTheme, typography } from "@/src/theme";
import { AppIcon, Avatar, StatusPill, type IconName } from "@/src/ui";
import { PressableScale } from "@/src/ui/PressableScale";
import { displaySpaceName } from "@/src/utils";

type DeviceSpaceRowProps = {
  instance: DeviceRuntimeInstance;
  /** Null when the bound Space is not in the loaded list, e.g. after leaving it; the binding stays manageable. */
  space: SpaceListSpace | null;
  onPress: () => void;
};

/** A Space this device serves: its connection and this screen's sharing, managed in place. */
export function DeviceSpaceRow({ instance, space, onPress }: DeviceSpaceRowProps) {
  const theme = useAppTheme();
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

  return <View>
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("ui.openNamed", { name })}
      onPress={onPress}
      haptic
      style={{ flexDirection: "row", alignItems: "center", gap: 13, minHeight: 72, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 }}
      pressedStyle={{ backgroundColor: theme.colors.surfacePressed }}
    >
      <Avatar name={name} uri={space?.publicProfile?.avatarUrl} size={50} online={instance.state === "ready"} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text, flex: 1 }]}>{name}</Text>
          {display && sharingHere ? <StatusPill label={t(deviceDisplayStateKey(display, instance.spaceId))} tone="info" /> : null}
        </View>
        <Text numberOfLines={1} style={[typography.caption, { color: instance.state === "error" ? theme.colors.danger : theme.colors.textMuted, marginTop: 3 }]}>{t(deviceRuntimeStateKey(instance))}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
          <AppIcon name="folder" size={12} color={theme.colors.textFaint} />
          <Text numberOfLines={1} ellipsizeMode="middle" style={[typography.micro, { color: theme.colors.textFaint, flex: 1 }]}>{instance.label}</Text>
        </View>
      </View>
      {busy || instance.state === "connecting" ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />}
    </PressableScale>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingLeft: 79, paddingRight: 16, paddingBottom: 12 }}>
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
      {hint ? <Text accessibilityRole="alert" style={[typography.caption, { color: theme.colors.danger, width: "100%" }]}>{hint}</Text> : null}
    </View>
  </View>;
}

function RowAction({ label, icon, onPress, disabled }: { label: string; icon: IconName; onPress: () => void; disabled: boolean }) {
  const theme = useAppTheme();
  // The compact capsule sits inside a 44pt touch target.
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}>
    {({ pressed }) => <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1, borderRadius: theme.radius.pill, borderColor: theme.colors.borderStrong, backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface }}>
      <AppIcon name={icon} size={14} color={theme.colors.accent} />
      <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.text }]}>{label}</Text>
    </View>}
  </Pressable>;
}
