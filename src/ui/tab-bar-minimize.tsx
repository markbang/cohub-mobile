import { useIsFocused } from "expo-router";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";

/**
 * The drawn tab bar's minimized state (0 or 1), set by the focused tab root's scroll as UIKit's
 * `minimizeBehavior: onScrollDown` does. iOS has no provider: its system tab bar minimizes itself.
 */
const TabBarMinimize = createContext<SharedValue<number> | null>(null);

export function TabBarMinimizeProvider({ children }: { children: ReactNode }) {
  const minimized = useSharedValue(0);
  return <TabBarMinimize.Provider value={minimized}>{children}</TabBarMinimize.Provider>;
}

export function useTabBarMinimized() {
  return useContext(TabBarMinimize);
}

// Scrolling this far in one direction minimizes or restores the bar, so a finger's jitter does neither.
const TRAVEL = 8;

/** Minimizes the tab bar while the content scrolls down and restores it on the way back up or at the top. */
export function useMinimizeTabBarOnScroll(scrollY: SharedValue<number> | undefined) {
  const minimized = useContext(TabBarMinimize);
  const focused = useIsFocused();
  const active = useSharedValue(focused);
  // Where the scroll last turned, so the travel counts from there.
  const turn = useSharedValue(0);
  useEffect(() => { active.set(focused); }, [active, focused]);
  useAnimatedReaction(() => (scrollY ? scrollY.get() : 0), (y) => {
    if (!minimized || !active.get()) { turn.set(y); return; }
    if (y <= 0) {
      if (minimized.get() !== 0) minimized.set(0);
      turn.set(y);
      return;
    }
    const down = minimized.get() === 0;
    const travel = y - turn.get();
    if (down ? travel > TRAVEL : travel < -TRAVEL) {
      minimized.set(down ? 1 : 0);
      turn.set(y);
    } else if (down ? travel < 0 : travel > 0) {
      turn.set(y);
    }
  });
}
