import { useRouter } from "expo-router";
import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ColorValue,
  type GestureResponderEvent,
  type KeyboardEvent,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Path, Rect } from "react-native-svg";
import { ClaudeCode, CodeBuddy, Codex, Pi } from "@lobehub/icons-rn";
import { harnessLabel as labelForHarness, type HarnessKind, type LocalHarness } from "@neta-art/cohub";
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { icons, type IconName } from "@/src/icons";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { getComposerActionState } from "@/src/data/composer-state";
import { COMPOSER_TEXT_PADDING, estimateComposerContentHeight, getComposerLayout, shouldAutoExpandComposer } from "@/src/ui/composer-layout";
import { isUsableKeyboardFrame, keyboardOverlap } from "@/src/ui/keyboard-frame";
import { useTranslation } from "@/src/i18n";
import { edgeChrome, useAppTheme, typography } from "@/src/theme";
import { LIST_AVATAR_SIZE, type ColorKey } from "@/src/design/tokens";
import { motion, springs } from "@/src/motion";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";
import { AppRefreshControl } from "@/src/ui/AppRefreshControl";
import { Loader } from "@/src/ui/Loader";
import { NativeSegmented, nativeSegmented } from "@/src/ui/NativeSegmented";
import { NativeMenuButton, nativeMenus, type NativeMenuAction, type NativeMenuSection } from "@/src/components/NativeMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import type { AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import type { ActivityItem } from "@/src/data/types";
import { initials } from "@/src/utils";

export { ExpandableSearchBar } from "@/src/ui/ExpandableSearchBar";
export { AppRefreshControl, listRefreshProps } from "@/src/ui/AppRefreshControl";
export { ListEdgeLoader, Loader, LoadingState } from "@/src/ui/Loader";

const CONTINUOUS = { borderCurve: "continuous" } as const;
export type { IconName } from "@/src/icons";

export type IconTone = "fg" | "secondary" | "muted" | "faint" | "accent" | "onAccent" | "success" | "warning" | "danger" | "info";

const ICON_TONES: Record<IconTone, ColorKey> = {
  fg: "text", secondary: "textSecondary", muted: "textMuted", faint: "textFaint", accent: "accent", onAccent: "accentText",
  success: "success", warning: "warning", danger: "danger", info: "info",
};

/** Lucide needs a JS color, so icons take a token `tone`; `color` is for computed values only. */
export function AppIcon({ name, size = 20, color, tone = "secondary", strokeWidth = 1.9, fill, style }: { name: IconName; size?: number; color?: ColorValue; tone?: IconTone; strokeWidth?: number; fill?: string; style?: object }) {
  const theme = useAppTheme();
  const Icon = icons[name];
  return <Icon size={size} color={color ?? theme.colors[ICON_TONES[tone]]} strokeWidth={strokeWidth} absoluteStrokeWidth style={style} {...(fill ? { fill } : {})} />;
}

