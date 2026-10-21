import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { RADIUS } from "@/src/design/tokens";
import { traceAction } from "@/src/data/interaction-trace";
import type { IconName } from "@/src/icons";
import { AppIcon } from "@/src/ui";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";
import { PopoverSurface } from "@/src/ui/PopoverSurface";

export type SelectOption<T extends string> = { value: T; label: string };

const ROW_HEIGHT = 48;
const MENU_PADDING = 6;
const MIN_WIDTH = 180;
const MAX_WIDTH = 260;
const MARGIN = 12;
/** A touch held this long without moving opens the menu under the finger; a quicker one is a tap or a scroll. */
const PRESS_DELAY_MS = 120;
const TOUCH_SLOP = 8;

type PressState = { timer: ReturnType<typeof setTimeout> | null; x: number; y: number; sliding: boolean; held: boolean };
type MenuLayout = { left: number; top: number; width: number; height: number; above: boolean };
type Rect = { x: number; y: number; width: number; height: number };

/** Places the menu under the anchor's trailing edge, or above it when the space below runs out. */
function menuLayout(anchor: Rect, window: { width: number; height: number }, insets: { top: number; bottom: number }, width: number, count: number): MenuLayout {
  const height = count * ROW_HEIGHT + MENU_PADDING * 2;
  const left = Math.min(Math.max(MARGIN, anchor.x + anchor.width - width), window.width - MARGIN - width);
  const below = anchor.y + anchor.height + 6;
  const above = below + height > window.height - insets.bottom - MARGIN && anchor.y - 6 - height >= insets.top + MARGIN;
  return { left, top: above ? anchor.y - 6 - height : below, width, height, above };
}

/**
 * A settings row whose value is chosen in place from a pop-up menu, as an iOS pop-up button does:
 * the current value sits at the trailing edge with up-down chevrons, and the menu springs out of it
 * with a check on the current choice. A tap opens the menu; a press held on the row opens it under
 * the finger, and sliding onto a choice and letting go picks it, with a selection tick per row.
 * This drawn version serves Android; iOS uses the system control (`SettingsSelectRow.ios.tsx`).
 */
