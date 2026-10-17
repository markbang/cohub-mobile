import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RefObject } from "react";
import type { RuntimeHarness, SpaceRuntimeStatus } from "@/src/data/runtime";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, IconButton } from "@/src/ui";

const HARNESSES: RuntimeHarness[] = ["cohub", "pi", "codex"];

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
  const theme = useAppTheme();
  const { t } = useTranslation();
  const localSpace = status?.kind === "local";
  const available = useMemo(() => new Set(status?.capabilities?.harnesses ?? []), [status]);

  return open ? <ComposerMenu anchorRef={anchorRef} title={t("runtime.harness.title")} onClose={onClose} preferredWidth={300} testID="chat-harness-selector-menu">
      <View className="px-4 pt-3 pb-1.5">
        <Text className="text-caption text-fg-muted">{t("runtime.harness.title")}</Text>
        {localSpace ? <Text className="text-micro font-semibold text-fg-faint mt-1">{status?.online ? t("runtime.connected") : t("runtime.offline")}</Text> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 6 }}>
        {HARNESSES.map((harness) => {
          const enabled = harness === "cohub" || (localSpace && status?.online === true && available.has(harness));
          const selected = value === harness;
          return <Pressable
            key={harness}
            testID={`chat-harness-option-${harness}`}
            accessibilityRole="radio"
            accessibilityLabel={t(`runtime.harness.${harness}`)}
            accessibilityState={{ checked: selected, disabled: !enabled }}
            disabled={!enabled}
            onPress={() => { onSelect(harness); onClose(); }}
            style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: pressed || selected ? theme.colors.surfaceRaised : "transparent", opacity: enabled ? 1 : 0.48 })}
          >
            <AppIcon name={harness === "cohub" ? "cloud" : "monitor"} size={18} tone="muted" />
            <View className="flex-1 min-w-0">
              <Text className="text-body font-semibold text-fg">{t(`runtime.harness.${harness}`)}</Text>
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
