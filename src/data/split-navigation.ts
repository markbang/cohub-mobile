import { removeInternalExpoRouterParams } from "expo-router/build/navigationParams";
import { RouterActionHandling, type NavigationAction, type NavigationState, type RouterActionResult } from "expo-router/build/react-navigation/routers/index";

/**
 * The root navigator draws one navigation state two ways. A compact window keeps the phone's single
 * stack; a wide one puts the tab app (`routes[0]`) in a left pane and the routes above it in a right
 * pane, as Mail and Telegram do on iPad. Layout follows the window's size, never the device kind.
 */
export type SplitMode = "compact" | "split";

const SPLIT_MIN_WIDTH = 700;
const SPLIT_MIN_HEIGHT = 500;
const LEFT_PANE_MIN = 320;
const LEFT_PANE_MAX = 420;

/** Routes drawn over both panes rather than inside the right one. */
const SPLIT_OVERLAY_ROUTES: ReadonlySet<string> = new Set(["new-chat", "image-viewer", "media-viewer"]);

export function splitMode(width: number, height: number): SplitMode {
  return width >= SPLIT_MIN_WIDTH && height >= SPLIT_MIN_HEIGHT ? "split" : "compact";
}

export function leftPaneWidth(windowWidth: number): number {
  return Math.round(Math.min(LEFT_PANE_MAX, Math.max(LEFT_PANE_MIN, windowWidth / 3)));
}

type RouteLike = { name: string; key: string; params?: object };

/**
 * Splits the root routes into the tab app on the left, the right pane's stack, and the overlays
 * above both panes. Expo Router pushes a second tab app for a link to a tab (`cohub://settings`);
 * the topmost one is drawn, and the routes under it wait in history as they do on a phone.
 * Everything from the first overlay up stays in the full-window stack, so route order never changes.
 */
export function splitRoutes<T extends RouteLike>(routes: readonly T[]): { root: T; pane: T[]; overlays: T[] } {
  const rootIndex = routes.findLastIndex((route) => route.name === routes[0].name);
  const above = routes.slice(rootIndex + 1);
  const end = above.findIndex((route) => SPLIT_OVERLAY_ROUTES.has(route.name));
  const paneEnd = end === -1 ? above.length : end;
  return { root: routes[rootIndex], pane: above.slice(0, paneEnd), overlays: above.slice(paneEnd) };
}

type NestedState = { index?: number; routes: readonly (Partial<RouteLike> & { state?: NestedState })[] } | undefined;

/** Keys of the focused route at every level of the tab app, the only left-pane screens on view. */
export function focusedRouteKeys(state: NestedState): string[] {
  const keys: string[] = [];
  let current = state;
  while (current && current.routes.length > 0) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    if (route.key) keys.push(route.key);
    current = route.state;
  }
  return keys;
}

export function chatSessionId(route: RouteLike): string | undefined {
  if (route.name !== "chat/[sessionId]") return undefined;
  const id = (route.params as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof id === "string" ? id : undefined;
}

/** The Chat the right pane shows, which the left list marks as selected. */
export function selectedChatId(pane: readonly RouteLike[]): string | null {
  const id = pane.map(chatSessionId).findLast((value) => value !== undefined);
  return id && id !== "new" ? id : null;
}

/**
 * Opening a Chat from the left list selects it: a Chat already on top of the right pane is replaced
 * rather than stacked, and nothing slides. A compact window keeps the phone's animated push.
 */
export function chatOpenAction(mode: SplitMode, topRouteName: string | undefined): { kind: "push" | "replace"; animated: boolean } {
  if (mode === "compact") return { kind: "push", animated: true };
  return { kind: topRouteName === "chat/[sessionId]" ? "replace" : "push", animated: false };
}

/** The right pane's first screen has nothing to go back to inside the pane; `null` is outside it. */
export function showsPaneBack(paneIndex: number | null): boolean {
  return paneIndex !== 0;
}

/**
 * Drops a PUSH or NAVIGATE that repeats the route already on top, so a burst of taps on one row
 * opens its screen once. Only the top is compared: unlike `singular`, an equal route deeper in the
 * stack stays where it is. Expo Router's internal params are ignored; any user param that differs
 * (a Chat opened at a turn) pushes as usual.
 */
export function dropRepeatedTopPush<State extends NavigationState>(state: State, action: NavigationAction): RouterActionResult<State> | RouterActionHandling.Delegate {
  if (action.type !== "PUSH" && action.type !== "NAVIGATE") return RouterActionHandling.Delegate;
  if (action.target !== undefined && action.target !== state.key) return RouterActionHandling.Delegate;
  const payload = action.payload as { name?: unknown; params?: object; state?: unknown; __internal__PreviewKey?: unknown } | undefined;
  const top = state.routes[state.index];
  // A nested destination (a link into a tab) carries its own state, and a committed link preview
  // owns a preloaded route; neither is a repeat of the top.
  if (!top || payload?.name !== top.name || payload.state !== undefined || payload.__internal__PreviewKey !== undefined) return RouterActionHandling.Delegate;
  return sameParams(removeInternalExpoRouterParams(top.params), removeInternalExpoRouterParams(payload.params)) ? { state, affectedRouteKey: top.key } : RouterActionHandling.Delegate;
}

function sameParams(a: object | undefined, b: object | undefined): boolean {
  const left = Object.entries(a ?? {});
  const right = new Map(Object.entries(b ?? {}));
  return left.length === right.size && left.every(([key, value]) => right.has(key) && right.get(key) === value);
}