export function SettingsSelectRow<T extends string>({ icon, title, value, options, onChange, last = false, disabled = false, onOpenChange, testID }: {
  icon: IconName;
  title: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  last?: boolean;
  disabled?: boolean;
  /** Lets the owning scroll view stop scrolling while a press slides through the menu. */
  onOpenChange?: (open: boolean) => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // Held in state rather than a ref: touch callbacks measure it, and they are built during render.
  const [anchor, setAnchor] = useState<View | null>(null);
  const [menu, setMenu] = useState<MenuLayout | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  // Touch callbacks read the latest menu and press through shared values: a press outlives the render that began it.
  const menuRef = useSharedValue<MenuLayout | null>(null);
  const highlightRef = useSharedValue<number | null>(null);
  const press = useSharedValue<PressState>({ timer: null, x: 0, y: 0, sliding: false, held: false });
  const current = options.find((option) => option.value === value);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ...options.map((option) => Array.from(option.label).length * 10 + 64)));

  useEffect(() => () => { const timer = press.get().timer; if (timer) clearTimeout(timer); }, [press]);

  const open = () => {
    if (disabled) return;
    traceAction("select_open", { title });
    anchor?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      const layout = menuLayout({ x, y, width: anchorWidth, height: anchorHeight }, window, insets, width, options.length);
      menuRef.set(layout);
      setMenu(layout);
      setHighlight(null);
      onOpenChange?.(true);
    });
  };
  const close = () => {
    menuRef.set(null);
    highlightRef.set(null);
    setMenu(null);
    setHighlight(null);
    onOpenChange?.(false);
  };
  const choose = (next: T) => {
    traceAction("select_choose", { title, value: next });
    close();
    if (next !== value) {
      if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
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
        press.set({ ...press.get(), timer: null, held: true });
        manager.activate();
        open();
      }, PRESS_DELAY_MS);
      press.set({ timer, x: touch.absoluteX, y: touch.absoluteY, sliding: false, held: false });
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      const state = press.get();
      const moved = Math.hypot(touch.absoluteX - state.x, touch.absoluteY - state.y) > TOUCH_SLOP;
      if (!state.held) {
        if (moved && state.timer) {
          clearTimeout(state.timer);
          press.set({ ...state, timer: null });
          manager.fail();
        }
        return;
      }
      if (!state.sliding && !moved) return;
      if (!state.sliding) press.set({ ...state, sliding: true });
      const index = optionAt(touch.absoluteX, touch.absoluteY);
      if (index !== highlightRef.get()) {
        highlightRef.set(index);
        setHighlight(index);
        if (index !== null && Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
      }
    })
    .onTouchesUp((event, manager) => {
      const state = press.get();
      if (state.timer) {
        // A quick tap: open on release and leave the menu up for a second tap.
        clearTimeout(state.timer);
        press.set({ ...state, timer: null });
        manager.fail();
        open();
        return;
      }
      const touch = event.changedTouches[0];
      // A press let go where it went down leaves the menu open; one slid onto a choice picks it.
      const index = state.sliding && touch ? optionAt(touch.absoluteX, touch.absoluteY) : null;
      highlightRef.set(null);
      if (index !== null) choose(options[index].value);
      else setHighlight(null);
      manager.end();
    })
    .onTouchesCancelled((_event, manager) => {
      const state = press.get();
      if (state.timer) clearTimeout(state.timer);
      press.set({ ...state, timer: null });
      highlightRef.set(null);
      setHighlight(null);
      manager.fail();
    });

  return <>
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: current?.label }}
        accessibilityState={{ expanded: menu !== null, disabled }}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={open}
        testID={testID}
      >
        <SettingsRow icon={icon} title={title} last={last} disabled={disabled}>
          <View ref={setAnchor} collapsable={false} className="shrink flex-row items-center gap-1" style={{ maxWidth: "50%" }}>
            <Text numberOfLines={1} className="shrink text-body text-fg-muted">{current?.label}</Text>
            <AppIcon name="chevrons-up-down" size={15} tone="muted" />
          </View>
        </SettingsRow>
      </View>
    </GestureDetector>
    {menu ? <SelectMenu menu={menu} title={title} options={options} value={value} highlight={highlight} onChoose={choose} onClose={close} /> : null}
  </>;
}

function SelectMenu<T extends string>({ menu, title, options, value, highlight, onChoose, onClose }: {
  menu: MenuLayout;
  title: string;
  options: readonly SelectOption<T>[];
  value: T;
  highlight: number | null;
  onChoose: (value: T) => void;
  onClose: () => void;
}) {
  const material = useGlassMaterial();
  const rootRef = useRef<View>(null);
  // The layout is in window coordinates; the modal's root is normally at the window origin, but measure it.
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View ref={rootRef} collapsable={false} className="flex-1" onLayout={() => rootRef.current?.measureInWindow((x, y) => setOrigin((current) => current.x === x && current.y === y ? current : { x, y }))}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} style={StyleSheet.absoluteFill} onPress={onClose} />
      <PopoverSurface
        accessibilityRole="menu"
        accessibilityLabel={title}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        // It springs out of the value it replaces: the trailing corner nearest the row.
        origin={["100%", menu.above ? "100%" : 0, 0]}
        className={`absolute overflow-hidden rounded-md ${material === "liquid" ? "" : "shadow-float"}`}
        style={{ left: menu.left - origin.x, top: menu.top - origin.y, width: menu.width, paddingVertical: MENU_PADDING, borderCurve: "continuous" }}
      >
        <GlassBackground radius={RADIUS.md} />
        {options.map((option, index) => {
          const selected = option.value === value;
          return <Pressable
            key={option.value}
            accessibilityRole="menuitem"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChoose(option.value)}
            className={`flex-row items-center gap-3 px-4 active:bg-surface-pressed ${highlight === index ? "bg-surface-pressed" : ""}`}
            style={{ height: ROW_HEIGHT }}
          >
            <Text numberOfLines={1} className={`min-w-0 flex-1 text-body text-fg ${selected ? "font-semibold" : ""}`}>{option.label}</Text>
            {selected ? <AppIcon name="check" size={18} tone="fg" strokeWidth={2.2} /> : null}
          </Pressable>;
        })}
      </PopoverSurface>
    </View>
  </Modal>;
}
