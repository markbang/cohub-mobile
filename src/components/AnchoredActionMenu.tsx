import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { AppIcon, type IconName } from "@/src/ui";
import { useTranslation } from "@/src/i18n";
import { getAnchoredMenuLayout } from "@/src/ui/anchored-menu-layout";

export type AnchoredMenuAction = {
  icon: IconName;
  title: string;
  disabled?: boolean;
  onPress: () => void;
};

type AnchoredActionMenuProps = {
  anchorRef: RefObject<View | null>;
  title: string;
  actions: readonly AnchoredMenuAction[];
  onClose: () => void;
  testID: string;
};

export function AnchoredActionMenu({ anchorRef, title, actions, onClose, testID }: AnchoredActionMenuProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const contentWidth = Math.max(...actions.map((action) => Array.from(action.title).length * 9 + 16 * 2 + 21 + 14), 0);
  const overlayRef = useRef<View>(null);
  const [layout, setLayout] = useState<ReturnType<typeof getAnchoredMenuLayout> | null>(null);
  const measure = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, viewportWidth, viewportHeight) => {
      anchorRef.current?.measureInWindow((anchorX, anchorY, anchorWidth, anchorHeight) => {
        setLayout(getAnchoredMenuLayout({
          anchor: { x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight },
          viewport: { x, y, width: viewportWidth, height: viewportHeight },
          bottomInset: insets.bottom,
          contentWidth,
        }));
      });
    });
  }, [anchorRef, contentWidth, insets.bottom]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [height, measure, width]);

  useEffect(() => {
    if (!focused) { onClose(); return; }
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => back.remove();
  }, [focused, onClose]);

  // Keep this in the screen, not a native Modal, so actions can immediately open their own surface.
  return <View ref={overlayRef} collapsable={false} onLayout={measure} style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("ui.sheet.close", { title })} style={StyleSheet.absoluteFill} onPress={onClose} />
    {layout ? <View
      testID={testID}
      accessibilityViewIsModal
      accessibilityRole="menu"
      accessibilityLabel={title}
      onAccessibilityEscape={onClose}
      className="absolute overflow-hidden rounded-md border-border bg-surface-raised shadow-float" style={[layout, { borderWidth: StyleSheet.hairlineWidth, borderCurve: "continuous" }]}
    >
      <ScrollView style={{ flexGrow: 0 }} bounces={false} keyboardShouldPersistTaps="always" contentContainerClassName="py-1.5">
        {actions.map((action) => <Pressable
          key={action.title}
          accessibilityRole="menuitem"
          accessibilityLabel={action.title}
          accessibilityState={{ disabled: Boolean(action.disabled) }}
          disabled={action.disabled}
          onPress={() => { onClose(); action.onPress(); }}
          className="min-h-12 flex-row items-center gap-3.5 px-4 py-3 active:bg-surface-pressed disabled:opacity-45"
        >
          <AppIcon name={action.icon} size={21} tone="secondary" />
          <Text className="min-w-0 flex-1 text-body text-fg">{action.title}</Text>
        </Pressable>)}
      </ScrollView>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
});
