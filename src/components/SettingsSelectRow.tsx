import { haptics } from "@/src/platform/haptics";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { traceAction } from "@/src/data/interaction-trace";
import type { IconName } from "@/src/icons";
import { AppIcon } from "@/src/ui";
import { MenuAnchor, MorphMenuSurface, useMenuRowHighlight, type MorphRect } from "@/src/ui/MorphMenuSurface";
import { GlassBackdropScope } from "@/src/ui/Glass";
import { raiseToastOverlay, ToastViewport } from "@/src/components/Toast";

export type SelectOption<T extends string> = { value: T; label: string };

// iOS 27's pop-up menu, measured at 402 pt: at least 250 pt wide, 42 pt rows inside 10 pt of padding, the check
// centred 27 pt in and the labels 44 pt in, its top 6 pt above the value it opens from.
const ROW_HEIGHT = 42;
const MENU_PADDING = 10;
const MIN_WIDTH = 250;
const MAX_WIDTH = 300;
const RAISE = 6;
const ROW = { height: ROW_HEIGHT, paddingLeft: 19, paddingRight: 16 } as const;
const CHECK = { width: 17, marginRight: 8, alignItems: "center" } as const;
const MARGIN = 12;
/** A touch held this long without moving opens the menu under the finger; a quicker one is a tap or a scroll. */
const PRESS_DELAY_MS = 120;
const TOUCH_SLOP = 8;

type PressState =
  | { phase: "idle" | "held" | "sliding"; x: number; y: number }
  | { phase: "pending"; timer: ReturnType<typeof setTimeout>; x: number; y: number };
type MenuLayout = { left: number; top: number; width: number; height: number; anchor: MorphRect };

/** Places the menu over the value it replaces, trailing edges aligned; it grows upward when the space below runs out. */
function menuLayout(anchor: MorphRect, window: { width: number; height: number }, insets: { top: number; bottom: number }, width: number, count: number): MenuLayout {
  const height = count * ROW_HEIGHT + MENU_PADDING * 2;
  const left = Math.min(Math.max(MARGIN, anchor.x + anchor.width - width), window.width - MARGIN - width);
  const upward = anchor.y + height > window.height - insets.bottom - MARGIN;
  const top = upward ? Math.max(insets.top + MARGIN, anchor.y + anchor.height + RAISE - height) : anchor.y - RAISE;
  return { left, top, width, height, anchor };
}

/**
 * A settings row whose value is chosen in place from a pop-up menu, as an iOS pop-up button does:
 * the current value sits at the trailing edge with up-down chevrons, and the menu springs out of it
 * with a check on the current choice. A tap opens the menu; a press held on the row opens it under
 * the finger, and sliding onto a choice and letting go picks it, with a selection tick per row.
 * This drawn version serves Android; iOS uses the system control (`SettingsSelectRow.ios.tsx`).
 */
export type SettingsSelectRowProps<T extends string> = {
  icon: IconName;
  title: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  last?: boolean;
  disabled?: boolean;
  /** Lets the owning scroll view stop scrolling while a press slides through the drawn menu; the system menu needs no scroll lock. */
  onOpenChange?: (open: boolean) => void;
  testID?: string;
};

