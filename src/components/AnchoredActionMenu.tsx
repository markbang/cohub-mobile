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
  /**
   * Draws the menu as UIKit's navigation-bar menus are drawn on iOS (`NativeHeader`): this heading in grey above
   * the rows, and the check in its own column before each row's glyph rather than in its place.
   */
  heading?: string;
  onClose: () => void;
  testID: string;
};

export function AnchoredActionMenu({ anchorRef, title, actions = [], sections: sectionsProp, heading, onClose, testID }: AnchoredActionMenuProps) {
  const sections = (sectionsProp ?? [{ actions }]).filter((section) => section.actions.length > 0);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
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
        }));
      });
    });
  }, [anchorRef, insets.bottom]);

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
      <AnchoredMenuContent sections={sections} heading={heading} onClose={onClose} testID={testID} />
    </MorphMenuSurface> : null}
  </View>;
}

/** A menu's rows as iOS draws them, for the drawn menus that hold them. */
export function AnchoredMenuContent({ sections, heading, onClose, testID }: { sections: readonly AnchoredMenuSection[]; heading?: string; onClose: () => void; testID: string }) {
  const bar = heading !== undefined;
  return <ScrollView style={{ flexGrow: 0 }} bounces={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.content}>
    {bar ? <Text accessibilityRole="header" numberOfLines={1} className="text-caption font-normal text-fg-faint" style={styles.heading}>{heading}</Text> : null}
    {sections.map((section, index) => <View key={section.title ?? index}>
      {index > 0 ? <View className="bg-border" style={styles.separator} /> : null}
      {section.title ? <Text accessibilityRole="header" className="text-caption font-normal text-fg-faint" style={styles.header}>{section.title}</Text> : null}
      {section.actions.map((action) => <Pressable
        key={action.title}
        accessibilityRole="menuitem"
        accessibilityLabel={action.detail ? `${action.title}, ${action.detail}` : action.title}
        accessibilityState={{ disabled: Boolean(action.disabled), checked: action.checked }}
        disabled={action.disabled}
        onPress={() => { traceAction("menu_item", { menu: testID, item: action.title }); onClose(); action.onPress(); }}
        className="flex-row items-center active:opacity-70 disabled:opacity-45"
        style={[action.detail ? styles.detailRow : styles.row, bar ? styles.barRow : null]}
      >
        {bar ? <View style={styles.check}>{action.checked ? <AppIcon name="check" size={17} tone="fg" /> : null}</View> : null}
        <View style={styles.glyph}><AppIcon name={action.checked && !bar ? "check" : action.icon} size={action.checked && !bar ? 17 : 22} tone="fg" /></View>
        <View className="min-w-0 flex-1">
          <Text className="text-body text-fg">{action.title}</Text>
          {action.detail ? <Text numberOfLines={2} className="text-subhead text-fg-faint" style={styles.detail}>{action.detail}</Text> : null}
        </View>
      </Pressable>)}
    </View>)}
  </ScrollView>;
}

// iOS 26's pull-down menu, measured at 402 pt and refitted to Inter's metrics so cap heights land where SF's
// do: 42 pt rows, a 28 pt glyph slot centred 40 pt in, titles 65 pt in, separators inset 24 pt with 10 pt around.
const styles = StyleSheet.create({
  content: { paddingVertical: 9.6 },
  row: { minHeight: 42, paddingLeft: 26, paddingRight: 16 },
  detailRow: { paddingTop: 12.6, paddingBottom: 9.25, paddingLeft: 26, paddingRight: 16 },
  glyph: { width: 28, marginRight: 11, alignItems: "center" },
  detail: { marginTop: -2, lineHeight: 18 },
  separator: { height: 1, marginHorizontal: 24, marginVertical: 10 },
  header: { paddingLeft: 28, paddingRight: 16, paddingTop: 3.5, paddingBottom: 7.5 },
  // UIKit's navigation-bar menu (iOS 27): the heading's text 44 pt in, the check centred 27 pt in, the glyph 55 and
  // the title 80.
  heading: { paddingLeft: 44, paddingRight: 16, paddingTop: 9, paddingBottom: 14 },
  barRow: { paddingLeft: 19 },
  check: { width: 17, marginRight: 5, alignItems: "center" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
});
