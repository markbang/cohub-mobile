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
 * Splits the root routes into the right pane's stack and the overlays above both panes. Everything
 * from the first overlay up stays in the full-window stack, so route order never changes.
 */
export function splitRoutes<T extends RouteLike>(routes: readonly T[]): { pane: T[]; overlays: T[] } {
  const end = routes.findIndex((route, index) => index > 0 && SPLIT_OVERLAY_ROUTES.has(route.name));
  const paneEnd = end === -1 ? routes.length : end;
  return { pane: routes.slice(1, paneEnd), overlays: routes.slice(paneEnd) };
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
