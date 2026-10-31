import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import { interactiveDismissDisabled, presentationDragIndicator } from "@expo/ui/swift-ui/modifiers";
import { Keyboard, Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { setDialogOpen } from "@/src/data/interaction-trace";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { IconButton } from "@/src/ui";
import { SheetConfirmButton } from "@/src/components/SheetConfirmButton";
import type { AdaptiveSheetProps } from "./AdaptiveSheet";

export type { AdaptiveSheetProps, SheetConfirm } from "./AdaptiveSheet";

const COMPACT_BREAKPOINT = 720;

export function AdaptiveSheet(props: AdaptiveSheetProps) {
  return props.detent === "fit" ? <FitSheet {...props} /> : <PageSheet {...props} />;
}

function PageSheet({ visible, title, subtitle, onClose, children, footer, scrollable = true, dismissible = true, contentStyle, confirm, testID }: AdaptiveSheetProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // A phone's sheet ends at the screen's bottom edge, under the keyboard; an iPad card is moved clear by UIKit.
  const compact = Math.min(width, height) < COMPACT_BREAKPOINT;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const requestClose = useCallback(() => {
    if (dismissible && visible) onClose();
  }, [dismissible, onClose, visible]);

  useEffect(() => {
    if (!visible) return;
    setDialogOpen(`sheet:${title}`, true);
    return () => setDialogOpen(`sheet:${title}`, false);
  }, [title, visible]);

  useEffect(() => {
    if (!visible || !compact) return;
    const show = Keyboard.addListener("keyboardWillShow", (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
      setKeyboardHeight(0);
    };
  }, [compact, visible]);

  const bottomPadding = keyboardHeight > 0 ? keyboardHeight + theme.spacing.md : Math.max(insets.bottom, theme.spacing.lg);
  const bodyStyle = [CONTENT_PADDING, { paddingBottom: footer ? theme.spacing.lg : bottomPadding }, contentStyle];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={dismissible} onRequestClose={requestClose}>
      <GestureHandlerRootView testID={testID} accessibilityViewIsModal className="flex-1 bg-surface">
        <View className="min-h-14 flex-row items-center px-2 pt-2">
          <IconButton filled name="x" label={t("ui.sheet.close", { title })} disabled={!dismissible} onPress={requestClose} />
          <Text accessibilityRole="header" numberOfLines={1} className="flex-1 px-2 text-center text-headline font-semibold text-fg">{title}</Text>
          <SheetConfirmButton confirm={confirm} />
        </View>
        {subtitle ? <Text className="px-4 pb-2 text-center text-subhead text-fg-secondary">{subtitle}</Text> : null}
        {scrollable
          ? <ScrollView className="flex-1" contentContainerStyle={bodyStyle} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">{children}</ScrollView>
          : <View className="flex-1" style={bodyStyle}>{children}</View>}
        {footer ? <View className="border-border px-4 pt-3" style={{ borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: bottomPadding }}>{footer}</View> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * A short sheet as SwiftUI presents it, sized to its content (`fitToContents`), with the system's grabber,
 * swipe to dismiss, and keyboard avoidance. The React Native content is hosted inside the sheet.
 */
function FitSheet({ visible, title, subtitle, onClose, children, footer, dismissible = true, contentStyle, confirm, testID }: AdaptiveSheetProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  // Owners often clear the data behind a sheet as they close it; keep showing what was open while it leaves.
  const [shown, setShown] = useState<ReactNode>(children);
  if (visible && shown !== children) setShown(children);
  useEffect(() => {
    if (!visible) return;
    setDialogOpen(`sheet:${title}`, true);
    return () => setDialogOpen(`sheet:${title}`, false);
  }, [title, visible]);
  return <Host colorScheme={theme.mode} style={HIDDEN_HOST}>
    <BottomSheet isPresented={visible} fitToContents onIsPresentedChange={(presented) => { if (!presented && dismissible) onClose(); }}>
      <Group modifiers={[interactiveDismissDisabled(!dismissible), presentationDragIndicator("visible")]}>
        <RNHostView matchContents={{ vertical: true }}>
          <View testID={testID} accessibilityViewIsModal className="bg-surface pb-4">
            <View className="min-h-14 flex-row items-center px-2 pt-3">
              <IconButton filled name="x" label={t("ui.sheet.close", { title })} disabled={!dismissible} onPress={() => { if (dismissible) onClose(); }} />
              <Text accessibilityRole="header" numberOfLines={1} className="flex-1 px-2 text-center text-headline font-semibold text-fg">{title}</Text>
              <SheetConfirmButton confirm={confirm} />
            </View>
            {subtitle ? <Text className="px-4 pb-2 text-center text-subhead text-fg-secondary">{subtitle}</Text> : null}
            <View style={[CONTENT_PADDING, contentStyle]}>{visible ? children : shown}</View>
            {footer ? <View className="mt-4 border-border px-4 pt-3" style={{ borderTopWidth: StyleSheet.hairlineWidth }}>{footer}</View> : null}
          </View>
        </RNHostView>
      </Group>
    </BottomSheet>
  </Host>;
}

const HIDDEN_HOST = { position: "absolute", width: 0, height: 0 } as const;
const CONTENT_PADDING = { paddingHorizontal: 16, paddingTop: 12 } as const;