export function SettingsSelectRow<T extends string>({ icon, title, value, options, onChange, last = false, disabled = false, onOpenChange, testID }: SettingsSelectRowProps<T>) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // Held in state rather than a ref: touch callbacks measure it, and they are built during render.
  const [anchor, setAnchor] = useState<View | null>(null);
  const anchorRef = useRef<View | null>(null);
  const attachAnchor = useCallback((node: View | null) => { anchorRef.current = node; setAnchor(node); }, []);
  const [menu, setMenu] = useState<MenuLayout | null>(null);
  // The menu stays mounted while it shrinks back into the value; `menuOpen` is false for that stretch.
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  // Touch callbacks read the latest menu and press through shared values: a press outlives the render that began it.
  const menuRef = useSharedValue<MenuLayout | null>(null);
  const highlightRef = useSharedValue<number | null>(null);
  const press = useSharedValue<PressState>({ phase: "idle", x: 0, y: 0 });
  const current = options.find((option) => option.value === value);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ...options.map((option) => Array.from(option.label).length * 10 + 60)));

  useEffect(() => () => { const state = press.get(); if (state.phase === "pending") clearTimeout(state.timer); }, [press]);

  const open = () => {
    if (disabled) return;
    traceAction("select_open", { title });
    anchor?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      const layout = menuLayout({ x, y, width: anchorWidth, height: anchorHeight }, window, insets, width, options.length);
      menuRef.set(layout);
      setMenu(layout);
      setMenuOpen(true);
      setHighlight(null);
      onOpenChange?.(true);
    });
  };
  const rowRef = useRef<View>(null);
  /**
   * A touch while the menu runs back into its value. The menu's Modal is a window of its own and takes every touch
   * until it unmounts, so the screen under it cannot see this one: a touch on this row reopens the menu, and any
   * other touch ends the close at once so the next touch reaches the screen.
   */
  const touchWhileClosing = (x: number, y: number) => {
    const row = rowRef.current;
    if (!row) { setMenu(null); return; }
    row.measureInWindow((rowX, rowY, rowWidth, rowHeight) => {
      if (x >= rowX && x <= rowX + rowWidth && y >= rowY && y <= rowY + rowHeight) open();
      else setMenu(null);
    });
  };
  const close = () => {
    menuRef.set(null);
    highlightRef.set(null);
    setMenuOpen(false);
    setHighlight(null);
    onOpenChange?.(false);
  };
  const choose = (next: T) => {
    traceAction("select_choose", { title, value: next });
    close();
    if (next !== value) {
      haptics.selection();
      onChange(next);
    }
  };
  /** The option under a window point, if the point is on the menu. */
  const optionAt = (x: number, y: number) => {
    const layout = menuRef.get();
    if (!layout || x < layout.left || x > layout.left + layout.width) return null;
    const index = Math.floor((y - layout.top - MENU_PADDING) / ROW_HEIGHT);
    return index >= 0 && index < options.length ? index : null;
  };

  // Touch runs on the JS thread: the menu lives in React state and the work per move is a lookup.
  const gesture = Gesture.Manual()
    .runOnJS(true)
    .enabled(!disabled)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      // Inside a scroll view a touch may start a scroll, so the menu waits a beat before claiming it.
      const timer = setTimeout(() => {
        const state = press.get();
        press.set({ phase: "held", x: state.x, y: state.y });
        manager.activate();
        open();
      }, PRESS_DELAY_MS);
      press.set({ phase: "pending", timer, x: touch.absoluteX, y: touch.absoluteY });
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      const state = press.get();
      const moved = Math.hypot(touch.absoluteX - state.x, touch.absoluteY - state.y) > TOUCH_SLOP;
      if (state.phase === "pending") {
        if (moved) {
          clearTimeout(state.timer);
          press.set({ phase: "idle", x: state.x, y: state.y });
          manager.fail();
        }
        return;
      }
      if (state.phase === "idle") return;
      if (state.phase === "held") {
        if (!moved) return;
        press.set({ ...state, phase: "sliding" });
      }
      const index = optionAt(touch.absoluteX, touch.absoluteY);
      if (index !== highlightRef.get()) {
        highlightRef.set(index);
        setHighlight(index);
        if (index !== null) haptics.selection();
      }
    })
    .onTouchesUp((event, manager) => {
      const state = press.get();
      if (state.phase === "pending") {
        // A quick tap: open on release and leave the menu up for a second tap.
        clearTimeout(state.timer);
        press.set({ phase: "idle", x: state.x, y: state.y });
        manager.fail();
        open();
        return;
      }
      const touch = event.changedTouches[0];
      // A press let go where it went down leaves the menu open; one slid onto a choice picks it.
      const index = state.phase === "sliding" && touch ? optionAt(touch.absoluteX, touch.absoluteY) : null;
      highlightRef.set(null);
      if (index !== null) choose(options[index].value);
      else setHighlight(null);
      manager.end();
    })
    // Already finishing: failing it here re-enters the state change (see FloatingTabBar).
    .onTouchesCancelled(() => {
      const state = press.get();
      if (state.phase === "pending") {
        clearTimeout(state.timer);
        press.set({ phase: "idle", x: state.x, y: state.y });
      }
      highlightRef.set(null);
      setHighlight(null);
    });

  return <>
    <GestureDetector gesture={gesture}>
      <View
        ref={rowRef}
        collapsable={false}
        accessible
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: current?.label }}
        accessibilityState={{ expanded: menuOpen, disabled }}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={open}
        testID={testID}
      >
        <SettingsRow icon={icon} title={title} last={last} disabled={disabled}>
          <MenuAnchor ref={attachAnchor} open={menuOpen} className="shrink flex-row items-center gap-1" style={{ maxWidth: "50%" }}>
            <Text numberOfLines={1} className="shrink text-body text-fg-muted">{current?.label}</Text>
            <AppIcon name="chevrons-up-down" size={16} tone="muted" />
          </MenuAnchor>
        </SettingsRow>
      </View>
    </GestureDetector>
    {menu ? <SelectMenu menu={menu} open={menuOpen} title={title} options={options} value={value} highlight={highlight} onChoose={choose} onClose={close} onClosed={() => setMenu(null)} onTouchWhileClosing={touchWhileClosing} anchorRef={anchorRef} /> : null}
  </>;
}

