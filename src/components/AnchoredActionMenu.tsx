import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { AppIcon, type IconName } from "@/src/ui";
import { useTranslation } from "@/src/i18n";
import { getAnchoredMenuLayout } from "@/src/ui/anchored-menu-layout";
import { setDialogOpen, traceAction } from "@/src/data/interaction-trace";
import { usePredictiveBackBlock } from "@/src/platform/predictive-back";
import { MorphMenuSurface, useMenuPresence, type MorphRect } from "@/src/ui/MorphMenuSurface";

/** A menu item; `checked` draws a check in place of its glyph and `detail` a second line, as iOS menus do. */
export type AnchoredMenuAction = {
  icon: IconName;
  title: string;
  disabled?: boolean;
  checked?: boolean;
  detail?: string;
  onPress: () => void;
};

export type AnchoredMenuSection = { title?: string; actions: readonly AnchoredMenuAction[] };

type AnchoredActionMenuProps = {
  anchorRef: RefObject<View | null>;
  title: string;
  /** One group; or pass `sections` for groups split by separators, as in an iOS menu. */
  actions?: readonly AnchoredMenuAction[];
  sections?: readonly AnchoredMenuSection[];
  onClose: () => void;
  testID: string;
};

export function AnchoredActionMenu({ anchorRef, title, actions = [], sections: sectionsProp, onClose, testID }: AnchoredActionMenuProps) {
  const sections = (sectionsProp ?? [{ actions }]).filter((section) => section.actions.length > 0);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const contentWidth = Math.max(...sections.flatMap((section) => section.actions).map((action) => Math.max(Array.from(action.title).length * 9, Array.from(action.detail ?? "").length * 7.5) + 16 * 2 + 22 + 12), 0);
  const overlayRef = useRef<View>(null);
  const [layout, setLayout] = useState<ReturnType<typeof getAnchoredMenuLayout> | null>(null);
  const [anchor, setAnchor] = useState<MorphRect | null>(null);
  // Inside a `MenuPresence`, closing shrinks the menu back into its trigger before it unmounts.
  const { open, onExited } = useMenuPresence();
  const measure = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, viewportWidth, viewportHeight) => {
      anchorRef.current?.measureInWindow((anchorX, anchorY, anchorWidth, anchorHeight) => {
        setAnchor({ x: anchorX - x, y: anchorY - y, width: anchorWidth, height: anchorHeight });
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

  usePredictiveBackBlock(open && focused);
  useEffect(() => {
    if (!open) return;
    if (!focused) { onClose(); return; }
    setDialogOpen(`menu:${testID}`, true);
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => { setDialogOpen(`menu:${testID}`, false); back.remove(); };
  }, [focused, onClose, open, testID]);

  // Keep this in the screen, not a native Modal, so actions can immediately open their own surface.
  return <View ref={overlayRef} collapsable={false} pointerEvents={open ? "auto" : "none"} onLayout={measure} style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("ui.sheet.close", { title })} style={StyleSheet.absoluteFill} onPress={onClose} />
    {layout && anchor ? <MorphMenuSurface
      testID={testID}
      accessibilityViewIsModal
      accessibilityRole="menu"
      accessibilityLabel={title}
      onAccessibilityEscape={onClose}
      anchor={anchor}
      style={layout}
      open={open}
      onClosed={onExited}
    >
      <ScrollView style={{ flexGrow: 0 }} bounces={false} keyboardShouldPersistTaps="always" contentContainerClassName="py-2">
        {sections.map((section, index) => <View key={section.title ?? index}>
          {index > 0 ? <View className="mx-4 my-1.5 border-t border-border" /> : null}
          {section.title ? <Text accessibilityRole="header" className="px-4 pb-1 pt-2 text-caption text-fg-muted">{section.title}</Text> : null}
          {section.actions.map((action) => <Pressable
            key={action.title}
            accessibilityRole="menuitem"
            accessibilityLabel={action.detail ? `${action.title}, ${action.detail}` : action.title}
            accessibilityState={{ disabled: Boolean(action.disabled), checked: action.checked }}
            disabled={action.disabled}
            onPress={() => { traceAction("menu_item", { menu: testID, item: action.title }); onClose(); action.onPress(); }}
            className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-surface-pressed disabled:opacity-45"
          >
            <AppIcon name={action.checked ? "check" : action.icon} size={22} tone={action.checked ? "accent" : "secondary"} />
            <View className="min-w-0 flex-1">
              <Text className="text-body text-fg">{action.title}</Text>
              {action.detail ? <Text numberOfLines={2} className="text-caption text-fg-muted">{action.detail}</Text> : null}
            </View>
          </Pressable>)}
        </View>)}
      </ScrollView>
    </MorphMenuSurface> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
});
