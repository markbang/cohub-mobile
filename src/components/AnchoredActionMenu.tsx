import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenVisible } from "@/src/ui/pane";
import { AppIcon, type IconName } from "@/src/ui";
import { useTranslation } from "@/src/i18n";
import { getAnchoredMenuLayout } from "@/src/ui/anchored-menu-layout";
import { setDialogOpen, traceAction } from "@/src/data/interaction-trace";
import { menuScrub } from "@/src/motion";
import { haptics } from "@/src/platform/haptics";
import { usePredictiveBackBlock } from "@/src/platform/predictive-back";
import { MorphMenuSurface, dragMenu, useMenuDrag, useMenuPresence, useMenuRowHighlight, type MenuRowFrame, type MorphRect } from "@/src/ui/MorphMenuSurface";

/** A menu item; `checked` (on every item of a menu of choices) draws a check before its glyph, `detail` a second line. */
export type AnchoredMenuAction = {
  icon: IconName;
  title: string;
  disabled?: boolean;
  checked?: boolean;
  detail?: string;
  onPress: () => void;
};

export type AnchoredMenuSection = { title?: string; actions: readonly AnchoredMenuAction[] };

/** What the drawn menu takes: every item has a glyph, or none does (a picker's choices). */
type MenuItem = Omit<AnchoredMenuAction, "icon"> & { icon?: IconName };
type MenuSection = { title?: string; actions: readonly MenuItem[] };

/**
 * Drives the rows from a touch that began on the trigger, in window coordinates: a press held on a select row opens
 * its menu under the finger, and sliding onto a choice and letting go picks it, as iOS pop-up buttons do.
 */
export type AnchoredMenuDrive = {
  move: (pageX: number, pageY: number) => void;
  /** Picks the row under the finger; lifted anywhere else, the menu stays open. */
  release: (pageX: number, pageY: number) => void;
};

type AnchoredActionMenuProps = {
  anchorRef: RefObject<View | null>;
  title: string;
  /** One group; or pass `sections` for groups split by separators, as in an iOS menu. */
  actions?: readonly MenuItem[];
  sections?: readonly MenuSection[];
  /**
   * Draws the menu as UIKit's navigation-bar menus are drawn on iOS (`NativeHeader`): this heading in grey above
   * the rows, and the check in its own column before each row's glyph rather than in its place.
   */
  heading?: string;
  /**
   * `plain`: a trigger without glass of its own, such as a select's value. The menu grows from a point on its trailing
   * chevron, since the glass draws its source as a drop the trigger's size, and does not draw the trigger.
   */
  trigger?: "glass" | "plain";
  /** Receives the rows' driver while they are mounted, and null after. */
  onDrive?: (drive: AnchoredMenuDrive | null) => void;
  onClose: () => void;
  testID: string;
};

/** The point on a plain trigger's chevron its menu grows from, in points. */
const PLAIN_SOURCE = 6;

export function AnchoredActionMenu({ anchorRef, title, actions = [], sections: sectionsProp, heading, trigger = "glass", onDrive, onClose, testID }: AnchoredActionMenuProps) {
  const sections = (sectionsProp ?? [{ actions }]).filter((section) => section.actions.length > 0);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useScreenVisible();
  const overlayRef = useRef<View>(null);
  const [layout, setLayout] = useState<ReturnType<typeof getAnchoredMenuLayout> | null>(null);
  const [anchor, setAnchor] = useState<MorphRect | null>(null);
  // Inside a `MenuPresence`, closing shrinks the menu back into its trigger before it unmounts.
  const { open, onExited } = useMenuPresence();
  const measure = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, viewportWidth, viewportHeight) => {
      anchorRef.current?.measureInWindow((anchorX, anchorY, anchorWidth, anchorHeight) => {
        setAnchor(trigger === "plain"
          ? { x: anchorX - x + anchorWidth - 8 - PLAIN_SOURCE / 2, y: anchorY - y + anchorHeight / 2 - PLAIN_SOURCE / 2, width: PLAIN_SOURCE, height: PLAIN_SOURCE }
          : { x: anchorX - x, y: anchorY - y, width: anchorWidth, height: anchorHeight });
        setLayout(getAnchoredMenuLayout({
          anchor: { x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight },
          viewport: { x, y, width: viewportWidth, height: viewportHeight },
          bottomInset: insets.bottom,
        }));
      });
    });
  }, [anchorRef, insets.bottom, trigger]);

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
      anchorRef={trigger === "plain" ? undefined : anchorRef}
      style={layout}
      open={open}
      onClosed={onExited}
    >
      <AnchoredMenuContent sections={sections} heading={heading} onDrive={onDrive} onClose={onClose} testID={testID} />
    </MorphMenuSurface> : null}
  </View>;
}