function SelectMenu<T extends string>({ menu, open, title, options, value, highlight, onChoose, onClose, onClosed, onTouchWhileClosing, anchorRef }: {
  menu: MenuLayout;
  open: boolean;
  title: string;
  options: readonly SelectOption<T>[];
  value: T;
  highlight: number | null;
  onChoose: (value: T) => void;
  onClose: () => void;
  onClosed: () => void;
  /** A touch while closing, in window coordinates. */
  onTouchWhileClosing: (x: number, y: number) => void;
  anchorRef: RefObject<View | null>;
}) {
  const rootRef = useRef<View>(null);
  // The layout is in window coordinates; the modal's root is normally at the window origin, but measure it.
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  // A tap on the open menu lights its row too; a press slid from the settings row lights it through `highlight`.
  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onShow={raiseToastOverlay} onRequestClose={onClose}>
    <GlassBackdropScope inside={false}>
    <View
      ref={rootRef}
      collapsable={false}
      // Closing, the root takes the touch itself (box-only) so the rows and backdrop cannot.
      pointerEvents={open ? "auto" : "box-only"}
      onStartShouldSetResponder={() => !open}
      onResponderGrant={(event) => onTouchWhileClosing(event.nativeEvent.pageX + origin.x, event.nativeEvent.pageY + origin.y)}
      className="flex-1"
      onLayout={() => rootRef.current?.measureInWindow((x, y) => setOrigin((current) => current.x === x && current.y === y ? current : { x, y }))}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} style={StyleSheet.absoluteFill} onPress={onClose} />
      <MorphMenuSurface
        accessibilityRole="menu"
        accessibilityLabel={title}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        // It grows out of the value it replaces and shrinks back into it.
        anchor={{ ...menu.anchor, x: menu.anchor.x - origin.x, y: menu.anchor.y - origin.y }}
        style={{ left: menu.left - origin.x, top: menu.top - origin.y, width: menu.width }}
        open={open}
        onClosed={onClosed}
        anchorRef={anchorRef}
      >
        <SelectMenuRows options={options} value={value} highlight={highlight} onChoose={onChoose} />
      </MorphMenuSurface>
    </View>
    <ToastViewport />
    </GlassBackdropScope>
  </Modal>;
}

/** The menu's rows, inside its surface so they can light a row the way that surface draws it. */
function SelectMenuRows<T extends string>({ options, value, highlight, onChoose }: { options: readonly SelectOption<T>[]; value: T; highlight: number | null; onChoose: (value: T) => void }) {
  // A tap on the open menu lights its row too; a press slid from the settings row lights it through `highlight`.
  const [pressed, setPressed] = useState<number | null>(null);
  const rowViews = useRef<(View | null)[]>([]);
  const { light, plate } = useMenuRowHighlight();
  const lit = highlight ?? pressed;
  useEffect(() => {
    light(lit === null ? null : { view: rowViews.current[lit] ?? null, frame: { top: MENU_PADDING + lit * ROW_HEIGHT, height: ROW_HEIGHT } });
  }, [light, lit]);
  return <View style={{ paddingVertical: MENU_PADDING }}>
    {plate}
    {options.map((option, index) => {
      const selected = option.value === value;
      return <Pressable
        key={option.value}
        ref={(node) => { rowViews.current[index] = node; }}
        accessibilityRole="menuitem"
        accessibilityLabel={option.label}
        accessibilityState={{ checked: selected }}
        onPressIn={() => setPressed(index)}
        onPressOut={() => setPressed(null)}
        onPress={() => onChoose(option.value)}
        className="flex-row items-center"
        style={ROW}
      >
        <View style={CHECK}>{selected ? <AppIcon name="check" size={17} tone="fg" /> : null}</View>
        <Text numberOfLines={1} className="min-w-0 flex-1 text-body text-fg">{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}
