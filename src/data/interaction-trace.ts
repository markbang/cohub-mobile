import { usePathname, useSegments } from "expo-router";
import * as Device from "expo-device";
import { useEffect } from "react";
import {
  AppState,
  Appearance,
  Dimensions,
  Keyboard,
  PixelRatio,
  type GestureResponderEvent,
  type ViewProps,
} from "react-native";
import { debugAlias, redactText, record, setDebugContext } from "@/src/data/debug-session";

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,}|\d{6,})$/i;
const SAFE_QUERY = new Set(["limit", "direction", "source", "days", "before", "after", "page", "sort", "status", "order", "offset", "timezone", "locale", "panel", "cursor", "turn", "turnId"]);
const ALIAS_QUERY = new Set(["cursor", "turn", "turnId", "before", "after"]);
const NETWORK_LOGGING_EXCLUDED = /\/api\/v1\/feedback(?:\?|$)/;

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Server and navigation URLs keep their shape; every ID-like segment becomes a per-launch alias. */
export function diagnosticPath(raw: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `https://app.local${raw.startsWith("/") ? "" : "/"}${raw}`;
    const url = new URL(absolute);
    const path = url.pathname
      .split("/")
      .map((segment) => (ID_SEGMENT.test(decode(segment)) ? debugAlias("id", decode(segment)) : segment))
      .join("/");
    const query = [...url.searchParams]
      .filter(([key]) => SAFE_QUERY.has(key))
      .map(([key, value]) => `${key}=${ALIAS_QUERY.has(key) || !/^[0-9a-z_.-]{1,40}$/i.test(value) ? debugAlias("id", value) : value}`)
      .join("&");
    return `${url.origin === "https://app.local" ? "" : url.origin}${path}${query ? `?${query}` : ""}`;
  } catch {
    return redactText(raw, 200);
  }
}

function queryKeys(raw: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://app.local${raw.startsWith("/") ? "" : "/"}${raw}`);
    const keys = [...url.searchParams.keys()];
    return keys.length > 0 ? keys.slice(0, 20).join(",") : null;
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  return typeof Request !== "undefined" && input instanceof Request ? input.method : "GET";
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return (input as { url?: string; href?: string }).url ?? (input as { href?: string }).href ?? String(input);
}

function headerSummary(headers: Headers | null) {
  if (!headers) return {};
  const contentLength = headers.get("content-length");
  return {
    contentType: headers.get("content-type")?.split(";")[0] ?? null,
    accept: headers.get("accept"),
    requestId: headers.get("x-request-id"),
    traceId: headers.get("x-trace-id"),
    source: headers.get("x-cohub-source-via"),
    bytes: contentLength && Number.isFinite(Number(contentLength)) ? Number(contentLength) : null,
  };
}