export function CohubLogo({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 192 192">
      {/* design-system: the Cohub logo keeps its brand colors in every theme. */}
      <Rect width={192} height={192} rx={32} fill="#ff4500" />
      {/* design-system: logo glyph */}
      <G transform="translate(0,192) scale(0.1,-0.1)" fill="#ffffff">
        <Path d="M853 1314 c-63 -23 -128 -86 -164 -160 -27 -54 -33 -79 -37 -157 -10 -196 63 -332 205 -383 53 -18 160 -17 219 3 92 31 184 151 184 240 0 21 -5 23 -45 23 -43 0 -45 -1 -55 -38 -13 -52 -48 -101 -89 -129 -27 -18 -48 -23 -98 -23 -77 0 -120 16 -156 60 -50 59 -61 96 -61 210 -1 89 3 113 22 155 28 61 47 82 95 107 48 24 152 26 195 4 36 -19 80 -69 88 -102 5 -21 12 -24 55 -24 27 0 49 4 49 8 0 5 -7 29 -16 55 -18 54 -74 115 -129 142 -54 25 -203 31 -262 9z" />
      </G>
    </Svg>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return <CohubLogo size={size} />;
}

const LOCAL_HARNESS_ICONS: Record<LocalHarness, ComponentType<{ size?: number; color?: string }>> = {
  pi: Pi,
  codex: Codex.Color,
  claude: ClaudeCode.Color,
  workbuddy: CodeBuddy.Color,
};

/** Brand marks keep their colors; Pi's mark is monochrome, so `color` makes it follow the theme text. */
export function HarnessIcon({ harness, size = 16 }: { harness: HarnessKind; size?: number }) {
  const theme = useAppTheme();
  if (harness === "cohub") return <CohubLogo size={size} />;
  const Icon = LOCAL_HARNESS_ICONS[harness];
  return <Icon size={size} color={theme.colors.text} />;
}

/** Avatars are continuous squircles at 30% of their size, so the shape scales with them. `online` marks a live Space runtime. */
export function Avatar({ name, uri, size = 40, online = false }: { name: string; uri?: string | null; size?: number; online?: boolean }) {
  const shape = { width: size, height: size, borderRadius: size * 0.3, borderCurve: "continuous" as const };
  return (
    <View style={{ width: size, height: size }}>
      {uri
        ? <Image source={{ uri }} className="bg-surface-raised" style={shape} />
        : <View className="items-center justify-center bg-accent-soft" style={shape}>
          <Text className="font-semibold text-accent" style={{ fontSize: Math.max(12, Math.round(size * 0.36)) }}>{initials(name)}</Text>
        </View>}
      {online ? <View className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface bg-success" /> : null}
    </View>
  );
}

/** Icon buttons in a top bar's actions draw filled unless they say otherwise. */
const BarButtonContext = createContext(false);

/** `filled` draws the glyph on a solid circle, for bar buttons over content; an accent one fills with the accent. */
export function IconButton({ name, onPress, label, testID, size = 44, tone = "default", filled: filledProp, disabled = false, onPressIn, onPressOut, onTouchCancel }: { name: IconName; onPress: (event: GestureResponderEvent) => void; label: string; testID?: string; size?: number; tone?: "default" | "accent" | "danger"; filled?: boolean; disabled?: boolean; onPressIn?: (event: GestureResponderEvent) => void; onPressOut?: (event: GestureResponderEvent) => void; onTouchCancel?: (event: GestureResponderEvent) => void }) {
  const theme = useAppTheme();
  const inBar = useContext(BarButtonContext);
  const filled = filledProp ?? inBar;
  // The visual circle can be smaller than 44, but the touch target never is.
  const target = Math.max(44, size);
  const iconTone: IconTone = filled && tone === "accent" ? "onAccent" : tone === "accent" ? "accent" : tone === "danger" ? "danger" : filled ? "fg" : "secondary";
  const icon = <AppIcon name={name} size={filled ? FILLED_ICON_SIZE : Math.round(Math.min(size, 44) * 0.5)} tone={iconTone} strokeWidth={filled ? 2.1 : undefined} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      hitSlop={6}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onTouchCancel={onTouchCancel}
      onPress={(event) => { traceAction("icon", { label, id: testID ?? name }); onPress(event); }}
      className={`items-center justify-center rounded-full disabled:opacity-45 ${filled ? "" : tone === "accent" ? "active:bg-accent-soft" : tone === "danger" ? "active:bg-danger-soft" : "active:bg-surface-pressed"}`}
      style={{ width: target, height: target }}
    >
      {filled
        ? ({ pressed }) => <View className="size-9 items-center justify-center" style={{ transform: [{ scale: pressed ? 0.9 : 1 }] }}>
          {/* Glass where the platform draws it; an accent button is glass tinted with the accent. */}
          <GlassBackground radius={18} tint={tone === "accent" ? theme.colors.accent : undefined} />
          {icon}
        </View>
        : icon}
    </Pressable>
  );
}

const FILLED_ICON_SIZE = 18;

export function Screen({ children, scroll = false, refreshing = false, onRefresh, contentStyle, keyboard = false, scrollRef, edgeToEdge = false }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; contentStyle?: ViewStyle; keyboard?: boolean; scrollRef?: React.RefObject<ScrollView | null>; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  const scrollTrace = useRef({ at: 0, y: 0, height: 0, viewport: 0 });
  const traceScroll = (phase: string, event?: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number }; velocity?: { y?: number } | null } }) => {
    const native = event?.nativeEvent;
    const now = Date.now();
    if (phase === "scroll" && now - scrollTrace.current.at < 150) return;
    scrollTrace.current.at = now;
    const y = native?.contentOffset.y ?? scrollTrace.current.y;
    const height = native?.contentSize.height ?? scrollTrace.current.height;
    const viewport = native?.layoutMeasurement.height ?? scrollTrace.current.viewport;
    const deltaY = Math.round(y - scrollTrace.current.y);
    scrollTrace.current.y = y;
    scrollTrace.current.height = height;
    scrollTrace.current.viewport = viewport;
    recordDebugEvent("ui.scroll", { phase, offsetY: Math.round(y), contentHeight: Math.round(height), viewportHeight: Math.round(viewport), deltaY, velocityY: native?.velocity?.y ?? null });
  };
  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-background"
      contentContainerStyle={[{ paddingBottom: insets.bottom + 28 }, contentStyle]}
      refreshControl={onRefresh ? <AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={100}
      onScroll={(event) => traceScroll("scroll", event)}
      onScrollBeginDrag={() => traceScroll("drag_begin")}
      onScrollEndDrag={(event) => traceScroll("drag_end", event)}
      onMomentumScrollBegin={() => traceScroll("momentum_begin")}
      onMomentumScrollEnd={(event) => traceScroll("momentum_end", event)}
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 bg-background" style={contentStyle}>{children}</View>
  );
  const wrapped = !keyboard ? body : Platform.OS === "ios" ? <IOSKeyboardPaddingView>{body}</IOSKeyboardPaddingView> : <KeyboardAvoidingView className="flex-1 bg-background" behavior="height">{body}</KeyboardAvoidingView>;
  return <View className="flex-1 bg-background" style={{ paddingTop: edgeToEdge ? 0 : insets.top }}>{wrapped}</View>;
}

type TopBarProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  transparent?: boolean;
  titleRef?: RefObject<View | null>;
  onTitleLongPress?: () => void;
  titleLongPressLabel?: string;
  /** The title's long-press menu as the iOS system context menu; Android keeps `onTitleLongPress`. */
  titleMenu?: { menu: string; actions: readonly NativeMenuAction[] };
  /** A Large Title: the buttons keep the bar and the title sits below it. */
  large?: boolean;
  /**
   * Tab roots: the bar holds only its buttons, since the selected tab already names the screen.
   * The title stays as the screen reader's header.
   */
  titleHidden?: boolean;
};

