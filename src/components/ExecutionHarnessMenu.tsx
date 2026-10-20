import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RefObject } from "react";
import { harnessLabel, LOCAL_HARNESSES } from "@neta-art/cohub";
import type { RuntimeHarness, SpaceRuntimeStatus } from "@/src/data/runtime";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import { useTranslation } from "@/src/i18n";
import { AppIcon, HarnessIcon, IconButton } from "@/src/ui";

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
  const available = useMemo(() => new Set(status?.capabilities?.harnesses ?? []), [status]);
  // Mirrors web: offer connected Harnesses, and keep the current choice listed so its unavailable state is explained.
  const options = useMemo<RuntimeHarness[]>(() => ["cohub", ...LOCAL_HARNESSES.filter((harness) => (status?.online === true && available.has(harness)) || harness === value)], [available, status?.online, value]);

  return open ? <ComposerMenu anchorRef={anchorRef} title={t("runtime.harness.title")} onClose={onClose} preferredWidth={300} testID="chat-harness-selector-menu">
      <View className="px-4 pt-3 pb-1.5">
        <Text className="text-caption text-fg-muted">{t("runtime.harness.title")}</Text>
        {localSpace ? <Text className="text-micro font-semibold text-fg-faint mt-1">{status?.online ? t("runtime.connected") : t("runtime.offline")}</Text> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 6 }}>
        {options.map((harness) => {
          const enabled = harness === "cohub" || (localSpace && status?.online === true && available.has(harness));
          const selected = value === harness;
          return <Pressable
            key={harness}
            testID={`chat-harness-option-${harness}`}
            accessibilityRole="radio"
            accessibilityLabel={harnessLabel(harness)}
            accessibilityState={{ checked: selected, disabled: !enabled }}
            disabled={!enabled}
            onPress={() => { onSelect(harness); onClose(); }}
            className={`min-h-13 flex-row items-center gap-2.5 rounded-sm px-2.5 py-2 disabled:opacity-50 ${selected ? "bg-surface-raised" : "active:bg-surface-raised"}`}
          >
            <HarnessIcon harness={harness} size={20} />
            <View className="flex-1 min-w-0">
              <Text className="text-body font-semibold text-fg">{harnessLabel(harness)}</Text>
              <Text numberOfLines={1} className="text-micro font-semibold text-fg-muted">{harness === "cohub" ? t("runtime.cloudExecution") : enabled ? t("runtime.localExecution") : localSpace && !status?.online ? t("runtime.offline") : t("runtime.notConnected")}</Text>
            </View>
            {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
          </Pressable>;
        })}
        {!localSpace ? <Text className="text-micro font-semibold px-2 pt-1.5 pb-2 text-fg-faint">{t("runtime.localOnly")}</Text> : null}
        {localSpace && !status?.online ? <View className="px-2 pt-1"><IconButton name="refresh" label={t("common.retry")} onPress={onRefresh} /></View> : null}
      </ScrollView>
    </ComposerMenu> : null;
}