function bodySummary(body: BodyInit | null | undefined) {
  if (body === null || body === undefined) return {};
  if (typeof body === "string") {
    let keys: string[] | null = null;
    try {
      const parsed: unknown = JSON.parse(body);
      if (Array.isArray(parsed)) keys = [`items:${parsed.length}`];
      else if (parsed && typeof parsed === "object") keys = Object.keys(parsed).slice(0, 30);
    } catch {
      // Not JSON: the byte count is enough.
    }
    return { requestKind: keys ? "json" : "text", requestBytes: body.length, requestKeys: keys };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // React Native keeps multipart parts on `_parts`; names are useful, values are not logged.
    const parts = (body as unknown as { _parts?: unknown[] })._parts;
    const names = Array.isArray(parts) ? parts.map((part) => Array.isArray(part) ? String(part[0]) : "?").slice(0, 20) : null;
    return { requestKind: "form-data", requestParts: Array.isArray(parts) ? parts.length : null, requestKeys: names };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return { requestKind: "blob", requestBytes: body.size, contentType: body.type || null };
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return { requestKind: "form", requestKeys: [...body.keys()].slice(0, 20) };
  return { requestKind: "binary" };
}

async function describeErrorResponse(response: Response) {
  const type = response.headers.get("content-type") ?? "";
  const length = Number(response.headers.get("content-length") ?? "0");
  if (!response.body || (!type.includes("json") && !type.startsWith("text/") && (!length || length > 16_384))) return {};
  try {
    const text = (await response.clone().text()).slice(0, 8_192);
    const parsed = JSON.parse(text) as { error?: { code?: unknown; type?: unknown; message?: unknown }; traceId?: unknown; requestId?: unknown };
    const error = parsed.error;
    return {
      errorCode: typeof error?.code === "string" ? error.code : null,
      errorType: typeof error?.type === "string" ? error.type : null,
      errorMessage: typeof error?.message === "string" ? redactText(error.message, 200) : null,
      traceId: typeof parsed.traceId === "string" ? parsed.traceId : null,
      requestId: typeof parsed.requestId === "string" ? parsed.requestId : null,
    };
  } catch {
    return {};
  }
}

let requestSequence = 0;

function installNetworkLogging() {
  if (typeof globalThis.fetch !== "function") return;
  const already = (globalThis as { __cohubFetchTraced?: boolean }).__cohubFetchTraced;
  if (already) return;
  (globalThis as { __cohubFetchTraced?: boolean }).__cohubFetchTraced = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (NETWORK_LOGGING_EXCLUDED.test(url)) return original(input, init);
    const id = ++requestSequence;
    const started = performance.now();
    const headers = requestHeaders(input, init);
    record("net.request", {
      id,
      method: requestMethod(input, init),
      endpoint: diagnosticPath(url),
      queryKeys: queryKeys(url),
      ...headerSummary(headers),
      ...bodySummary(init?.body),
    });
    try {
      const response = await original(input, init);
      const summary = {
        id,
        status: response.status,
        ok: response.ok,
        redirected: response.redirected,
        durationMs: Math.round(performance.now() - started),
        contentType: response.headers.get("content-type")?.split(";")[0] ?? null,
        bytes: Number(response.headers.get("content-length") ?? 0) || null,
        requestId: response.headers.get("x-request-id"),
        traceId: response.headers.get("x-trace-id"),
      };
      record("net.response", summary);
      if (!response.ok) record("net.response.error", { id, status: response.status, ...(await describeErrorResponse(response)) });
      return response;
    } catch (error) {
      record("net.error", {
        id,
        durationMs: Math.round(performance.now() - started),
        name: error instanceof Error ? error.name : null,
        message: error instanceof Error ? redactText(error.message, 240) : String(error),
        aborted: error instanceof Error && error.name === "AbortError",
      });
      throw error;
    }
  };
}

function errorFields(error: unknown) {
  if (!(error instanceof Error)) return { message: redactText(String(error), 300) };
  return {
    name: error.name,
    message: redactText(error.message, 300),
    stack: error.stack ? redactText(error.stack, 1_200) : null,
    cause: "cause" in error && error.cause ? redactText(String(error.cause), 300) : null,
  };
}

function installErrorLogging() {
  const target = globalThis as {
    ErrorUtils?: { getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void; setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void };
    addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
    __cohubErrorTraced?: boolean;
  };
  if (target.__cohubErrorTraced) return;
  target.__cohubErrorTraced = true;
  const utils = target.ErrorUtils;
  if (utils?.setGlobalHandler) {
    const previous = utils.getGlobalHandler?.();
    utils.setGlobalHandler((error, isFatal) => {
      record("error.uncaught", { fatal: Boolean(isFatal), ...errorFields(error) });
      previous?.(error, isFatal);
    });
  }
  target.addEventListener?.("unhandledrejection", (event) => record("error.unhandled_rejection", errorFields(event.reason)));
}

let consoleTraced = false;