export function TopBar({ title, subtitle, onBack, backLabel, leading, actions, children, transparent = false, titleRef, onTitleLongPress, titleLongPressLabel, titleMenu, large = false, titleHidden = false }: TopBarProps) {
  const { t } = useTranslation();
  const titleContent = children ?? <>
    <Text accessibilityRole={onTitleLongPress ? undefined : "header"} numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
    {subtitle ? <Text numberOfLines={1} className="text-caption text-fg-muted">{subtitle}</Text> : null}
  </>;
  if ((large || titleHidden) && !children) return (
    <View testID="app-top-bar" className={`shrink-0 ${transparent ? "" : "bg-background"}`}>
      <View className="flex-row items-center gap-1 px-2 py-1.5" style={{ minHeight: edgeChrome.headerMinHeight }}>
        {onBack ? <IconButton filled name="arrow-left" label={backLabel ?? t("ui.detail.back")} onPress={() => { traceAction("back"); recordDebugEvent("navigation.back.dispatch"); onBack(); }} /> : leading ? <View className="size-11 items-center justify-center">{leading}</View> : null}
        {titleHidden ? <View accessible accessibilityRole="header" accessibilityLabel={title} className="flex-1 self-stretch" /> : <View className="flex-1" />}
        {actions ? <View className="shrink-0 flex-row items-center"><BarButtonContext.Provider value>{actions}</BarButtonContext.Provider></View> : null}
      </View>
      {titleHidden ? null : <View ref={titleRef} collapsable={false} className="px-4 pb-2">
        <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="text-display font-bold text-fg">{title}</Text>
        {subtitle ? <Text numberOfLines={1} className="text-subhead text-fg-muted">{subtitle}</Text> : null}
      </View>}
    </View>
  );
  return (
    <View testID="app-top-bar" className={`shrink-0 flex-row items-center gap-1 px-2 py-1.5 ${transparent ? "" : "bg-background"}`} style={{ minHeight: edgeChrome.headerMinHeight }}>
      {onBack ? <IconButton
        filled
        name="arrow-left"
        label={backLabel ?? t("ui.detail.back")}
        onPress={() => { traceAction("back"); recordDebugEvent("navigation.back.dispatch"); onBack(); }}
        onPressIn={() => recordDebugEvent("navigation.back.press_in")}
        onPressOut={() => recordDebugEvent("navigation.back.press_out")}
        onTouchCancel={() => recordDebugEvent("navigation.back.touch_cancel")}
      /> : leading ? <View className="size-11 items-center justify-center">{leading}</View> : null}
      <View ref={titleRef} collapsable={false} className="min-w-0 flex-1 justify-center px-1">
        {nativeContextMenus && titleMenu ? <NativeContextMenu menu={titleMenu.menu} actions={titleMenu.actions}><View accessible accessibilityRole="header" accessibilityLabel={titleLongPressLabel ?? title} className="min-w-0 justify-center">{titleContent}</View></NativeContextMenu> : onTitleLongPress ? <Pressable accessibilityRole="header" accessibilityLabel={titleLongPressLabel ?? title} onLongPress={onTitleLongPress} className="min-w-0 flex-1 justify-center rounded-sm active:bg-surface-pressed" style={CONTINUOUS}>{titleContent}</Pressable> : titleContent}
      </View>
      {actions ? <View className="shrink-0 flex-row items-center gap-1"><BarButtonContext.Provider value>{actions}</BarButtonContext.Provider></View> : null}
    </View>
  );
}

/** Inset grouped list in the iOS Settings style: a floating card of rows under a section label. */
export function SettingsGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View className="mb-6 px-4">
      {label ? <Text accessibilityRole="header" className="px-4 pb-2 text-caption font-semibold text-fg-muted">{label}</Text> : null}
      <View className="overflow-hidden rounded-md bg-surface" style={CONTINUOUS}>{children}</View>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View className={`flex-row items-center justify-between pl-4 pt-6 ${action ? "pr-1" : "min-h-12 pb-2 pr-4"}`}>
      <Text accessibilityRole="header" className="flex-1 text-headline font-bold text-fg">{title}</Text>
      {action ? <IconButton name={action.icon} label={action.label} onPress={action.onPress} tone="accent" /> : null}
    </View>
  );
}

/** Full class names, so Tailwind's scanner sees every variant. */
const STATUS_PILL_CLASSES = {
  neutral: { bg: "bg-surface-raised", fg: "text-fg-muted", dot: "bg-fg-muted" },
  success: { bg: "bg-success-soft", fg: "text-success", dot: "bg-success" },
  warning: { bg: "bg-warning-soft", fg: "text-warning", dot: "bg-warning" },
  danger: { bg: "bg-danger-soft", fg: "text-danger", dot: "bg-danger" },
  info: { bg: "bg-info-soft", fg: "text-info", dot: "bg-info" },
} as const;

