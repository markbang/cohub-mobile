import { Fragment, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RefObject } from "react";
import { harnessLabel } from "@neta-art/cohub";
import { harnessOptions, type RuntimeHarness, type SpaceRuntimeStatus } from "@/src/data/runtime";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import { useTranslation } from "@/src/i18n";
import { AppIcon, HarnessIcon, IconButton } from "@/src/ui";
import type { NativeMenuSection } from "@/src/components/NativeMenu";
import type { Translate } from "@/src/i18n";

/**
 * The picker's choices as system menu sections (iOS): cloud execution, then the local harnesses
 * with their availability, the current one checked, and a retry while the device is offline.
 */
export function harnessMenuSections({ value, status, t, onSelect, onRefresh }: { value: RuntimeHarness; status: SpaceRuntimeStatus | null; t: Translate; onSelect: (harness: RuntimeHarness) => void; onRefresh: () => void }): NativeMenuSection[] {
  const online = status?.kind === "local" && status.online;
  const [cloud, ...local] = harnessOptions(status);
  const item = ({ harness, availability }: (typeof local)[number]) => ({
    icon: "check" as const,
    title: harnessLabel(harness),
    detail: harness === "cohub" ? t("runtime.cloudExecution") : availability === "missing" ? t("runtime.harness.notInstalled") : undefined,
    checked: value === harness,
    disabled: availability !== "ready",
    onPress: () => onSelect(harness),
  });
  return [
    { actions: [item(cloud)] },
    { title: online ? t("runtime.localExecution") : `${t("runtime.localExecution")} · ${t("runtime.offline")}`, actions: [
      ...local.map(item),
      ...(online ? [] : [{ icon: "refresh" as const, title: t("common.retry"), onPress: onRefresh }]),
    ] },
  ];
}

export function HarnessPicker({
  anchorRef,
  value,
  status,
  open,
  onClose,
  onRefresh,
  onSelect,
}: {
  anchorRef: RefObject<View | null>;
  value: RuntimeHarness;
  status: SpaceRuntimeStatus | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (harness: RuntimeHarness) => void;
}) {
  const { t } = useTranslation();
  const localSpace = status?.kind === "local";
  const online = localSpace && status.online;
  const options = useMemo(() => harnessOptions(status), [status]);

  return open ? <ComposerMenu anchorRef={anchorRef} title={t("runtime.harness.title")} onClose={onClose} preferredWidth={300} testID="chat-harness-selector-menu">
      <View className="px-4 pt-3 pb-1.5">
        <Text className="text-caption text-fg-muted">{t("runtime.harness.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 6 }}>
        {options.map(({ harness, availability }, index) => {
          const local = harness !== "cohub";
          const enabled = availability === "ready";
          const selected = value === harness;
          return <Fragment key={harness}>
            {index === 1 ? <>
              <View className="h-px bg-border mx-0.5 my-1" />
              <View className="flex-row items-center justify-between px-2.5 pt-1.5 pb-1">
                <Text className="text-micro font-semibold text-fg-muted">{t("runtime.localExecution")}</Text>
                {!online ? <View className="flex-row items-center gap-1.5">
                  <View className="size-1.5 rounded-full bg-warning" />
                  <Text className="text-micro font-semibold text-fg-muted">{t("runtime.offline")}</Text>
                </View> : null}
              </View>
            </> : null}
            <Pressable
              testID={`chat-harness-option-${harness}`}
              accessibilityRole="radio"
              accessibilityLabel={availability === "missing" ? `${harnessLabel(harness)}, ${t("runtime.harness.notInstalled")}` : harnessLabel(harness)}
              accessibilityState={{ checked: selected, disabled: !enabled }}
              disabled={!enabled}
              onPress={() => { onSelect(harness); onClose(); }}
              className={`${local ? "min-h-11" : "min-h-13"} flex-row items-center gap-2.5 rounded-sm px-2.5 py-2 disabled:opacity-50 ${selected ? "bg-surface-raised" : "active:bg-surface-raised"}`}
            >
              <HarnessIcon harness={harness} size={20} />
              <View className="flex-1 min-w-0">
                <Text numberOfLines={1} className="text-body font-semibold text-fg">{harnessLabel(harness)}</Text>
                {!local ? <Text numberOfLines={1} className="text-micro font-semibold text-fg-muted">{t("runtime.cloudExecution")}</Text> : null}
              </View>
              {availability === "missing" ? <Text className="text-micro font-semibold text-fg-faint shrink-0">{t("runtime.harness.notInstalled")}</Text> : null}
              {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
            </Pressable>
          </Fragment>;
        })}
        {!localSpace ? <Text className="text-micro font-semibold px-2 pt-1.5 pb-2 text-fg-faint">{t("runtime.localOnly")}</Text> : null}
        {localSpace && !online ? <View className="px-2 pt-1"><IconButton name="refresh" label={t("common.retry")} onPress={onRefresh} /></View> : null}
      </ScrollView>
    </ComposerMenu> : null;
}
