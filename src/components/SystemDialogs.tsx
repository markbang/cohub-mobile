import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn, SlideInDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "@/src/i18n";
import type { IconName } from "@/src/icons";
import { Loader } from "@/src/ui";

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  message: string;
  confirmLabel: string;
  confirmIcon?: IconName;
  /** A confirmation that removes or ends something; drawn and announced as destructive. */
  destructive?: boolean;
  /** Kept for call sites; an action sheet always has its Cancel. */
  showCancel?: boolean;
  busy?: boolean;
  /** The failure of the last confirm; shown in the sheet on Android, as a retry alert on iOS. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
};

const SHEET_SPRING = SlideInDown.springify().duration(420).dampingRatio(1);

/**
 * A yes-or-no confirmation. iOS presents the system action sheet (`SystemDialogs.ios.tsx`); Android
 * draws the same shape: the question and its action in one card, Cancel in its own below.
 */
export function ConfirmSheet({ visible, title, subtitle, message, confirmLabel, destructive = true, busy = false, error = null, onConfirm, onClose, testID }: ConfirmSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const close = () => { if (!busy) onClose(); };
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
    <View className="flex-1 justify-end px-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }} testID={testID}>
      {/* design-system: the scrim dims whatever theme sits underneath, so it stays black. */}
      <Pressable accessible={false} style={[StyleSheet.absoluteFill, SCRIM]} onPress={close} />
      <Reanimated.View entering={SHEET_SPRING} accessibilityViewIsModal className="gap-2">
        <View className="overflow-hidden rounded-md bg-surface-float" style={CONTINUOUS}>
          <View className="items-center gap-1 px-4 py-3.5">
            <Text accessibilityRole="header" className="text-center text-caption font-semibold text-fg-muted">{title}</Text>
            {[subtitle, message].filter(Boolean).map((line) => <Text key={line} className="text-center text-caption text-fg-muted">{line}</Text>)}
            {error ? <Text accessibilityRole="alert" className="mt-1 text-center text-caption text-danger">{error}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onConfirm} className="min-h-14 flex-row items-center justify-center gap-2 border-border active:bg-surface-pressed" style={HAIRLINE_TOP}>
            {busy ? <Loader /> : null}
            <Text className={`text-title ${destructive ? "text-danger" : "text-accent"}`}>{confirmLabel}</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} disabled={busy} onPress={close} className="min-h-14 items-center justify-center rounded-md bg-surface-float active:bg-surface-pressed disabled:opacity-55" style={CONTINUOUS}>
          <Text className="text-title font-semibold text-accent">{t("common.cancel")}</Text>
        </Pressable>
      </Reanimated.View>
    </View>
  </Modal>;
}

export type NoticeSheetProps = {
  notice: { title: string; message: string } | null;
  fallbackTitle: string;
  onClose: () => void;
  testID?: string;
};

/** An informational notice with one way out. iOS shows the system alert; Android draws the same alert. */
export function NoticeSheet({ notice, fallbackTitle, onClose, testID }: NoticeSheetProps) {
  const { t } = useTranslation();
  return <Modal visible={notice !== null} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <Reanimated.View entering={FadeIn.duration(150)} className="flex-1 items-center justify-center px-8" style={SCRIM} testID={testID}>
      <Reanimated.View entering={ZoomIn.springify().duration(320).dampingRatio(1)} accessibilityViewIsModal accessibilityRole="alert" className="w-full max-w-70 overflow-hidden rounded-md bg-surface-float" style={CONTINUOUS}>
        <View className="items-center gap-1 px-4 pb-4 pt-5">
          <Text accessibilityRole="header" className="text-center text-headline font-semibold text-fg">{notice?.title || fallbackTitle}</Text>
          <Text className="text-center text-subhead text-fg-secondary">{notice?.message ?? ""}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.done")} onPress={onClose} className="min-h-12 items-center justify-center border-border active:bg-surface-pressed" style={HAIRLINE_TOP}>
          <Text className="text-body font-semibold text-accent">{t("common.done")}</Text>
        </Pressable>
      </Reanimated.View>
    </Reanimated.View>
  </Modal>;
}

const CONTINUOUS = { borderCurve: "continuous" } as const;
const HAIRLINE_TOP = { borderTopWidth: StyleSheet.hairlineWidth } as const;
// design-system: the scrim dims whatever theme sits underneath, so it stays black at a fixed alpha.
const SCRIM = { backgroundColor: "rgba(0, 0, 0, 0.4)" } as const;
