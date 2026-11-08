import { useEffect, useRef } from "react";
import { ActionSheetIOS, Alert } from "react-native";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import type { ConfirmSheetProps, NoticeSheetProps } from "./SystemDialogs";

export type { ConfirmSheetProps, NoticeSheetProps } from "./SystemDialogs";

/**
 * iOS: the system action sheet. It shows once per opening; while the confirmed work runs nothing is
 * on screen, and a failure comes back as an alert offering a retry. The owner closes it on success,
 * as it closes the drawn sheet.
 */
export function ConfirmSheet({ visible, title, subtitle, message, confirmLabel, destructive = true, busy = false, error = null, onConfirm, onClose }: ConfirmSheetProps) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  // Callbacks and copy are read when the system calls back, not when the sheet was shown.
  const latest = useRef({ onConfirm, onClose, title, error });
  useEffect(() => { latest.current = { onConfirm, onClose, title, error }; });
  // `confirming` from a confirm or retry until its outcome is handled; a retry after closing is dropped.
  const stage = useRef<"closed" | "shown" | "confirming">("closed");
  const confirm = () => {
    if (stage.current === "closed") return;
    stage.current = "confirming";
    latest.current.onConfirm();
  };

  useEffect(() => {
    if (!visible) {
      stage.current = "closed";
      return;
    }
    if (stage.current !== "closed") return;
    stage.current = "shown";
    ActionSheetIOS.showActionSheetWithOptions({
      title,
      message: [subtitle, message].filter(Boolean).join("\n\n"),
      options: [t("common.cancel"), confirmLabel],
      cancelButtonIndex: 0,
      destructiveButtonIndex: destructive ? 1 : undefined,
      userInterfaceStyle: theme.mode,
    }, (index) => {
      if (index === 1) {
        confirm();
      } else {
        latest.current.onClose();
      }
    });
  }, [confirmLabel, destructive, message, subtitle, t, theme.mode, title, visible]);

  useEffect(() => {
    // Only a failure of the confirm just made is reported; an older error on the screen is not.
    if (!visible || busy || stage.current !== "confirming") return;
    stage.current = "shown";
    const failure = latest.current.error;
    // Still open without an error: the owner reported the failure its own way, so let go of the sheet.
    if (!failure) { latest.current.onClose(); return; }
    Alert.alert(latest.current.title, failure, [
      { text: t("common.cancel"), style: "cancel", onPress: () => latest.current.onClose() },
      { text: t("common.retry"), isPreferred: true, onPress: confirm },
    ], { userInterfaceStyle: theme.mode, onDismiss: () => latest.current.onClose() });
  }, [busy, error, t, theme.mode, visible]);

  return null;
}

/** iOS: the system alert, shown once per notice. */
export function NoticeSheet({ notice, fallbackTitle, onClose }: NoticeSheetProps) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!notice) return;
    Alert.alert(notice.title || fallbackTitle, notice.message, [{ text: t("common.done"), onPress: () => close.current() }], { userInterfaceStyle: theme.mode, onDismiss: () => close.current() });
  }, [fallbackTitle, notice, t, theme.mode]);
  return null;
}
