import { useIsFocused, useRoute, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, type EffectCallback } from "react";
import { useWindowDimensions } from "react-native";
import { chatOpenAction, showsPaneBack, type SplitMode } from "@/src/data/split-navigation";

/** The root layout's shape, set by `SplitStack`. */
export type SplitLayout = { mode: SplitMode; selectedChatId: string | null; paneTopName: string | undefined };

/**
 * The pane a screen draws in: its width, and in the left pane the route keys on view (the selected
 * tab and the screen on top of its stack), which count as visible while the right pane holds focus.
 */
export type Pane = { side: "left" | "right"; width: number; visibleKeys: ReadonlySet<string> | null };

const COMPACT: SplitLayout = { mode: "compact", selectedChatId: null, paneTopName: undefined };

export const SplitLayoutContext = createContext<SplitLayout>(COMPACT);
export const PaneContext = createContext<Pane | null>(null);
/** The screen's position in the right pane's stack; null outside it. */
export const PaneRouteIndexContext = createContext<number | null>(null);

export function useSplitLayout(): SplitLayout {
  return useContext(SplitLayoutContext);
}

/** The width the screen lays out in: its pane in a split window, otherwise the window. */
export function usePaneWidth(): number {
  const pane = useContext(PaneContext);
  const { width } = useWindowDimensions();
  return pane?.width ?? width;
}

/** Whether the screen's bar draws a back button: the right pane's first screen has nowhere to go back to. */
export function usePaneBack(): boolean {
  const { mode } = useSplitLayout();
  return showsPaneBack(mode, useContext(PaneRouteIndexContext));
}

/**
 * Navigation focus, widened to the left pane's screens on view. Navigation focus stays with the top
 * route (the right pane's Chat), so these keep polling and subscribing as on a phone's tab root.
 * Hidden tabs and the right pane keep plain focus.
 */
export function useScreenVisible(): boolean {
  const focused = useIsFocused();
  const pane = useContext(PaneContext);
  const route = useRoute();
  return focused || (pane?.visibleKeys?.has(route.key) ?? false);
}

/** `useFocusEffect` keyed on `useScreenVisible`: runs while the screen is visible, cleans up when it is not. */
export function useScreenVisibleEffect(effect: EffectCallback): void {
  const visible = useScreenVisible();
  useEffect(() => (visible ? effect() : undefined), [effect, visible]);
}

let unanimatedChat: string | null = null;

/** The next Chat the right pane shows with this id appears without a transition. */
export function requestUnanimatedChat(sessionId: string): void {
  unanimatedChat = sessionId;
}

export function isUnanimatedChat(sessionId: string | undefined): boolean {
  return sessionId !== undefined && sessionId === unanimatedChat;
}

export function clearUnanimatedChat(): void {
  unanimatedChat = null;
}

type ChatTarget = { sessionId: string; turn?: string; turnId?: string; spaceId?: string; shared?: string };

/**
 * Opens a Chat from a list in the left pane. In a split window it selects the Chat: one already on
 * top of the right pane is replaced, and nothing slides. A compact window pushes as on a phone.
 */
export function useOpenChat(): (target: ChatTarget) => void {
  const router = useRouter();
  const { mode, paneTopName } = useSplitLayout();
  return useCallback((target: ChatTarget) => {
    const action = chatOpenAction(mode, paneTopName);
    if (!action.animated) unanimatedChat = target.sessionId;
    const params = Object.fromEntries(Object.entries(target).filter((entry) => entry[1] !== undefined)) as ChatTarget;
    const href = { pathname: "/chat/[sessionId]" as const, params };
    if (action.kind === "replace") router.replace(href);
    else router.push(href);
  }, [mode, paneTopName, router]);
}