/** For detail headers only; lists carry state with `AvatarStatus`. */
export function StatusPill({ label, tone = "neutral", dot = true }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info"; dot?: boolean }) {
  const classes = STATUS_PILL_CLASSES[tone];
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full px-2 py-1 ${classes.bg}`}>
      {dot ? <View className={`size-1.5 rounded-full ${classes.dot}`} /> : null}
      <Text className={`text-micro font-semibold ${classes.fg}`}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description?: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View className="min-h-64 flex-1 items-center justify-center px-6">
      <View className="size-18 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name={icon} size={30} tone="accent" strokeWidth={1.8} />
      </View>
      <Text className="mt-4 text-center text-headline font-semibold text-fg">{title}</Text>
      {description ? <Text className="mt-1.5 max-w-75 text-center text-subhead text-fg-muted">{description}</Text> : null}
      {action ? <PrimaryButton label={action.label} icon={action.icon} variant="ghost" onPress={action.onPress} className="mt-3" /> : null}
    </View>
  );
}

const BUTTON_VARIANTS = {
  primary: { box: "bg-accent active:bg-accent-pressed", text: "text-on-accent", tone: "onAccent" },
  secondary: { box: "bg-surface-raised active:bg-surface-pressed", text: "text-fg", tone: "fg" },
  ghost: { box: "active:bg-surface-pressed", text: "text-accent", tone: "accent" },
  danger: { box: "bg-danger active:opacity-85", text: "text-on-danger", tone: "fg" },
} as const satisfies Record<string, { box: string; text: string; tone: IconTone }>;

export function PrimaryButton({ label, onPress, icon, loading = false, disabled = false, variant = "primary", className = "", style }: { label: string; onPress: () => void; icon?: IconName; loading?: boolean; disabled?: boolean; variant?: keyof typeof BUTTON_VARIANTS; className?: string; style?: ViewStyle }) {
  const theme = useAppTheme();
  const classes = BUTTON_VARIANTS[variant];
  // The danger fill is a token pair; its foreground is not one of the icon tones.
  const iconColor = variant === "danger" ? theme.colors.dangerText : undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={() => { traceAction("button", { label, variant }); onPress(); }} className={`min-h-13 flex-row items-center justify-center gap-2 rounded-full px-5 disabled:opacity-55 ${classes.box} ${className}`} style={style}>
      {loading ? <Loader color={iconColor ?? theme.colors[ICON_TONES[classes.tone]]} /> : icon ? <AppIcon name={icon} size={18} tone={classes.tone} color={iconColor} /> : null}
      <Text className={`shrink text-body font-semibold ${classes.text}`}>{label}</Text>
    </Pressable>
  );
}

export function SearchField({ value, onChangeText, placeholder, inputRef }: Pick<TextInputProps, "value" | "onChangeText" | "placeholder"> & { inputRef?: React.RefObject<TextInput | null> }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  return (
    <View className="min-h-11 flex-row items-center gap-2.5 rounded-sm bg-surface-raised px-3.5" style={CONTINUOUS}>
      <AppIcon name="search" size={18} tone="muted" />
      <TextInput ref={inputRef} value={value} onChangeText={onChangeText} placeholder={placeholder ?? t("ui.search.placeholder")} placeholderTextColor={theme.colors.textFaint} className="flex-1 py-0 text-body text-fg" returnKeyType="search" />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel={t("ui.search.clear")} onPress={() => onChangeText?.("")} hitSlop={8} className="active:opacity-55"><AppIcon name="circle-x" size={18} tone="faint" /></Pressable> : null}
    </View>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName; locked?: boolean };

// A capsule track holding capsule segments: concentric at any height, since both corners are full.
const SEGMENT_INSET = 3;
const SEGMENT_CORNER = { borderRadius: 999 } as const;
const SEGMENT_THUMB_STYLE = { ...SEGMENT_CORNER, top: SEGMENT_INSET, bottom: SEGMENT_INSET, left: SEGMENT_INSET } as const;

type SegmentedProps<T extends string> = { options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; disabled?: boolean; onLocked?: () => void; className?: string };

/** Mutually exclusive choices: the system segmented control on iOS, the drawn one elsewhere. */
export function Segmented<T extends string>({ size = "regular", ...props }: SegmentedProps<T> & { size?: "regular" | "compact" }) {
  if (nativeSegmented) return <NativeSegmented {...props} />;
  return size === "compact" ? <CompactDrawnSegmented {...props} /> : <DrawnSegmented {...props} />;
}

const COMPACT_SEGMENT_HIT_SLOP = { top: 5, bottom: 5 } as const;

/** Bar-sized: segments fit their labels and the thumb is a tint, so it sits beside bar buttons without outshouting them. */
function CompactDrawnSegmented<T extends string>({ options, value, onChange, disabled = false, onLocked, className = "" }: SegmentedProps<T>) {
  const [layouts, setLayouts] = useState<Partial<Record<T, { x: number; width: number }>>>({});
  const selectedX = layouts[value]?.x;
  const selectedWidth = layouts[value]?.width;
  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const placedValue = useRef<T | null>(null);
  useEffect(() => {
    if (selectedX === undefined || selectedWidth === undefined) return;
    // A first placement or a label resize re-seats the thumb; only a change of choice slides.
    if (placedValue.current !== value) {
      const slide = placedValue.current !== null;
      placedValue.current = value;
      if (slide) {
        thumbX.set(withSpring(selectedX, springs.indicator));
        thumbWidth.set(withSpring(selectedWidth, springs.indicator));
        return;
      }
    }
    thumbX.set(selectedX);
    thumbWidth.set(selectedWidth);
  }, [selectedWidth, selectedX, thumbWidth, thumbX, value]);
  const thumbStyle = useAnimatedStyle(() => ({ width: thumbWidth.get(), transform: [{ translateX: thumbX.get() }] }));
  return (
    <View className={className}>
    <View accessibilityRole="radiogroup" className="flex-row self-start rounded-full bg-surface-raised" style={{ padding: SEGMENT_INSET }}>
      {selectedWidth !== undefined ? <Animated.View pointerEvents="none" className="absolute bg-accent-soft" style={[SEGMENT_CORNER, { top: SEGMENT_INSET, bottom: SEGMENT_INSET, left: 0 }, thumbStyle]} /> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected, disabled: disabled || Boolean(option.locked) }}
            aria-checked={selected}
            disabled={disabled}
            hitSlop={COMPACT_SEGMENT_HIT_SLOP}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              setLayouts((current) => current[option.value]?.x === x && current[option.value]?.width === width ? current : { ...current, [option.value]: { x, width } });
            }}
            onPress={() => {
              traceAction("segment", { label: option.label, value: option.value, selected, locked: Boolean(option.locked) });
              if (option.locked) { onLocked?.(); return; }
              if (!selected) onChange(option.value);
            }}
            className={`min-h-8.5 shrink flex-row items-center justify-center px-3 ${selected ? "" : "active:bg-surface-pressed"} ${option.locked ? "opacity-45" : ""}`}
            style={SEGMENT_CORNER}
          >
            <Text numberOfLines={1} className={`shrink text-caption ${selected ? "font-semibold text-accent" : "font-medium text-fg-secondary"}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

/** A capsule track with the selected choice on an accent thumb that slides between them. */
function DrawnSegmented<T extends string>({ options, value, onChange, disabled = false, onLocked, className = "" }: SegmentedProps<T>) {
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const segmentWidth = trackWidth > 0 ? (trackWidth - SEGMENT_INSET * 2) / options.length : 0;
  const thumbX = useSharedValue(0);
  const placedWidth = useRef(0);
  useEffect(() => {
    if (segmentWidth <= 0 || selectedIndex < 0) return;
    const x = selectedIndex * segmentWidth;
    // A first placement or a resize re-seats the thumb; only a change of choice slides.
    if (placedWidth.current !== segmentWidth) { placedWidth.current = segmentWidth; thumbX.set(x); return; }
    thumbX.set(withSpring(x, springs.indicator));
  }, [segmentWidth, selectedIndex, thumbX]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumbX.get() }] }));
  return (
    <View accessibilityRole="radiogroup" onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} className={`min-h-12 flex-row rounded-full bg-surface-raised ${className}`} style={{ padding: SEGMENT_INSET }}>
      {segmentWidth > 0 && selectedIndex >= 0 ? <Animated.View pointerEvents="none" className="absolute bg-accent" style={[SEGMENT_THUMB_STYLE, { width: segmentWidth }, thumbStyle]} /> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected, disabled: disabled || Boolean(option.locked) }}
            aria-checked={selected}
            disabled={disabled}
            onPress={() => {
              traceAction("segment", { label: option.label, value: option.value, selected, locked: Boolean(option.locked) });
              if (option.locked) { onLocked?.(); return; }
              if (!selected) onChange(option.value);
            }}
            className={`min-h-10 flex-1 flex-row items-center justify-center gap-1.5 px-2 ${selected ? "" : "active:bg-surface-pressed"} ${option.locked ? "opacity-45" : ""}`}
            style={SEGMENT_CORNER}
          >
            {option.icon ? <AppIcon name={option.icon} size={15} tone={selected ? "onAccent" : "muted"} /> : null}
            <Text numberOfLines={1} className={`shrink text-subhead ${selected ? "font-semibold text-on-accent" : "font-medium text-fg-secondary"}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled input: caption label, filled field, optional hint or inline error. */
export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-caption font-semibold text-fg-muted">{label}</Text> : null}
      {children}
      {error ? <Text accessibilityRole="alert" className="text-caption text-danger">{error}</Text> : hint ? <Text className="text-caption text-fg-faint">{hint}</Text> : null}
    </View>
  );
}

/** Shared classes for a `TextInput` inside `Field`, so every form field matches. */
export const FIELD_INPUT_CLASS = "min-h-12 rounded-sm bg-surface-raised px-3 py-2.5 text-body text-fg";

/** Skeleton in the exact shape of `ListRow`, so content replaces it without a jump. */
export function LoadingRows({ count = 5 }: { count?: number }) {
  return <View accessibilityLabel="Loading">{Array.from({ length: count }).map((_, index) => <View key={index} className="mx-4 mb-2 min-h-18 flex-row items-center gap-3.5 rounded-md bg-surface px-4 py-3" style={CONTINUOUS}>
    <View className="bg-surface-raised" style={{ width: LIST_AVATAR_SIZE, height: LIST_AVATAR_SIZE, borderRadius: LIST_AVATAR_SIZE * 0.3, borderCurve: "continuous" }} />
    <View className="flex-1 gap-2">
      <View className="h-3 rounded-full bg-surface-raised" style={{ width: `${58 + (index % 3) * 10}%` }} />
      <View className="h-2.5 rounded-full bg-surface-raised" style={{ width: `${38 + (index % 2) * 15}%` }} />
    </View>
  </View>)}</View>;
}

export type ComposerInputMeasurement = { input: TextInput | null; scrollY: number };

export function ComposerInput({ value, onChangeText, onSend, onStop, onAttach, onVoice, onModelPress, modelLabel, modelStatus = "unknown", disabled = false, sending = false, sendFeedback = "idle", running = false, voiceActive = false, voiceStarting = false, hasAttachment = false, placeholder, anchorRef, measurementRef, attachmentMenuOpen = false, modelMenuOpen = false, showHarnessPicker = false, harness = "cohub", harnessMenuOpen = false, onHarnessPress, onSelectionChange, onFocusChange, attachmentActions, harnessSections }: { value: string; onChangeText: (value: string) => void; onSend: () => void; onStop?: () => void; onAttach: () => void; onVoice?: () => void; onModelPress?: () => void; modelLabel?: string; modelStatus?: "available" | "degraded" | "outage" | "unknown"; disabled?: boolean; sending?: boolean; sendFeedback?: "idle" | "success"; running?: boolean; voiceActive?: boolean; voiceStarting?: boolean; hasAttachment?: boolean; placeholder?: string; anchorRef?: React.RefObject<View | null>; measurementRef?: React.RefObject<ComposerInputMeasurement>; attachmentMenuOpen?: boolean; modelMenuOpen?: boolean; showHarnessPicker?: boolean; harness?: HarnessKind; harnessMenuOpen?: boolean; onHarnessPress?: () => void; onSelectionChange?: (selection: { start: number; end: number }) => void; onFocusChange?: (focused: boolean) => void; /** With system menus (iOS), the add button opens these itself instead of calling `onAttach`. */ attachmentActions?: readonly AnchoredMenuAction[]; /** With system menus (iOS), the harness chip opens these itself instead of calling `onHarnessPress`. */ harnessSections?: readonly NativeMenuSection[] }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const material = useGlassMaterial();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(() => { const frame = Keyboard.metrics(); return frame && isUsableKeyboardFrame(frame) ? frame.screenY : null; });
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  // User edits always round-trip through onChangeText; voice finals update `value`
  // from JS and never produce one, so this marks the last user-driven text. Kept in
  // state because the render-phase expansion check needs the committed value; identical
  // updates bail out, so typing never pays an extra render.
  const [lastUserText, setLastUserText] = useState(value);
  const [autoExpandedFor, setAutoExpandedFor] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const inputTrace = useRef({ at: 0, length: value.length, selectionAt: 0 });
  const keyboardVisible = keyboardTop !== null;
  // Android keeps its bottom safe-area inset while KeyboardAvoidingView is active.
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    // The iOS resume frame would size the composer against a zero-height window.
    const show = Keyboard.addListener(showEvent, (event) => { if (isUsableKeyboardFrame(event.endCoordinates)) setKeyboardTop(event.endCoordinates.screenY); });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardTop(null));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (!value) {
    if (autoExpandedFor !== null) setAutoExpandedFor(null);
    if (expanded) setExpanded(false);
  }
  const { blocked, canSend, canStop } = getComposerActionState({ text: value, hasAttachment, disabled, sending, running, hasStopHandler: Boolean(onStop) });
  // A JS-driven append is invisible to the native measurement (Android's watcher reads a
  // stale layout and never re-fires; iOS defers the event until the height prop changes),
  // so the width-aware estimate stands in for it; a later real measurement still wins.
  const measuredContentHeight = Math.max(contentHeight, estimateComposerContentHeight(value, typography.body.lineHeight * fontScale));
  const layout = getComposerLayout({
    text: value,
    contentHeight: measuredContentHeight,
    lineHeight: typography.body.lineHeight * fontScale,
    availableHeight: Math.min(windowHeight, keyboardTop ?? windowHeight) - insets.top - (keyboardVisible ? 0 : insets.bottom),
    expanded,
  });
  // Dictation appends a whole transcript at once, and the overflowing final can land after
  // the mic already stopped, so auto-expand keys off the missing onChangeText round-trip
  // instead of active recording. It fires once per append so a manual collapse sticks while
  // the transcript is reviewed before sending; the next append re-arms it.
  if (shouldAutoExpandComposer({ value, expanded, scrollEnabled: layout.scrollEnabled, lastUserText, autoExpandedFor })) {
    setAutoExpandedFor(value);
    setExpanded(true);
  }
  const resolvedModelLabel = modelLabel ?? t("ui.composer.modelAutomatic");
  const modelStatusLabel = modelStatus === "available" ? t("ui.modelStatus.available") : modelStatus === "degraded" ? t("ui.modelStatus.degraded") : modelStatus === "outage" ? t("ui.modelStatus.outage") : t("ui.modelStatus.unknown");
  return (
    <View style={[styles.composerWrap, { paddingBottom: (Platform.OS === "android" && keyboardVisible ? 0 : insets.bottom) + 10 }]}>
      {/* Glyphs pop only when they change, not when the composer first appears. */}
      <LayoutAnimationConfig skipEntering skipExiting>
      <View ref={anchorRef} collapsable={false} testID="chat-composer" className={`gap-2 overflow-hidden ${material === "liquid" ? "" : "shadow-float"}`} style={styles.composerSurface}>
        <GlassBackground radius={styles.composerSurface.borderRadius} solidClassName="bg-surface" />
        <View className="flex-row items-start">
          <TextInput
            ref={(input) => { inputRef.current = input; if (measurementRef) measurementRef.current.input = input; }}
            testID="chat-composer-input"
            accessibilityLabel={t("ui.composer.placeholder")}
            value={value}
            onChangeText={(next) => {
              setLastUserText(next);
              const now = Date.now();
              if (now - inputTrace.current.at >= 300) {
                recordDebugEvent("ui.input", { field: "composer", action: next.length < inputTrace.current.length ? "delete" : "insert", length: next.length, delta: next.length - inputTrace.current.length, lines: next.split("\n").length });
                inputTrace.current.at = now;
              }
              inputTrace.current.length = next.length;
              onChangeText(next);
            }}
            onScroll={(event) => {
              if (measurementRef) measurementRef.current.scrollY = event.nativeEvent.contentOffset.y;
              // A JS-driven append scrolls the caret natively without an onChangeText, and iOS
              // only emits onContentSizeChange once the height prop itself has changed, which
              // starves the growth logic. The scroll event still carries a fresh content size;
              // only raising the measurement keeps Android's coarser scroll payload from
              // shrinking the box. iOS includes it but the RN types omit it (Android leaves
              // it unset), so it is read as an optional extra.
              const appendedSize = (event.nativeEvent as { contentSize?: { height: number } }).contentSize;
              if (value !== lastUserText && typeof appendedSize?.height === "number" && Number.isFinite(appendedSize.height)) {
                setContentHeight((current) => Math.max(current, appendedSize.height));
              }
            }}
            onContentSizeChange={(event) => {
              setContentHeight(event.nativeEvent.contentSize.height);
              // Native inputs keep their scroll position on JS-driven text updates, so
              // a voice-appended tail lands below the fold. This event only fires after
              // the native layout reflects the new text, which is when the scroll lands.
              if (value !== lastUserText) inputRef.current?.setSelection(value.length, value.length);
            }}
            editable={!disabled}
            multiline
            scrollEnabled={layout.scrollEnabled}
            maxLength={12000}
            placeholder={placeholder ?? t("ui.composer.placeholder")}
            placeholderTextColor={theme.colors.textFaint}
            className="min-w-0 flex-1 text-body text-fg"
            style={[styles.composerText, { height: layout.height }]}
            onSelectionChange={(event) => {
              const now = Date.now();
              if (now - inputTrace.current.selectionAt >= 300) {
                inputTrace.current.selectionAt = now;
                recordDebugEvent("ui.input", { field: "composer", action: "selection", start: event.nativeEvent.selection.start, end: event.nativeEvent.selection.end, length: value.length });
              }
              onSelectionChange?.(event.nativeEvent.selection);
            }}
            onFocus={() => { recordDebugEvent("ui.focus", { field: "composer" }); onFocusChange?.(true); }}
            onBlur={() => { recordDebugEvent("ui.blur", { field: "composer" }); onFocusChange?.(false); }}
            submitBehavior="newline"
          />
          <View className="w-11 h-11">
            {layout.showExpandButton ? <Pressable
              testID="chat-composer-expand"
              accessibilityRole="button"
              accessibilityLabel={t(layout.expanded ? "ui.composer.collapse" : "ui.composer.expand")}
              accessibilityState={{ expanded: layout.expanded }}
              onPress={() => { traceAction("composer_expand", { expanded: !layout.expanded }); setExpanded(!layout.expanded); }}
              className="size-11 items-center justify-center rounded-full active:bg-surface-pressed"
            ><AppIcon name={layout.expanded ? "minimize" : "maximize"} size={17} tone="muted" /></Pressable> : null}
          </View>
        </View>
        <View className="h-11 flex-row items-center gap-1.5">
          {nativeMenus && attachmentActions ? <NativeMenuButton appearance="control" icon="plus" label={t("ui.composer.addAttachment")} actions={attachmentActions} disabled={blocked} testID="chat-composer-attach" /> : <Pressable testID="chat-composer-attach" accessibilityRole="button" accessibilityLabel={t("ui.composer.addAttachment")} accessibilityState={{ expanded: attachmentMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { traceAction("composer_attach", { menuOpen: attachmentMenuOpen }); Keyboard.dismiss(); onAttach(); }} className={`size-11 items-center justify-center rounded-full ${attachmentMenuOpen ? "bg-surface-pressed" : "bg-surface-raised active:bg-surface-pressed"} ${blocked ? "opacity-45" : ""}`}><Animated.View key={attachmentMenuOpen ? "close" : "add"} entering={controlIconEntering} exiting={controlIconExiting}><AppIcon name={attachmentMenuOpen ? "x" : "plus"} size={22} tone="secondary" /></Animated.View></Pressable>}
          {showHarnessPicker && nativeMenus && harnessSections ? <NativeMenuButton appearance="chip" icon="check" title={labelForHarness(harness)} label={t("runtime.harness.current", { harness: labelForHarness(harness) })} sections={harnessSections} disabled={blocked} testID="chat-composer-harness" /> : showHarnessPicker ? <Pressable testID="chat-composer-harness" accessibilityRole="button" accessibilityLabel={t("runtime.harness.current", { harness: labelForHarness(harness) })} accessibilityState={{ expanded: harnessMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { traceAction("composer_harness", { harness }); Keyboard.dismiss(); onHarnessPress?.(); }} className={`h-10 min-w-0 max-w-26 shrink flex-row items-center gap-1.5 overflow-hidden rounded-sm px-2 ${harnessMenuOpen ? "bg-surface-pressed" : "bg-surface-raised active:bg-surface-pressed"} ${blocked ? "opacity-50" : ""}`}>
            <HarnessIcon harness={harness} size={16} />
            <Text numberOfLines={1} className="text-caption text-fg shrink">{labelForHarness(harness)}</Text>
            <AppIcon name="chevron-down" size={13} tone="muted" />
          </Pressable> : null}
          {onModelPress ? <Pressable testID="chat-composer-model" accessibilityRole="button" accessibilityLabel={t("ui.composer.chooseModel", { model: resolvedModelLabel, status: modelStatusLabel })} accessibilityState={{ expanded: modelMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { traceAction("composer_model", { model: resolvedModelLabel }); Keyboard.dismiss(); onModelPress(); }} className={`h-11 min-w-0 shrink flex-row items-center gap-1.5 overflow-hidden rounded-full px-2.5 ${modelMenuOpen ? "bg-surface-pressed" : "bg-surface-raised active:bg-surface-pressed"} ${blocked ? "opacity-50" : ""}`} style={{ maxWidth: "58%" }}>
            <AppIcon name="zap" size={18} tone="secondary" />
            <Text numberOfLines={1} className="text-body font-semibold text-fg shrink">{resolvedModelLabel}</Text>
            {modelStatus === "unknown" ? null : <View className={`size-1.5 rounded-full ${modelStatus === "available" ? "bg-success" : modelStatus === "degraded" ? "bg-warning" : "bg-danger"}`} />}
            <AppIcon name="chevron-down" size={14} tone="muted" />
          </Pressable> : null}
          <View className="flex-1 min-w-0" />
          {onVoice ? <Pressable accessibilityRole="button" accessibilityLabel={voiceActive ? t("ui.composer.voiceStop") : t("ui.composer.voiceStart")} accessibilityState={{ disabled: blocked || voiceStarting, selected: voiceActive }} disabled={blocked || voiceStarting} onPress={() => { traceAction("composer_voice", { active: voiceActive, starting: voiceStarting }); onVoice(); }} className={`size-11 items-center justify-center rounded-full ${voiceActive ? "bg-accent-soft active:bg-accent-border" : "bg-surface-raised active:bg-surface-pressed"} ${blocked ? "opacity-45" : ""}`}>{voiceStarting ? <Loader color={theme.colors.textMuted} /> : <AppIcon name="mic" size={21} tone={voiceActive ? "accent" : "secondary"} />}</Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={canStop ? t("ui.composer.stop") : t("ui.composer.send")} disabled={!canStop && !canSend} onPress={() => { traceAction(canStop ? "composer_stop" : "composer_send", { length: value.length, attachment: hasAttachment, disabled: blocked }); if (canStop) onStop?.(); else onSend(); }} className={`size-11 items-center justify-center rounded-full ${canStop ? "bg-fg active:bg-fg-secondary" : canSend ? "bg-accent active:bg-accent-pressed" : "bg-surface-raised"}`}>
            <Animated.View key={canStop ? "stop" : sendFeedback === "success" ? "sent" : sending ? "sending" : "send"} entering={controlIconEntering} exiting={controlIconExiting}>
              {canStop ? <AppIcon name="stop" size={17} color={theme.colors.background} fill={theme.colors.background} /> : sendFeedback === "success" ? <AppIcon name="check" size={22} tone="onAccent" /> : sending ? <Loader color={theme.colors.accentText} /> : <AppIcon name="arrow-up" size={22} tone={canSend ? "onAccent" : "faint"} />}
            </Animated.View>
          </Pressable>
        </View>
      </View>
      </LayoutAnimationConfig>
    </View>
  );
}

export function AttachmentChip({ name, uri, mimeType, onRemove }: { name: string; uri?: string; mimeType?: string; onRemove?: () => void }) {
  const { t } = useTranslation();
  return <View className="max-w-full flex-row items-center gap-1.5 rounded-sm bg-accent-soft px-2 py-1.5" style={{ minHeight: 44, borderCurve: "continuous" }}>
    {uri && mimeType?.startsWith("image/") ? <Image source={{ uri }} resizeMode="cover" className="w-8 h-8 rounded-xs" /> : <AppIcon name="file-text" size={20} tone="accent" />}
    <Text numberOfLines={1} className="text-caption text-fg flex-1 min-w-0">{name}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("common.remove")}: ${name}`} disabled={!onRemove} onPress={onRemove} hitSlop={8}><AppIcon name="x" size={15} tone="muted" /></Pressable>
  </View>;
}