type MenuTouch = { x: number; y: number; pageX: number; pageY: number };

/**
 * A menu's rows as iOS draws them, for the drawn menus that hold them. A finger lights the row under it with a
 * capsule and can slide through the rows, with a tick per row, picking the one it lifts on (after
 * expo-glass-custom-menu); a drag that scrolls a long menu cancels the pick.
 */
export function AnchoredMenuContent({ sections, heading, onDrive, onClose, testID }: { sections: readonly MenuSection[]; heading?: string; onDrive?: (drive: AnchoredMenuDrive | null) => void; onClose: () => void; testID: string }) {
  const bar = heading !== undefined;
  // A menu of choices keeps its checks in a column of their own, before the glyphs.
  const checkColumn = bar || sections.some((section) => section.actions.some((action) => action.checked !== undefined));
  const drag = useMenuDrag();
  const actions = sections.flatMap((section) => section.actions);
  const glyphs = actions.some((action) => action.icon !== undefined);
  const rowsRef = useRef<View>(null);
  const frames = useRef<(MenuRowFrame | undefined)[]>([]);
  const rowViews = useRef<(View | null)[]>([]);
  const size = useRef({ width: 0, height: 0 });
  const touch = useRef<MenuTouch | null>(null);
  const activeRef = useRef<number | null>(null);
  const highlight = useMenuRowHighlight();

  const selectable = (index: number) => frames.current[index] !== undefined && actions[index] !== undefined && !actions[index].disabled;
  /** The row a sliding finger lights: the nearest one, while the finger is on or near the menu. */
  const rowNear = (x: number, y: number) => {
    const { width, height } = size.current;
    const slack = menuScrub.slack;
    if (x < -slack || x > width + slack || y < -slack || y > height + slack) return null;
    let best: number | null = null;
    let distance = Infinity;
    frames.current.forEach((frame, index) => {
      if (!frame || !selectable(index)) return;
      const gap = y < frame.top ? frame.top - y : y > frame.top + frame.height ? y - frame.top - frame.height : 0;
      if (gap < distance) { distance = gap; best = index; }
    });
    return best;
  };
  /** The row a lifted finger picks: only one it is on. */
  const rowAt = (x: number, y: number) => {
    if (x < 0 || x > size.current.width) return null;
    const index = frames.current.findIndex((frame) => frame !== undefined && y >= frame.top && y < frame.top + frame.height);
    return index >= 0 && selectable(index) ? index : null;
  };
  const light = (index: number | null) => {
    const previous = activeRef.current;
    if (index === previous) return;
    activeRef.current = index;
    const frame = index === null ? undefined : frames.current[index];
    highlight.light(index === null || !frame ? null : { view: rowViews.current[index] ?? null, frame });
    if (previous !== null && index !== null) haptics.selection();
  };
  const select = (index: number) => {
    const action = actions[index];
    if (!action || action.disabled) return;
    traceAction("menu_item", { menu: testID, item: action.title });
    onClose();
    action.onPress();
  };
  /** The touch in the rows' coordinates; moves are tracked by page offset, which holds while the rows stay put. */
  const point = (pageX: number, pageY: number) => {
    const start = touch.current;
    return start ? { x: start.x + pageX - start.pageX, y: start.y + pageY - start.pageY } : null;
  };
  const release = () => {
    touch.current = null;
    dragMenu(drag, 0, 0);
  };
  /** A window point in the rows' coordinates. */
  const fromWindow = (pageX: number, pageY: number, use: (x: number, y: number) => void) => {
    rowsRef.current?.measureInWindow((x, y) => use(pageX - x, pageY - y));
  };
  // One driver for the menu's life, which reaches the latest rows: its owner holds it in state.
  const latest = useRef<AnchoredMenuDrive>(null);
  const drive = useMemo<AnchoredMenuDrive>(() => ({
    move: (pageX, pageY) => latest.current?.move(pageX, pageY),
    release: (pageX, pageY) => latest.current?.release(pageX, pageY),
  }), []);
  useEffect(() => {
    if (!onDrive) return;
    onDrive(drive);
    return () => onDrive(null);
  }, [drive, onDrive]);
  useImperativeHandle(latest, () => ({
    move: (pageX, pageY) => fromWindow(pageX, pageY, (x, y) => light(rowNear(x, y))),
    release: (pageX, pageY) => fromWindow(pageX, pageY, (x, y) => {
      const index = rowAt(x, y);
      light(null);
      if (index !== null) select(index);
    }),
  }));

  let flat = 0;
  return <ScrollView style={{ flexGrow: 0 }} bounces={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.content}>
    {bar ? <Text accessibilityRole="header" numberOfLines={1} className="text-caption font-normal text-fg-tertiary" style={styles.heading}>{heading}</Text> : null}
    {/* The rows take every touch here (box-only) so a touch's coordinates are always the rows'. */}
    <View
      ref={rowsRef}
      collapsable={false}
      pointerEvents="box-only"
      onLayout={(event) => { size.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height }; }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => true}
      onResponderGrant={(event) => {
        const { locationX, locationY, pageX, pageY } = event.nativeEvent;
        touch.current = { x: locationX, y: locationY, pageX, pageY };
        light(rowNear(locationX, locationY));
      }}
      onResponderMove={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        const start = touch.current;
        const at = point(pageX, pageY);
        if (!start || !at) return;
        dragMenu(drag, pageX - start.pageX, pageY - start.pageY);
        light(rowNear(at.x, at.y));
      }}
      onResponderRelease={(event) => {
        const at = point(event.nativeEvent.pageX, event.nativeEvent.pageY);
        release();
        const index = at ? rowAt(at.x, at.y) : null;
        light(null);
        if (index !== null) select(index);
      }}
      onResponderTerminate={() => { release(); light(null); }}
    >
      {highlight.plate}
      {sections.map((section, sectionIndex) => <Fragment key={section.title ?? sectionIndex}>
        {sectionIndex > 0 ? <View className="bg-border" style={styles.separator} /> : null}
        {section.title ? <Text accessibilityRole="header" className="text-caption font-normal text-fg-tertiary" style={[styles.header, checkColumn ? styles.checkHeader : null]}>{section.title}</Text> : null}
        {section.actions.map((action) => {
          const index = flat++;
          return <View
            key={action.title}
            ref={(node) => { rowViews.current[index] = node; }}
            collapsable={false}
            accessible
            accessibilityRole="menuitem"
            accessibilityLabel={action.detail ? `${action.title}, ${action.detail}` : action.title}
            accessibilityState={{ disabled: Boolean(action.disabled), checked: action.checked }}
            accessibilityActions={action.disabled ? undefined : [{ name: "activate" }]}
            onAccessibilityAction={() => select(index)}
            onLayout={(event) => { frames.current[index] = { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }; }}
            className={`flex-row items-center ${action.disabled ? "opacity-45" : ""}`}
            style={[action.detail ? styles.detailRow : styles.row, checkColumn ? styles.checkRow : null]}
          >
            {checkColumn ? <View style={[styles.check, glyphs ? null : styles.checkOnly]}>{action.checked ? <AppIcon name="check" size={17} tone="fg" /> : null}</View> : null}
            {/* iOS 27's menu symbols run about 5% larger and heavier than the drawn glyphs at 22. */}
            {action.icon ? <View style={styles.glyph}><AppIcon name={action.icon} size={23} bold={0.15} tone="fg" /></View> : null}
            <View className="min-w-0 flex-1">
              <Text className="text-body text-fg">{action.title}</Text>
              {action.detail ? <Text numberOfLines={2} className="text-subhead text-fg-tertiary" style={styles.detail}>{action.detail}</Text> : null}
            </View>
          </View>;
        })}
      </Fragment>)}
    </View>
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
  // UIKit's navigation-bar menu (iOS 27), and any menu of choices: the heading's text 44 pt in, the check centred
  // 27 pt in, the glyph 55 and the title 80.
  heading: { paddingLeft: 44, paddingRight: 16, paddingTop: 9, paddingBottom: 14 },
  checkHeader: { paddingLeft: 44 },
  checkRow: { paddingLeft: 19 },
  check: { width: 17, marginRight: 5, alignItems: "center" },
  // iOS 27's pop-up menu: without glyphs the labels sit 44 pt in.
  checkOnly: { marginRight: 8 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
});
