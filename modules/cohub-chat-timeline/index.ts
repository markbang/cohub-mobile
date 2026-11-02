import { requireNativeView, requireOptionalNativeModule, type NativeModule } from "expo";
import type { ComponentType, Ref } from "react";
import type { ViewProps } from "react-native";

/**
 * A row is a tree of these nodes. Layout uses React Native's flexbox names and units (points);
 * colors are `processColor` numbers. Native renders and lays them out; JS owns every value.
 */
export type TimelineStyle = Record<string, number | string | undefined>;

export type TimelineAnimation = {
  property: "opacity" | "translateX" | "translateY" | "scale" | "rotate";
  keyframes: { at: number; value: number }[];
  duration: number;
  delay?: number;
  /** 0 repeats forever. */
  iterations?: number;
  /** Cubic bezier control points; linear when omitted. */
  easing?: readonly [number, number, number, number];
};

type NodeBase = {
  /** Keeps a view (and its state) across updates when siblings change; also names flight targets. */
  id?: string;
  style?: TimelineStyle;
  action?: string;
  longAction?: string;
  payload?: Record<string, unknown>;
  disabled?: boolean;
  pressedOpacity?: number;
  pressedBackgroundColor?: number;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "progressbar" | "header";
  accessibilityState?: { disabled?: boolean; busy?: boolean; expanded?: boolean };
  accessibilityHidden?: boolean;
  animations?: TimelineAnimation[];
};

export type TimelineTextStyle = {
  color?: number;
  fontSize: number;
  lineHeight?: number;
  fontWeight?: string;
  fontFamily?: string;
  fontVariant?: string[];
  textAlign?: "left" | "center" | "right";
  letterSpacing?: number;
};

export type TimelineNode =
  | (NodeBase & { type: "view"; children?: TimelineNode[] })
  | (NodeBase & { type: "text"; text: TimelineTextStyle; value?: string; runs?: { text: string; color?: number; fontWeight?: string }[]; numberOfLines?: number; selectable?: boolean })
  | (NodeBase & { type: "markdown"; markdown: string; markdownStyle: object; md4cFlags: Record<string, boolean>; streaming?: boolean; selectable?: boolean; gfm?: boolean; blockContextMenu?: boolean; /** iOS: extra props for the renderer, over its defaults. */ hostProps?: Record<string, unknown> })
  /** iOS draws `symbol` (an SF Symbol) when it exists and the paths otherwise. */
  | (NodeBase & { type: "vector"; viewBox: readonly [number, number, number, number]; paths: { d: string; fill?: number | null; stroke?: number | null; strokeWidth?: number; strokeLinecap?: "round" | "butt"; strokeLinejoin?: "round" | "miter" }[]; stroke?: number; fill?: number; strokeWidth?: number; absoluteStrokeWidth?: boolean; symbol?: string; weight?: "regular" | "semibold" })
  | (NodeBase & { type: "image"; uri: string; fallbackUri?: string })
  | (NodeBase & { type: "scroll"; horizontal?: boolean; contentStyle?: TimelineStyle; children?: TimelineNode[] });

export type TimelineFlight = { nodeId: string; x: number; y: number; width: number; height: number; duration: number; easing?: readonly [number, number, number, number] };

export type TimelineRowSpec = {
  /** Rows of one type recycle into each other. */
  type: string;
  node: TimelineNode;
  /** Runs once when the row first appears. */
  appear?: TimelineAnimation[];
  hidden?: boolean;
  /** False for rows the reading position should not hold on (load-more capsules). */
  anchor?: false;
  /** Flies `nodeId` from this frame (timeline coordinates) onto its own the first time the row lays out. */
  flight?: TimelineFlight;
};

export type TimelineScrollEvent = { offsetY: number; contentHeight: number; viewportHeight: number; distanceToLatest: number | null; distanceToOldest: number | null; dragging: boolean; momentum: boolean; following: boolean };
export type TimelineState = { following: boolean; dragging: boolean; momentum: boolean; distanceToLatest: number | null; distanceToOldest: number | null; visibleKeys: string[]; keyboardLift: number };

type Event<T> = { nativeEvent: T };

export type ChatTimelineViewProps = ViewProps & {
  contentInset: { top: number; bottom: number };
  viewportInset: { top: number; bottom: number };
  /** `follow`: scrolling toward newer within this resumes following. `leave`: scrolling toward older past this stops it. */
  thresholds: { follow: number; leave: number; page: number; visibleFraction: number; scrollEventThrottle: number };
  detached: boolean;
  keyboard: { enabled: boolean; coveredInset: number };
  initialTarget?: { key: string; viewPosition: number; viewOffset: number } | null;
  /** iOS: the system pull to refresh. Android pulls in JS around the view. */
  refreshEnabled?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onTimelineScroll?: (event: Event<TimelineScrollEvent>) => void;
  onScrollPhase?: (event: Event<{ phase: "dragBegin" | "dragEnd" | "momentumBegin" | "momentumEnd"; momentum?: boolean }>) => void;
  onFollowingChange?: (event: Event<{ following: boolean }>) => void;
  onVisibleRows?: (event: Event<{ keys: string[] }>) => void;
  onNearEdge?: (event: Event<{ edge: "older" | "newer"; distance: number }>) => void;
  onRowAction?: (event: Event<{ key: string | null; action: string; nodeId: string | null; payload: Record<string, unknown> | null }>) => void;
  onTimelineLoad?: (event: Event<{ following: boolean }>) => void;
  onFlightEnd?: (event: Event<{ key: string; finished: boolean }>) => void;
  onKeyboardLift?: (event: Event<{ lift: number }>) => void;
};

export type ChatTimelineViewRef = {
  setRows(keys: string[], rows: Record<string, TimelineRowSpec>): Promise<void>;
  scrollToEnd(animated: boolean): Promise<void>;
  scrollToKey(key: string, options: { animated: boolean; viewPosition: number; viewOffset: number }): Promise<boolean>;
  scrollBy(delta: number, animated: boolean): Promise<void>;
  setFollowing(following: boolean): Promise<void>;
  getState(): Promise<TimelineState>;
  measureNode(key: string, nodeId: string | null): Promise<{ x: number; y: number; width: number; height: number } | null>;
};

/** Null where the binary predates the module. */
export const ChatTimelineView: ComponentType<ChatTimelineViewProps & { ref?: Ref<ChatTimelineViewRef> }> | null =
  requireOptionalNativeModule<NativeModule>("CohubChatTimeline") ? requireNativeView("CohubChatTimeline") : null;