export function ConnectionBanner({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fade.duration)} pointerEvents="none" className="absolute left-4 right-4 top-full mt-2 items-center">
    <View accessible accessibilityRole="alert" className="max-w-full flex-row items-center gap-1.5 rounded-full bg-surface-float px-3 py-1.5 shadow-float">
      <AppIcon name="cloud-off" size={14} tone="danger" />
      <Text numberOfLines={1} className="text-caption text-fg">{t("ui.banner.unavailable")}</Text>
    </View>
  </Animated.View>;
}

export function DataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-md bg-danger-soft py-2 pl-3 pr-1" style={CONTINUOUS}>
    <AppIcon name="cloud-off" size={18} tone="danger" />
    <View className="min-w-0 flex-1">
      <Text className="text-subhead font-semibold text-fg">{t("ui.dataError.title")}</Text>
      <Text selectable className="text-caption text-danger">{message}</Text>
    </View>
    <IconButton name="refresh" label={t("ui.dataError.retry")} onPress={onRetry} tone="danger" />
  </View>;
}

export function getStatusTone(status: ActivityItem["status"]): "success" | "warning" | "danger" | "neutral" {
  return status === "running" ? "warning" : status === "failed" ? "danger" : status === "stopped" ? "neutral" : "success";
}

export function useBackButton() {
  return useRouter();
}

