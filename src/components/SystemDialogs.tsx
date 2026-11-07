import { useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { Easing, withTiming } from "react-native-reanimated";
import { useTranslation } from "@/src/i18n";
import type { IconName } from "@/src/icons";
import { curves, dialog } from "@/src/motion";
import { useAppTheme } from "@/src/theme";
import { Loader } from "@/src/ui";
import { ToastViewport } from "@/src/components/Toast";

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

const ALERT_TIMING = { duration: dialog.enter.duration, easing: Easing.bezier(...curves.easeOut) };

/** The alert settles in from above full size, as UIKit's does; the modal's own fade carries both its entrance and its exit. */
function alertEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: dialog.fromScale }] },
    animations: { opacity: withTiming(1, ALERT_TIMING), transform: [{ scale: withTiming(1, ALERT_TIMING) }] },
  };
}

/**
 * A yes-or-no confirmation. iOS presents the system action sheet (`SystemDialogs.ios.tsx`), which
 * iOS 26 shows as a centred card; Android draws that card: the question, then Cancel and the action
 * side by side as capsules.
 */
export function ConfirmSheet({ visible, title, subtitle, message, confirmLabel, destructive = true, busy = false, error = null, onConfirm, onClose, testID }: ConfirmSheetProps) {
  const { t } = useTranslation();
  const close = () => { if (!busy) onClose(); };
  return <AlertCard visible={visible} onClose={close} testID={testID} title={title} lines={[subtitle, message]} error={error}>
    <AlertButton label={t("common.cancel")} disabled={busy} onPress={close} />
    <AlertButton label={confirmLabel} tone={destructive ? "danger" : "accent"} busy={busy} onPress={onConfirm} />
  </AlertCard>;
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
  // The last notice stays drawn while the modal fades out, so its text does not blank mid-exit.
  const [shown, setShown] = useState(notice);
  if (notice && notice !== shown) setShown(notice);
  return <AlertCard visible={notice !== null} onClose={onClose} testID={testID} title={shown?.title || fallbackTitle} lines={[shown?.message]}>
    <AlertButton label={t("common.done")} tone="accent" onPress={onClose} />
  </AlertCard>;
}

/**
 * The iOS 26 alert, measured on a 402 pt iPhone: a 318 pt card 42 pt in from each edge with 34 pt
 * corners; the title's ink 26 pt below the top and its text 29 pt in; 48 pt capsule buttons 82 pt below
 * the title's ink, 8 apart and 15 pt from the card's edges.
 */
function AlertCard({ visible, onClose, testID, title, lines, error = null, children }: { visible: boolean; onClose: () => void; testID?: string; title: string; lines: readonly (string | undefined)[]; error?: string | null; children: ReactNode }) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const cardStyle = { width: Math.min(CARD_WIDTH, width - CARD_MARGIN * 2), borderRadius: CARD_RADIUS, borderCurve: "continuous" } as const;
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View className="flex-1 items-center justify-center" testID={testID}>
      {/* design-system: the scrim dims whatever sits underneath, so it stays black; iOS dims more in dark mode. */}
      <Pressable accessible={false} style={[StyleSheet.absoluteFill, theme.mode === "dark" ? SCRIM_DARK : SCRIM_LIGHT]} onPress={onClose} />
      <Reanimated.View entering={alertEntering} accessibilityViewIsModal accessibilityRole="alert" className="overflow-hidden bg-dialog-surface" style={cardStyle}>
        <View style={CONTENT_INSET}>
          <Text accessibilityRole="header" className="text-headline font-semibold text-fg">{title}</Text>
          {lines.filter(Boolean).map((line) => <Text key={line} className="mt-1.5 text-subhead text-fg-muted">{line}</Text>)}
          {error ? <Text accessibilityRole="alert" className="mt-1.5 text-caption text-danger">{error}</Text> : null}
        </View>
        <View className="flex-row gap-2" style={BUTTON_INSET}>{children}</View>
      </Reanimated.View>
      <ToastViewport />
    </View>
  </Modal>;
}

function AlertButton({ label, tone = "default", busy = false, disabled = false, onPress }: { label: string; tone?: "default" | "accent" | "danger"; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} className="min-h-12 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-dialog-button px-3 active:opacity-70 disabled:opacity-55">
    {busy ? <Loader /> : null}
    <Text numberOfLines={1} className={`shrink text-body ${tone === "danger" ? "text-danger" : tone === "accent" ? "font-semibold text-accent" : "text-fg"}`}>{label}</Text>
  </Pressable>;
}

const CARD_WIDTH = 318;
const CARD_MARGIN = 42;
const CARD_RADIUS = 34;
// Inter's ink starts about 4.5 pt into the headline's line, so 21 puts it 26 pt below the card's top.
const CONTENT_INSET = { paddingTop: 21, paddingHorizontal: 29 } as const;
const BUTTON_INSET = { marginTop: 18, paddingHorizontal: 15, paddingBottom: 15 } as const;
// design-system: the scrim dims whatever theme sits underneath, so it stays black at a fixed alpha.
const SCRIM_LIGHT = { backgroundColor: "rgba(0, 0, 0, 0.2)" } as const;
// design-system: as above; iOS dims the dark appearance by half.
const SCRIM_DARK = { backgroundColor: "rgba(0, 0, 0, 0.5)" } as const;