function installConsoleLogging() {
  const target = globalThis as { __cohubConsoleTraced?: boolean };
  if (target.__cohubConsoleTraced) return;
  target.__cohubConsoleTraced = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (consoleTraced) {
        original(...args);
        return;
      }
      consoleTraced = true;
      try {
        const strings = args.filter((arg): arg is string => typeof arg === "string");
        const error = args.find((arg): arg is Error => arg instanceof Error);
        record(`console.${level}`, {
          source: redactText(strings[0] ?? "", 160),
          values: strings.slice(1).map((value) => redactText(value, 240)),
          arguments: args.length,
          ...(error ? errorFields(error) : {}),
        });
      } finally {
        consoleTraced = false;
        original(...args);
      }
    };
  }
}

const openDialogs = new Set<string>();

/** Dialogs and sheets report here so taps can name what was on screen. */
export function setDialogOpen(label: string, open: boolean) {
  const previous = openDialogs.has(label);
  if (open) openDialogs.add(label);
  else openDialogs.delete(label);
  if (previous === open) return;
  record("ui.dialog", { name: label, open });
}

let currentRoute = "/";
let screenSequence = 0;
let currentScreen = "s1";

/** Called once from the app root, so global handlers share one timeline across Fast Refresh. */
export function installInteractionInstrumentation() {
  const target = globalThis as { __cohubInteractionsInstalled?: boolean };
  if (target.__cohubInteractionsInstalled) return;
  target.__cohubInteractionsInstalled = true;
  installNetworkLogging();
  installErrorLogging();
  installConsoleLogging();
  Dimensions.addEventListener("change", ({ window, screen }) =>
    record("ui.dimensions", { w: Math.round(window.width), h: Math.round(window.height), scale: window.scale, screenW: Math.round(screen.width), screenH: Math.round(screen.height) }));
  // A memory-starved app that dies without a JS error explains several symptom classes.
  record("app.memory", {
    totalMemoryMb: Device.totalMemory ? Math.round(Device.totalMemory / 1024 / 1024) : null,
    supportedAbis: Device.supportedCpuArchitectures?.length ?? null,
  });
  Keyboard.addListener("keyboardDidShow", (event) =>
    record("ui.keyboard", { shown: true, height: Math.round(event.endCoordinates.height), screenY: Math.round(event.endCoordinates.screenY) }));
  Keyboard.addListener("keyboardDidHide", () => record("ui.keyboard", { shown: false }));
  AppState.addEventListener("change", (state) => record("ui.app_state", { state }));
  Appearance.addChangeListener(({ colorScheme }) => record("ui.color_scheme", { colorScheme }));
}

function canonicalRoute(segments: readonly string[], pathname: string) {
  const named = segments
    .filter((segment) => !segment.startsWith("("))
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment));
  return named.length > 0
    ? named.join("/")
    : pathname.split("/").filter(Boolean).map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment)).join("/") || "/";
}

/** Route changes are the backbone: every event carries the route as `surface`. */
export function useRouteTracking() {
  const segments = useSegments();
  const pathname = usePathname();
  useEffect(() => {
    const route = canonicalRoute(segments as readonly string[], pathname);
    if (route === currentRoute && screenSequence > 0) return;
    currentRoute = route;
    currentScreen = `s${++screenSequence}`;
    setDebugContext("surface", route);
    record("ui.screen", {
      screen: currentScreen,
      route,
      path: diagnosticPath(pathname),
      focus: true,
    });
  }, [pathname, segments]);
}

/** Actions reported by components where the accessibility label is not a stable diagnostic name. */
export function traceAction(action: string, fields: Record<string, unknown> = {}) {
  record("ui.action", { action, screen: currentScreen, ...fields });
}

type TouchState = {
  startedAt: number;
  x: number;
  y: number;
  target: number | null;
  maxTouches: number;
  moves: number;
  lastMoveLog: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  force: number | null;
};

let touchState: TouchState | null = null;

