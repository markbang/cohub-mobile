import { Pressable, Text, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { useTranslation } from "@/src/i18n";
import type { IconName } from "@/src/icons";
import { PrimaryButton } from "@/src/ui";

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  message: string;
  confirmLabel: string;
  confirmIcon?: IconName;
  /** A confirmation that removes or ends something; drawn and announced as destructive. */
  destructive?: boolean;
  /** Draws a Cancel beside the action on Android; iOS action sheets always have one. */
  showCancel?: boolean;
  busy?: boolean;
  /** The failure of the last confirm; shown in the sheet on Android, as a retry alert on iOS. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
};

/**
 * A yes-or-no confirmation. Android draws it as a sheet; iOS presents the system action sheet
 * (`SystemDialogs.ios.tsx`) with the same props.
 */
export function ConfirmSheet({ visible, title, subtitle, message, confirmLabel, confirmIcon = "check", destructive = true, showCancel = false, busy = false, error = null, onConfirm, onClose, testID }: ConfirmSheetProps) {
  const { t } = useTranslation();
  return <AdaptiveSheet
    visible={visible}
    title={title}
    subtitle={subtitle}
    onClose={() => { if (!busy) onClose(); }}
    dismissible={!busy}
    scrollable={false}
    testID={testID}
    footer={<View className="flex-row justify-end gap-2">
      {showCancel ? <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} className="min-h-12 justify-center px-4"><Text className="text-body font-semibold text-fg-secondary">{t("common.cancel")}</Text></Pressable> : null}
      <PrimaryButton label={confirmLabel} icon={confirmIcon} variant={destructive ? "danger" : "primary"} loading={busy} onPress={onConfirm} className={showCancel ? "min-h-12 px-4" : "flex-1"} />
    </View>}
  >
    <Text className="text-body text-fg-secondary">{message}</Text>
    {error ? <Text accessibilityRole="alert" className="mt-3 text-caption text-danger">{error}</Text> : null}
  </AdaptiveSheet>;
}

export type NoticeSheetProps = {
  notice: { title: string; message: string } | null;
  fallbackTitle: string;
  onClose: () => void;
  testID?: string;
};

/** An informational notice with one way out. Android draws a sheet; iOS shows the system alert. */
export function NoticeSheet({ notice, fallbackTitle, onClose, testID }: NoticeSheetProps) {
  const { t } = useTranslation();
  return <AdaptiveSheet
    visible={notice !== null}
    title={notice?.title || fallbackTitle}
    onClose={onClose}
    scrollable={false}
    testID={testID}
    footer={<View className="items-end"><PrimaryButton label={t("common.done")} onPress={onClose} className="min-h-11 px-4" /></View>}
  >
    <Text className="text-body text-fg-secondary">{notice?.message ?? ""}</Text>
  </AdaptiveSheet>;
}
