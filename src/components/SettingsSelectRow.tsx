import { haptics } from "@/src/platform/haptics";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { AnchoredActionMenu, type AnchoredMenuDrive } from "@/src/components/AnchoredActionMenu";
import { SettingsRow } from "@/src/components/SettingsRow";
import { traceAction } from "@/src/data/interaction-trace";
import type { IconName } from "@/src/icons";
import { AppIcon } from "@/src/ui";
import { MenuAnchor, MenuPresence } from "@/src/ui/MorphMenuSurface";
import { MenuPortal } from "@/src/ui/menu-layer";

export type SelectOption<T extends string> = { value: T; label: string };

/** A touch held this long without moving opens the menu under the finger; a quicker one is a tap or a scroll. */
const PRESS_DELAY_MS = 120;
const TOUCH_SLOP = 8;

type PressState =
  | { phase: "idle" | "held" | "sliding"; x: number; y: number }
  | { phase: "pending"; timer: ReturnType<typeof setTimeout>; x: number; y: number };

/**
 * A settings row whose value is chosen in place from a pop-up menu, as an iOS pop-up button does:
 * the current value sits at the trailing edge with up-down chevrons, and the menu springs out of it
 * with a check on the current choice. A tap opens the menu; a press held on the row opens it under
 * the finger, and sliding onto a choice and letting go picks it, with a selection tick per row.
 * The menu is the screen's own action menu (`AnchoredActionMenu`, drawn in the screen's menu layer).
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
  const anchorRef = useRef<View>(null);
  const [drive, setDrive] = useState<AnchoredMenuDrive | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Touch callbacks read the latest press through a shared value: a press outlives the render that began it.
  const press = useSharedValue<PressState>({ phase: "idle", x: 0, y: 0 });
  const current = options.find((option) => option.value === value);

  useEffect(() => () => { const state = press.get(); if (state.phase === "pending") clearTimeout(state.timer); }, [press]);

  const open = () => {
    if (disabled) return;
    traceAction("select_open", { title });
    setMenuOpen(true);
    onOpenChange?.(true);
  };
  const close = () => {
    setMenuOpen(false);
    onOpenChange?.(false);
  };
  const choose = (next: T) => {
    traceAction("select_choose", { title, value: next });
    if (next !== value) {
      haptics.selection();
      onChange(next);
    }
  };

  // Touch runs on the JS thread; the open menu's rows take a slide through `drive`.
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
      drive?.move(touch.absoluteX, touch.absoluteY);
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
      if (state.phase === "sliding" && touch) drive?.release(touch.absoluteX, touch.absoluteY);
      press.set({ phase: "idle", x: state.x, y: state.y });
      manager.end();
    })
    // Already finishing: failing it here re-enters the state change (see FloatingTabBar).
    .onTouchesCancelled(() => {
      const state = press.get();
      if (state.phase === "pending") clearTimeout(state.timer);
      press.set({ phase: "idle", x: state.x, y: state.y });
    });

  return <>
    <GestureDetector gesture={gesture}>
      <View
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
          <MenuAnchor ref={anchorRef} open={menuOpen} className="shrink flex-row items-center gap-1" style={{ maxWidth: "50%" }}>
            <Text numberOfLines={1} className="shrink text-body text-fg-muted">{current?.label}</Text>
            <AppIcon name="chevrons-up-down" size={16} tone="muted" />
          </MenuAnchor>
        </SettingsRow>
      </View>
    </GestureDetector>
    <MenuPortal>
      <MenuPresence open={menuOpen}>
        <AnchoredActionMenu
          anchorRef={anchorRef}
          title={title}
          trigger="plain"
          onDrive={setDrive}
          testID={testID ? `${testID}-menu` : "settings-select-menu"}
          onClose={close}
          actions={options.map((option) => ({ title: option.label, checked: option.value === value, onPress: () => choose(option.value) }))}
        />
      </MenuPresence>
    </MenuPortal>
  </>;
}