function position(event: GestureResponderEvent) {
  const native = event.nativeEvent;
  return { x: Math.round(native.pageX), y: Math.round(native.pageY) };
}

function touchTarget(event: GestureResponderEvent) {
  return typeof event.nativeEvent.target === "number" ? event.nativeEvent.target : null;
}

function onTouchStart(event: GestureResponderEvent) {
  const { x, y } = position(event);
  const native = event.nativeEvent;
  if (touchState) {
    // A second finger must not restart the gesture; only the max touch count changes.
    touchState.maxTouches = Math.max(touchState.maxTouches, native.touches.length);
    return;
  }
  touchState = {
    startedAt: performance.now(),
    x,
    y,
    target: touchTarget(event),
    maxTouches: native.touches.length,
    moves: 0,
    lastMoveLog: 0,
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    force: typeof native.force === "number" ? Math.round(native.force * 100) / 100 : null,
  };
  record("ui.touch.start", { screen: currentScreen, x, y, dpr: PixelRatio.get(), target: touchState.target, touches: native.touches.length, force: touchState.force });
}

function onTouchMove(event: GestureResponderEvent) {
  if (!touchState) return;
  const { x, y } = position(event);
  const now = performance.now();
  touchState.moves += 1;
  touchState.minX = Math.min(touchState.minX, x);
  touchState.minY = Math.min(touchState.minY, y);
  touchState.maxX = Math.max(touchState.maxX, x);
  touchState.maxY = Math.max(touchState.maxY, y);
  if (now - touchState.lastMoveLog < 120 || touchState.moves > 120) return;
  touchState.lastMoveLog = now;
  record("ui.touch.move", {
    screen: currentScreen,
    x,
    y,
    dx: x - touchState.x,
    dy: y - touchState.y,
    dt: Math.round(now - touchState.startedAt),
    moves: touchState.moves,
    touches: event.nativeEvent.touches.length,
  });
}

function finishTouch(event: GestureResponderEvent, cancelled: boolean) {
  if (!touchState) return;
  const state = touchState;
  touchState = null;
  const { x, y } = position(event);
  const duration = Math.round(performance.now() - state.startedAt);
  const dx = x - state.x;
  const dy = y - state.y;
  const distance = Math.round(Math.hypot(dx, dy));
  const velocity = duration > 0 ? Math.round((distance / duration) * 1000) : 0;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const direction = distance < 12 ? null : horizontal ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
  const multi = state.maxTouches > 1;
  const kind = cancelled
    ? "cancel"
    : multi
      ? "multi_touch"
      : duration >= 500 && distance < 12
        ? "long_press"
        : distance < 12 && duration < 350
          ? "tap"
          : distance >= 24
            ? `swipe_${direction}`
            : "drag";
  record("ui.touch.end", {
    screen: currentScreen,
    kind,
    dpr: PixelRatio.get(),
    dialogs: openDialogs.size > 0 ? [...openDialogs].slice(0, 4) : null,
    x,
    y,
    startX: state.x,
    startY: state.y,
    dx,
    dy,
    distance,
    durationMs: duration,
    velocity,
    direction,
    moves: state.moves,
    target: state.target,
    force: state.force,
    bounds: { left: state.minX, top: state.minY, right: state.maxX, bottom: state.maxY },
  });
  if (kind === "tap" || kind === "long_press") {
    record("ui.tap", { screen: currentScreen, x, y, target: state.target, longPress: kind === "long_press", dialogs: openDialogs.size > 0 ? [...openDialogs].slice(0, 4) : null });
  }
}

export const globalTouchHandlers: ViewProps = {
  onTouchStart,
  onTouchMove,
  // A root `onTouchEnd` also fires for touches a nested view claimed, so gestures that end
  // anywhere (including inside the list or a swipeable row) still get their summary.
  onTouchEnd: (event) => { if (touchState) finishTouch(event, false); },
  onTouchCancel: (event) => { if (touchState) finishTouch(event, true); },
};