/**
 * iOS padding-mode replacement for KeyboardAvoidingView. RN's version applies the resume
 * keyboard frame (zero origin) as an overlap of the whole screen, which collapses the content
 * to nothing until the keyboard is dismissed. Unusable frames are ignored here, and
 * `keyboardDidShow` re-applies the frame once the scene is active and RN can convert it.
 * Like RN's view, it listens to show/hide only: split and floating keyboards report a frame
 * change before their hide.
 */
function IOSKeyboardPaddingView({ children }: { children: ReactNode }) {
  const { height: windowHeight } = useWindowDimensions();
  const [bottom, setBottom] = useState(0);
  const bottomRef = useRef(0);

  useEffect(() => {
    const apply = (name: string, event: KeyboardEvent) => {
      const frame = event.endCoordinates;
      if (!isUsableKeyboardFrame(frame)) {
        recordDebugEvent("keyboard.frame_ignored", { event: name, screenY: frame.screenY, height: frame.height, windowHeight });
        return;
      }
      const next = keyboardOverlap(frame, windowHeight);
      if (next === bottomRef.current) return;
      bottomRef.current = next;
      Keyboard.scheduleLayoutAnimation(event);
      setBottom(next);
    };
    const willShow = Keyboard.addListener("keyboardWillShow", (event) => apply("keyboardWillShow", event));
    const didShow = Keyboard.addListener("keyboardDidShow", (event) => apply("keyboardDidShow", event));
    const willHide = Keyboard.addListener("keyboardWillHide", (event) => {
      if (bottomRef.current === 0) return;
      bottomRef.current = 0;
      Keyboard.scheduleLayoutAnimation(event);
      setBottom(0);
    });
    return () => { willShow.remove(); didShow.remove(); willHide.remove(); };
  }, [windowHeight]);

  return <View className="flex-1 bg-background" style={{ paddingBottom: bottom }}>{children}</View>;
}

/** A control whose glyph changes (send, stop, sent; add, close) pops the new glyph in instead of swapping it. */
function controlIconEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withTiming(1, { duration: motion.fade.duration }), transform: [{ scale: withSpring(1, springs.pop) }] },
  };
}

/** The outgoing glyph keeps its frame and fades under the incoming one, so the swap reads as one change. */
function controlIconExiting() {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, { duration: motion.fadeOut.duration }), transform: [{ scale: withTiming(0.6, { duration: motion.fadeOut.duration }) }] },
  };
}

const styles = StyleSheet.create({
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  // Concentric with the 44 pt corner controls inset by the 8 pt padding: 8 + 44 / 2.
  composerSurface: { padding: 8, borderRadius: 30, borderCurve: "continuous" },
  composerText: { paddingHorizontal: 5, paddingVertical: COMPOSER_TEXT_PADDING / 2, textAlignVertical: "top", includeFontPadding: false },
});
