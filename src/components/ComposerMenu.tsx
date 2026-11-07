import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Keyboard, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "@/src/i18n";
import { getComposerMenuLayout, type ComposerMenuAnchor } from "@/src/ui/composer-menu-layout";
import { MorphMenuSurface, useMenuPresence } from "@/src/ui/MorphMenuSurface";
import { raiseToastOverlay, ToastViewport } from "@/src/components/Toast";

export type ComposerMenuProps = {
  /** The composer button that opened the menu; the menu grows out of it and shrinks back into it. */
  anchorRef: RefObject<View | null>;
  title: string;
  onClose: () => void;
  children: ReactNode;
  preferredWidth: number;
  fillHeight?: boolean;
  /** `panel` for the model selector; `glass` for a menu that iOS shows as its system menu. */
  material?: "glass" | "panel";
  testID: string;
};

export function ComposerMenu({ anchorRef, title, onClose, children, preferredWidth, fillHeight = false, material = "panel", testID }: ComposerMenuProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [viewport, setViewport] = useState({ width, height });
  const [keyboardTop, setKeyboardTop] = useState<number | null>(() => Keyboard.metrics()?.screenY ?? null);
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null);
  const presence = useMenuPresence();
  const measureAnchor = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      setAnchor({ x, y, width: anchorWidth, height: anchorHeight });
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measureAnchor);
    return () => cancelAnimationFrame(frame);
  }, [height, keyboardTop, measureAnchor, viewport.height, viewport.width, width]);

  useEffect(() => {
    // The composer moves when its keyboard closes or the model search keyboard opens.
    const frameEvent = Platform.OS === "ios" ? "keyboardDidChangeFrame" : "keyboardDidShow";
    const frame = Keyboard.addListener(frameEvent, (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardTop(null));
    return () => { frame.remove(); hide.remove(); };
  }, []);

  const layout = anchor ? getComposerMenuLayout({ anchor, windowWidth: viewport.width, windowHeight: viewport.height, topInset: insets.top, bottomInset: keyboardTop === null ? insets.bottom : 0, keyboardTop, preferredWidth }) : null;
  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent hardwareAccelerated onShow={() => { measureAnchor(); raiseToastOverlay(); }} onRequestClose={onClose}>
    <View className="flex-1" pointerEvents={presence.open ? "auto" : "none"} onLayout={(event) => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("ui.sheet.close", { title })} style={StyleSheet.absoluteFill} onPress={onClose} />
      {layout && anchor ? <MorphMenuSurface
        testID={testID}
        material={material}
        anchor={anchor}
        open={presence.open}
        onClosed={presence.onExited}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        accessibilityLabel={title}
        role="dialog"
        style={[layout, { height: fillHeight ? layout.maxHeight : undefined }]}
      >{children}</MorphMenuSurface> : null}
      <ToastViewport />
    </View>
  </Modal>;
}
