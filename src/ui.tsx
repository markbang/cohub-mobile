import { useRouter } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useContext, useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  Image,
  Keyboard,
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
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView, KeyboardEvents } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ClaudeCode, CodeBuddy, Codex, Cursor, Pi } from "@lobehub/icons-rn";
import { harnessLabel as labelForHarness, type HarnessKind, type LocalHarness } from "@neta-art/cohub";
import Animated, { Easing, FadeIn, FadeOut, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { IconName } from "@/src/icons";
import { Glyph } from "@/src/ui/Glyph";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { haptics } from "@/src/platform/haptics";
import { getComposerActionState } from "@/src/data/composer-state";
import { useDelayedStatus } from "@/src/data/use-delayed-status";
import type { AttachmentUploadState } from "@/src/data/attachment-uploads";
import { PasteImagesInput } from "@/src/platform/paste-input";
import { COMPOSER_TEXT_PADDING, estimateComposerContentHeight, getComposerLayout, shouldAutoExpandComposer } from "@/src/ui/composer-layout";
import { isUsableKeyboardFrame } from "@/src/ui/keyboard-frame";
import { useTranslation } from "@/src/i18n";
import { edgeChrome, MAX_FONT_SCALE, useAppTheme, typography } from "@/src/theme";
import { touchSlop } from "@/src/ui/touch-target";
import type { ColorKey } from "@/src/design/tokens";
import { curves, glyphSwap, motion, springs } from "@/src/motion";
import { BarButtonContext } from "@/src/ui/bar-button-context";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";
import { nativeHeaders, useNativeHeader } from "@/src/ui/NativeHeader";
import { AppRefreshControl } from "@/src/ui/AppRefreshControl";
import { Loader } from "@/src/ui/Loader";
import { CohubLogo, Mascot } from "@/src/ui/Mascot";
import { NativeSegmented, nativeSegmented } from "@/src/ui/NativeSegmented";
import { NativeMenuButton, nativeMenus, type NativeMenuAction, type NativeMenuSection } from "@/src/components/NativeMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import type { AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import type { AttachmentDraft, ActivityItem } from "@/src/data/types";
import { initials } from "@/src/utils";

export { AppSwitch } from "@/src/ui/AppSwitch";
export { CohubLogo, Mascot, MascotLoader } from "@/src/ui/Mascot";
export { AppRefreshControl, listRefreshProps } from "@/src/ui/AppRefreshControl";
export { ListEdgeLoader, Loader, LoadingState } from "@/src/ui/Loader";
export { Bone, LoadingDocument, LoadingFlatRows, LoadingRows, LoadingSections, Skeleton, type SkeletonSection } from "@/src/ui/Skeleton";

const CONTINUOUS = { borderCurve: "continuous" } as const;
export type { IconName } from "@/src/icons";

export type IconTone = "fg" | "secondary" | "muted" | "faint" | "accent" | "onAccent" | "success" | "warning" | "danger" | "info";

const ICON_TONES: Record<IconTone, ColorKey> = {
  fg: "text", secondary: "textSecondary", muted: "textMuted", faint: "textFaint", accent: "accent", onAccent: "accentText",
  success: "success", warning: "warning", danger: "danger", info: "info",
};

/** Glyphs need a JS color, so icons take a token `tone`; `color` is for computed values only. */
export function AppIcon({ name, size = 20, color, tone = "secondary", strokeWidth = 1.9, fill, style }: { name: IconName; size?: number; color?: ColorValue; tone?: IconTone; strokeWidth?: number; fill?: string; style?: object }) {
  const theme = useAppTheme();
  return <Glyph name={name} size={size} color={color ?? theme.colors[ICON_TONES[tone]]} strokeWidth={strokeWidth} fill={fill} style={style} />;
}

const LOCAL_HARNESS_ICONS: Record<LocalHarness, ComponentType<{ size?: number; color?: string }>> = {
  pi: Pi,
  codex: Codex.Color,
  claude: ClaudeCode.Color,
  workbuddy: CodeBuddy.Color,
  cursor: Cursor,
};

/** Brand marks keep their colors; Pi's and Cursor's marks are monochrome, so `color` makes them follow the theme text. */
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
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE.glyph} className="font-semibold text-accent" style={{ fontSize: Math.max(12, Math.round(size * 0.36)) }}>{initials(name)}</Text>
        </View>}
      {online ? <View className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface bg-success" /> : null}
    </View>
  );
}

/**
 * `filled` draws the glyph on a solid circle, for bar buttons over content. `accent` fills with the accent and is
 * kept for a screen's one primary action; `active` marks a control in a non-default state with an accent glyph only.
 */
export function IconButton({ name, onPress, label, testID, size = 44, tone = "default", filled: filledProp, disabled = false, onPressIn, onPressOut, onTouchCancel }: { name: IconName; onPress: (event: GestureResponderEvent) => void; label: string; testID?: string; size?: number; tone?: "default" | "accent" | "active" | "danger"; filled?: boolean; disabled?: boolean; onPressIn?: (event: GestureResponderEvent) => void; onPressOut?: (event: GestureResponderEvent) => void; onTouchCancel?: (event: GestureResponderEvent) => void }) {
  const theme = useAppTheme();
  const bar = useContext(BarButtonContext);
  const filled = bar === "native" ? false : filledProp ?? bar === "drawn";
  // The visual circle can be smaller than 44, but the touch target never is.
  const target = Math.max(44, size);
  const iconTone: IconTone = filled && tone === "accent" ? "onAccent" : tone === "accent" || tone === "active" ? "accent" : tone === "danger" ? "danger" : filled || bar === "native" ? "fg" : "secondary";
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
      className={`items-center justify-center rounded-full disabled:opacity-45 ${filled ? "" : tone === "accent" || tone === "active" ? "active:bg-accent-soft" : tone === "danger" ? "active:bg-danger-soft" : "active:bg-surface-pressed"}`}
      style={{ width: target, height: target }}
    >
      {filled
        // A 44 pt glass circle, as iOS 26 draws bar buttons.
        ? ({ pressed }) => <View className="size-11 items-center justify-center" style={{ transform: [{ scale: pressed ? 0.9 : 1 }] }}>
          {/* Glass where the platform draws it; an accent button is glass tinted with the accent. */}
          <GlassBackground radius={22} tint={tone === "accent" ? theme.colors.accent : undefined} />
          {icon}
        </View>
        : icon}
    </Pressable>
  );
}

const FILLED_ICON_SIZE = 18;
/** The detail shrinks far faster than the model name, so a narrow chip cuts the level first. */
const MODEL_DETAIL_SHRINK = { flexShrink: 100 } as const;

export function Screen({ children, scroll = false, refreshing = false, onRefresh, contentStyle, keyboard = false, scrollRef, edgeToEdge = false }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; contentStyle?: ViewStyle; keyboard?: boolean; scrollRef?: React.RefObject<ScrollView | null>; edgeToEdge?: boolean }) {
  const insets = useSafeAreaInsets();
  // The native bar's height, status bar included; 0 when this screen's navigator shows no header.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
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
  // The keyboard is followed frame by frame on the UI thread, with its own curve, on both platforms.
  const wrapped = !keyboard ? body : <KeyboardAvoidingView behavior="padding" style={FILL}>{body}</KeyboardAvoidingView>;
  // The iOS navigation bar overlays the screen, and the native safe area measures only the status bar
  // above it, so content starts below the bar's measured height.
  if (Platform.OS === "ios" && !edgeToEdge && headerHeight > 0) return <View className="flex-1 bg-background" style={{ paddingTop: headerHeight }}>{wrapped}</View>;
  if (Platform.OS === "ios" && !edgeToEdge) return <View className="flex-1 bg-background"><SafeAreaView edges={TOP_EDGE} style={FILL}>{wrapped}</SafeAreaView></View>;
  return <View className="flex-1 bg-background" style={{ paddingTop: edgeToEdge ? 0 : insets.top }}>{wrapped}</View>;
}

const TOP_EDGE = ["top"] as const;
/** Two lines (headline + caption) and the 2 pt inset make 44, so one radius keeps it a capsule with or without a subtitle. */
const TITLE_CAPSULE = { minHeight: 44, borderRadius: 22, borderCurve: "continuous" } as const;
const FILL = { flex: 1 } as const;

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
  /** Keeps the drawn bar on iOS, for bars that move with their content. */
  drawn?: boolean;
};

export function TopBar({ title, subtitle, onBack, backLabel, leading, actions, children, transparent = false, titleRef, onTitleLongPress, titleLongPressLabel, titleMenu, large = false, titleHidden = false, drawn = false }: TopBarProps) {
  const { t } = useTranslation();
  // A pushed screen's plain bar is the iOS navigation bar. Its back button pops the route itself, so
  // `onBack` there is only ever `router.back()`; screens that guard leaving use `usePreventRemove`.
  const system = nativeHeaders && !drawn && Boolean(onBack) && !leading && !children && !transparent && !titleRef && !titleMenu && !onTitleLongPress && !large && !titleHidden;
  useNativeHeader(system ? { title, subtitle, right: actions } : null);
  // A drawn bar centers its title as UIKit does, balancing whichever side is wider. Until the trailing
  // buttons are measured the title is not drawn, so it never lands off-center for a frame and jumps.
  const [trailingWidth, setTrailingWidth] = useState<number | null>(null);
  if (system) return null;
  // Over scrolling content the title sits on a glass capsule like the bar's buttons, so the rows passing
  // beneath never run through its text.
  const capsule = transparent && !children;
  const titleText = <>
    <Text accessibilityRole={onTitleLongPress ? undefined : "header"} numberOfLines={1} className="text-center text-headline font-semibold text-fg">{title}</Text>
    {subtitle ? <Text numberOfLines={1} className="text-center text-caption text-fg-muted">{subtitle}</Text> : null}
  </>;
  const titleContent = children ?? (capsule
    ? <View className="max-w-full self-center justify-center px-4 py-0.5" style={TITLE_CAPSULE}><GlassBackground radius={TITLE_CAPSULE.borderRadius} />{titleText}</View>
    : titleText);
  // Each bar slot is a 44 pt glass circle; slots sit 12 apart, as in an iOS 26 bar.
  const leadingWidth = onBack || leading ? 44 + 12 : 0;
  const trailing = actions ? (trailingWidth ?? 0) + 12 : 0;
  const side = Math.max(leadingWidth, trailing);
  // The capsule drops only the leading balance, so a long title takes the slack beside the back button;
  // with wider actions a short one sits slightly left of the screen's center.
  const balance = children ? undefined : { marginLeft: capsule ? 0 : side - leadingWidth, marginRight: side - trailing, opacity: actions && trailingWidth === null ? 0 : 1 };
  if ((large || titleHidden) && !children) return (
    <View testID="app-top-bar" className={`shrink-0 ${transparent ? "" : "bg-background"}`}>
      <View className="flex-row items-center gap-3 px-4" style={{ minHeight: edgeChrome.headerMinHeight }}>
        {onBack ? <IconButton filled name="chevron-left" label={backLabel ?? t("ui.detail.back")} onPress={() => { traceAction("back"); recordDebugEvent("navigation.back.dispatch"); onBack(); }} /> : leading ? <View className="size-11 items-center justify-center">{leading}</View> : null}
        {titleHidden ? <View accessible accessibilityRole="header" accessibilityLabel={title} className="flex-1 self-stretch" /> : <View className="flex-1" />}
        {actions ? <View className="shrink-0 flex-row items-center gap-3"><BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider></View> : null}
      </View>
      {titleHidden ? null : <View ref={titleRef} collapsable={false} className="px-4 pb-2">
        <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="text-display font-semibold text-fg">{title}</Text>
        {subtitle ? <Text numberOfLines={1} className="text-subhead text-fg-muted">{subtitle}</Text> : null}
      </View>}
    </View>
  );
  return (
    <View testID="app-top-bar" className={`shrink-0 flex-row items-center gap-3 px-4 ${transparent ? "" : "bg-background"}`} style={{ minHeight: edgeChrome.headerMinHeight }}>
      {onBack ? <IconButton
        filled
        name="chevron-left"
        label={backLabel ?? t("ui.detail.back")}
        onPress={() => { traceAction("back"); recordDebugEvent("navigation.back.dispatch"); onBack(); }}
        onPressIn={() => recordDebugEvent("navigation.back.press_in")}
        onPressOut={() => recordDebugEvent("navigation.back.press_out")}
        onTouchCancel={() => recordDebugEvent("navigation.back.touch_cancel")}
      /> : leading ? <View className="size-11 items-center justify-center">{leading}</View> : null}
      <View ref={titleRef} collapsable={false} className="min-w-0 flex-1 justify-center px-1" style={balance}>
        {nativeContextMenus && titleMenu ? <NativeContextMenu menu={titleMenu.menu} actions={titleMenu.actions}><View accessible accessibilityRole="header" accessibilityLabel={titleLongPressLabel ?? title} className="min-w-0 justify-center">{titleContent}</View></NativeContextMenu> : onTitleLongPress ? <Pressable accessibilityRole="header" accessibilityLabel={titleLongPressLabel ?? title} onLongPress={onTitleLongPress} className={capsule ? "max-w-full self-center active:opacity-70" : "min-w-0 flex-1 justify-center rounded-sm active:bg-surface-pressed"} style={CONTINUOUS}>{titleContent}</Pressable> : titleContent}
      </View>
      {actions ? <View onLayout={(event) => setTrailingWidth(event.nativeEvent.layout.width)} className="shrink-0 flex-row items-center gap-3"><BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider></View> : null}
    </View>
  );
}

/** Inset grouped list in the iOS Settings style: a floating card of rows under a section label, with an optional footnote. */
export function SettingsGroup({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  return (
    <View className="mb-6 px-4">
      {label ? <Text accessibilityRole="header" className="px-4 pb-2 text-caption font-semibold text-fg-muted">{label}</Text> : null}
      <View className="overflow-hidden rounded-md bg-surface" style={CONTINUOUS}>{children}</View>
      {footer ? <Text className="px-4 pt-2 text-caption text-fg-muted">{footer}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View className={`flex-row items-center justify-between pl-4 pt-6 ${action ? "pr-1" : "min-h-12 pb-2 pr-4"}`}>
      <Text accessibilityRole="header" className="flex-1 text-headline font-semibold text-fg">{title}</Text>
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
    <View className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${classes.bg}`}>
      {dot ? <View className={`size-1.5 rounded-full ${classes.dot}`} /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE.badge} className={`text-micro font-semibold ${classes.fg}`}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description?: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View className="min-h-64 flex-1 items-center justify-center px-6">
      {/* The mascot is the brand; the sticker says which kind of empty this is, clear of its cheek mark. */}
      <View>
        <Mascot size={92} mood={icon === "alert" || icon === "circle-x" || icon === "cloud-off" ? "worried" : "idle"} />
        <View className="absolute -bottom-0.5 -left-1 size-8 items-center justify-center rounded-full bg-accent">
          <AppIcon name={icon} size={16} tone="onAccent" strokeWidth={2.1} />
        </View>
      </View>
      <Text className="mt-4 text-center text-headline font-semibold text-fg">{title}</Text>
      {description ? <Text className="mt-2 max-w-75 text-center text-subhead text-fg-muted">{description}</Text> : null}
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
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={() => { traceAction("button", { label, variant }); onPress(); }} className={`min-h-13 flex-row items-center justify-center gap-2 rounded-full px-5 py-2 disabled:opacity-55 ${classes.box} ${className}`} style={style}>
      {loading ? <Loader color={iconColor ?? theme.colors[ICON_TONES[classes.tone]]} /> : icon ? <AppIcon name={icon} size={18} tone={classes.tone} color={iconColor} /> : null}
      {/* Uncapped: at large text sizes the label wraps and the button grows with it. */}
      <Text className={`shrink text-center text-body font-semibold ${classes.text}`}>{label}</Text>
    </Pressable>
  );
}

export function SearchField({ value, onChangeText, placeholder, inputRef }: Pick<TextInputProps, "value" | "onChangeText" | "placeholder"> & { inputRef?: React.RefObject<TextInput | null> }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  return (
    // The iOS 26 search field: a 44 pt capsule on the system fill, a black glyph, the text 58 pt in.
    <View className="min-h-11 flex-row items-center gap-2 rounded-full bg-control-track px-4">
      <AppIcon name="search" size={18} tone="fg" />
      <TextInput ref={inputRef} value={value} onChangeText={onChangeText} placeholder={placeholder ?? t("ui.search.placeholder")} placeholderTextColor={theme.colors.textFaint} className="flex-1 py-0 text-body text-fg" returnKeyType="search" />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel={t("ui.search.clear")} onPress={() => onChangeText?.("")} hitSlop={CLEAR_SLOP} className="active:opacity-55"><AppIcon name="circle-x" size={18} tone="faint" /></Pressable> : null}
    </View>
  );
}

// The field's 16 pt end padding and 44 pt height leave room for the slop inside it.
const CLEAR_SLOP = touchSlop(18);

export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName; locked?: boolean };

// The iOS 26 segmented control, measured: a 32 pt capsule track with a capsule thumb inset by 2.
const SEGMENT_INSET = 2;
const SEGMENT_CORNER = { borderRadius: 999 } as const;
const SEGMENT_THUMB_STYLE = { ...SEGMENT_CORNER, top: SEGMENT_INSET, bottom: SEGMENT_INSET, left: SEGMENT_INSET } as const;
// The 28 pt segments reach 44 pt targets through the track's inset and this slop.
const SEGMENT_HIT_SLOP = { top: 8, bottom: 8 } as const;

type SegmentedProps<T extends string> = { options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; disabled?: boolean; onLocked?: () => void; className?: string };

/** Mutually exclusive choices: the system segmented control on iOS, the same control drawn elsewhere. */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  if (nativeSegmented) return <NativeSegmented {...props} />;
  return <DrawnSegmented {...props} />;
}

/** UIKit's look: equal segments, plain labels (the system control shows no icons), a neutral thumb that slides. */
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
    <View accessibilityRole="radiogroup" onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} className={`min-h-8 flex-row rounded-full bg-control-track ${disabled ? "opacity-50" : ""} ${className}`} style={{ padding: SEGMENT_INSET }}>
      {segmentWidth > 0 && selectedIndex >= 0 ? <Animated.View pointerEvents="none" className="absolute bg-control-thumb" style={[SEGMENT_THUMB_STYLE, { width: segmentWidth }, thumbStyle]} /> : null}
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
            hitSlop={SEGMENT_HIT_SLOP}
            onPress={() => {
              traceAction("segment", { label: option.label, value: option.value, selected, locked: Boolean(option.locked) });
              if (option.locked) { onLocked?.(); return; }
              if (!selected) { haptics.selection(); onChange(option.value); }
            }}
            className={`min-h-7 flex-1 items-center justify-center px-2 ${option.locked ? "opacity-45" : ""}`}
            style={SEGMENT_CORNER}
          >
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="shrink text-caption font-medium text-fg">{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled input: caption label, filled field, optional hint or inline error. */
export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View className="gap-2">
      {label ? <Text className="text-caption font-semibold text-fg-muted">{label}</Text> : null}
      {children}
      {error ? <Text accessibilityRole="alert" className="text-caption text-danger">{error}</Text> : hint ? <Text className="text-caption text-fg-faint">{hint}</Text> : null}
    </View>
  );
}

/** Shared classes for a `TextInput` inside `Field`, so every form field matches. */
export const FIELD_INPUT_CLASS = "min-h-12 rounded-sm bg-surface-raised px-3 py-3 text-body text-fg";

export type ComposerInputMeasurement = { input: TextInput | null; scrollY: number };

export function ComposerInput({ value, onChangeText, onSend, onStop, onAttach, onVoice, onModelPress, modelLabel, modelDetail, modelStatus = "unknown", disabled = false, sending = false, sendFeedback = "idle", running = false, voiceActive = false, voiceStarting = false, hasAttachment = false, placeholder, anchorRef, menuSourceRef, measurementRef, attachmentMenuOpen = false, modelMenuOpen = false, showHarnessPicker = false, harness = "cohub", harnessMenuOpen = false, onHarnessPress, onSelectionChange, onFocusChange, onPasteImages, attachmentActions, harnessSections }: { value: string; onChangeText: (value: string) => void; onSend: () => void; onStop?: () => void; onAttach: () => void; onVoice?: () => void; onModelPress?: () => void; modelLabel?: string; /** Secondary, such as the thinking level; it gives way before the model name does. */ modelDetail?: string; modelStatus?: "available" | "degraded" | "outage" | "unknown"; disabled?: boolean; sending?: boolean; sendFeedback?: "idle" | "success"; running?: boolean; voiceActive?: boolean; voiceStarting?: boolean; hasAttachment?: boolean; placeholder?: string; anchorRef?: React.RefObject<View | null>; /** Set to the drawn button that opens a composer menu, so the menu grows out of it. */ menuSourceRef?: React.RefObject<View | null>; measurementRef?: React.RefObject<ComposerInputMeasurement>; attachmentMenuOpen?: boolean; modelMenuOpen?: boolean; showHarnessPicker?: boolean; harness?: HarnessKind; harnessMenuOpen?: boolean; onHarnessPress?: () => void; onSelectionChange?: (selection: { start: number; end: number }) => void; onFocusChange?: (focused: boolean) => void; onPasteImages?: (attachments: AttachmentDraft[]) => void; /** With system menus (iOS), the add button opens these itself instead of calling `onAttach`. */ attachmentActions?: readonly AnchoredMenuAction[]; /** With system menus (iOS), the harness chip opens these itself instead of calling `onHarnessPress`. */ harnessSections?: readonly NativeMenuSection[] }) {
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
  const attachButtonRef = useRef<View>(null);
  const harnessButtonRef = useRef<View>(null);
  const modelButtonRef = useRef<View>(null);
  // A menu takes the place of the button that opened it, so the button hides while its menu is open.
  const markMenuSource = (button: React.RefObject<View | null>) => { if (menuSourceRef) menuSourceRef.current = button.current; };
  const inputTrace = useRef({ at: 0, length: value.length, selectionAt: 0 });
  const keyboardVisible = keyboardTop !== null;
  useEffect(() => {
    if (Platform.OS === "ios") {
      // The iOS resume frame would size the composer against a zero-height window.
      const show = Keyboard.addListener("keyboardWillShow", (event) => { if (isUsableKeyboardFrame(event.endCoordinates)) setKeyboardTop(event.endCoordinates.screenY); });
      const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardTop(null));
      return () => { show.remove(); hide.remove(); };
    }
    // Android's own events wait for the keyboard to finish moving; these start with it. Their height is
    // the full IME inset of the edge-to-edge window, so the keyboard's top is measured from its bottom.
    const show = KeyboardEvents.addListener("keyboardWillShow", (event) => {
      const frame = { screenY: Dimensions.get("window").height - event.height, height: event.height };
      if (isUsableKeyboardFrame(frame)) setKeyboardTop(frame.screenY);
    });
    const hide = KeyboardEvents.addListener("keyboardWillHide", () => setKeyboardTop(null));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (!value) {
    if (autoExpandedFor !== null) setAutoExpandedFor(null);
    if (expanded) setExpanded(false);
  }
  const { blocked, canSend, canStop, queues, glyph } = getComposerActionState({ text: value, hasAttachment, disabled, sending, running, hasStopHandler: Boolean(onStop), sendFeedback });
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
    // Constant height: hosts lift it by the keyboard minus `useKeyboardCoveredInset`.
    <View style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
      {/* Glyphs pop only when they change, not when the composer first appears. */}
      <LayoutAnimationConfig skipEntering skipExiting>
      <View ref={anchorRef} collapsable={false} testID="chat-composer" className={`gap-2 overflow-hidden ${material === "liquid" ? "" : "shadow-float"}`} style={styles.composerSurface}>
        <GlassBackground radius={styles.composerSurface.borderRadius} solidClassName="bg-surface" />
        <View className="flex-row items-start">
          {/* Images, GIFs, and stickers pasted into the input attach to the message; text pastes stay text. */}
          <PasteImagesInput onPasteImages={(pasted) => onPasteImages?.(pasted)} style={styles.composerPasteTarget}>
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
              className="min-w-0 text-body text-fg"
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
          </PasteImagesInput>
          <View className="w-11 h-11">
            {layout.showExpandButton ? <Pressable
              testID="chat-composer-expand"
              accessibilityRole="button"
              accessibilityLabel={t(layout.expanded ? "ui.composer.collapse" : "ui.composer.expand")}
              accessibilityState={{ expanded: layout.expanded }}
              onPress={() => { traceAction("composer_expand", { expanded: !layout.expanded }); setExpanded(!layout.expanded); }}
              className="size-11 items-center justify-center rounded-full active:bg-surface-pressed"
            ><AppIcon name={layout.expanded ? "minimize" : "maximize"} size={18} tone="muted" /></Pressable> : null}
          </View>
        </View>
        <View className="h-11 flex-row items-center gap-2">
          {nativeMenus && attachmentActions ? <NativeMenuButton appearance="control" icon="plus" label={t("ui.composer.addAttachment")} actions={attachmentActions} disabled={blocked} testID="chat-composer-attach" /> : <Pressable ref={attachButtonRef} testID="chat-composer-attach" accessibilityRole="button" accessibilityLabel={t("ui.composer.addAttachment")} accessibilityState={{ expanded: attachmentMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { markMenuSource(attachButtonRef); traceAction("composer_attach", { menuOpen: attachmentMenuOpen }); Keyboard.dismiss(); onAttach(); }} className={`size-11 items-center justify-center rounded-full bg-surface-raised active:bg-surface-pressed ${attachmentMenuOpen ? "opacity-0" : blocked ? "opacity-45" : ""}`}><Animated.View key={attachmentMenuOpen ? "close" : "add"} entering={controlIconEntering} exiting={controlIconExiting}><AppIcon name={attachmentMenuOpen ? "x" : "plus"} size={22} tone="secondary" /></Animated.View></Pressable>}
          {showHarnessPicker && nativeMenus && harnessSections ? <NativeMenuButton appearance="chip" icon="check" title={labelForHarness(harness)} label={t("runtime.harness.current", { harness: labelForHarness(harness) })} sections={harnessSections} disabled={blocked} testID="chat-composer-harness" /> : showHarnessPicker ? <Pressable ref={harnessButtonRef} testID="chat-composer-harness" hitSlop={HARNESS_CHIP_SLOP} accessibilityRole="button" accessibilityLabel={t("runtime.harness.current", { harness: labelForHarness(harness) })} accessibilityState={{ expanded: harnessMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { markMenuSource(harnessButtonRef); traceAction("composer_harness", { harness }); Keyboard.dismiss(); onHarnessPress?.(); }} className={`h-10 min-w-0 max-w-26 shrink flex-row items-center gap-2 overflow-hidden rounded-sm px-2 bg-surface-raised active:bg-surface-pressed ${harnessMenuOpen ? "opacity-0" : blocked ? "opacity-50" : ""}`}>
            <HarnessIcon harness={harness} size={16} />
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="text-caption text-fg shrink">{labelForHarness(harness)}</Text>
            <AppIcon name="chevron-down" size={14} tone="muted" />
          </Pressable> : null}
          {onModelPress ? <Pressable ref={modelButtonRef} testID="chat-composer-model" accessibilityRole="button" accessibilityLabel={t("ui.composer.chooseModel", { model: modelDetail ? `${resolvedModelLabel}, ${modelDetail}` : resolvedModelLabel, status: modelStatusLabel })} accessibilityState={{ expanded: modelMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { markMenuSource(modelButtonRef); traceAction("composer_model", { model: resolvedModelLabel }); Keyboard.dismiss(); onModelPress(); }} className={`h-11 min-w-0 shrink flex-row items-center gap-2 overflow-hidden rounded-full px-3 bg-surface-raised active:bg-surface-pressed ${modelMenuOpen ? "opacity-0" : blocked ? "opacity-50" : ""}`} style={{ maxWidth: "58%" }}>
            <AppIcon name="zap" size={18} tone="secondary" />
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="text-body font-semibold text-fg shrink">{resolvedModelLabel}</Text>
            {modelDetail ? <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="min-w-0 text-subhead text-fg-muted" style={MODEL_DETAIL_SHRINK}>{modelDetail}</Text> : null}
            {modelStatus === "unknown" ? null : <View className={`size-1.5 rounded-full ${modelStatus === "available" ? "bg-success" : modelStatus === "degraded" ? "bg-warning" : "bg-danger"}`} />}
            <AppIcon name="chevron-down" size={14} tone="muted" />
          </Pressable> : null}
          <View className="flex-1 min-w-0" />
          {onVoice ? <Pressable accessibilityRole="button" accessibilityLabel={voiceActive ? t("ui.composer.voiceStop") : t("ui.composer.voiceStart")} accessibilityState={{ disabled: blocked || voiceStarting, selected: voiceActive }} disabled={blocked || voiceStarting} onPress={() => { traceAction("composer_voice", { active: voiceActive, starting: voiceStarting }); onVoice(); }} className={`size-11 items-center justify-center rounded-full ${voiceActive ? "bg-accent-soft active:bg-accent-border" : "bg-surface-raised active:bg-surface-pressed"} ${blocked ? "opacity-45" : ""}`}>{voiceStarting ? <Loader color={theme.colors.textMuted} /> : <AppIcon name="mic" size={22} tone={voiceActive ? "accent" : "secondary"} />}</Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={canStop ? t("ui.composer.stop") : queues ? t("ui.composer.queue") : t("ui.composer.send")} disabled={!canStop && !canSend} onPress={() => { traceAction(canStop ? "composer_stop" : "composer_send", { length: value.length, attachment: hasAttachment, disabled: blocked }); if (canStop) onStop?.(); else onSend(); }} className={`size-11 items-center justify-center rounded-full ${canStop ? "bg-fg active:bg-fg-secondary" : canSend ? "bg-accent active:bg-accent-pressed" : "bg-surface-raised"}`}>
            <Animated.View key={glyph} entering={controlIconEntering} exiting={controlIconExiting}>
              {glyph === "stop" ? <AppIcon name="stop" size={18} color={theme.colors.background} fill={theme.colors.background} /> : glyph === "sent" ? <AppIcon name="check" size={22} tone="onAccent" /> : glyph === "sending" ? <Loader color={theme.colors.accentText} /> : <AppIcon name="arrow-up" size={22} tone={canSend ? "onAccent" : "faint"} />}
            </Animated.View>
          </Pressable>
        </View>
      </View>
      </LayoutAnimationConfig>
    </View>
  );
}

export function AttachmentChip({ name, uri, mimeType, upload = null, onPreview, onRemove }: { name: string; uri?: string; mimeType?: string; upload?: AttachmentUploadState | null; onPreview?: () => void; onRemove?: () => void }) {
  const { t } = useTranslation();
  return <View className="max-w-full flex-row items-center gap-2 rounded-sm bg-accent-soft px-2 py-1" style={{ minHeight: 44, borderCurve: "continuous" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("ui.attachment.preview", { name })} disabled={!onPreview} onPress={onPreview} className="min-w-0 flex-1 flex-row items-center gap-2 self-stretch active:opacity-70">
      {uri && mimeType?.startsWith("image/") ? <Image source={{ uri }} resizeMode="cover" className="w-8 h-8 rounded-xs" /> : <AppIcon name="file-text" size={20} tone="accent" />}
      <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="text-caption text-fg flex-1 min-w-0">{name}</Text>
    </Pressable>
    {/* Ready is the quiet default; only work in progress or a failure the send will retry is shown. */}
    {upload?.status === "uploading" ? <Loader accessibilityLabel={t("ui.attachment.uploading", { name })} /> : null}
    {upload?.status === "failed" ? <View accessible accessibilityLabel={t("ui.attachment.uploadFailed", { name })}><AppIcon name="alert" size={16} tone="danger" /></View> : null}
    {/* A 32 × 44 box flush with the chip's end keeps the glyph where it was; the left slop completes the 44 pt target inside the chip. */}
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("common.remove")}: ${name}`} disabled={!onRemove} onPress={onRemove} hitSlop={REMOVE_SLOP} className="-my-1 -mr-2 h-11 w-8 items-center justify-center"><AppIcon name="x" size={16} tone="muted" /></Pressable>
  </View>;
}

const REMOVE_SLOP = { left: 12 } as const;
// The 40pt harness chip reaches 44 without growing the composer row.
const HARNESS_CHIP_SLOP = { top: 2, bottom: 2 } as const;

// Shared across every mounted banner (each tab keeps its own), so one outage is read once and a link
// flapping within the cooldown is not read again. A drop shorter than the delay is never read.
const OUTAGE_ANNOUNCE_DELAY_MS = 1500;
const OUTAGE_ANNOUNCE_COOLDOWN_MS = 30_000;
let lastOutageAnnouncement = -Infinity;

function useOutageAnnouncement(visible: boolean, label: string) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (Date.now() - lastOutageAnnouncement < OUTAGE_ANNOUNCE_COOLDOWN_MS) return;
      lastOutageAnnouncement = Date.now();
      AccessibilityInfo.announceForAccessibility(label);
    }, OUTAGE_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [label, visible]);
}

export function ConnectionBanner({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const label = t("ui.banner.unavailable");
  // Realtime recovery already waits out short drops; a reconnect right after that must not flash the banner.
  const shown = useDelayedStatus("connection", visible ? true : null, { showDelayMs: 0, minVisibleMs: 1_000 }) === true;
  useOutageAnnouncement(shown, label);
  if (!shown) return null;
  return <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fade.duration)} pointerEvents="none" className="absolute left-4 right-4 top-full mt-2 items-center">
    <View accessible accessibilityLabel={label} className="max-w-full flex-row items-center gap-2 rounded-full bg-surface-float px-3 py-1 shadow-float">
      <Mascot size={20} mood="worried" />
      <Text numberOfLines={1} className="text-caption text-fg">{label}</Text>
    </View>
  </Animated.View>;
}

export function DataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-md bg-danger-soft py-2 pl-3 pr-1" style={CONTINUOUS}>
    <Mascot size={32} mood="worried" />
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

const GLYPH_IN = { duration: motion.fade.duration, easing: Easing.bezier(...curves.easeOut) };
const GLYPH_OUT = { duration: motion.fadeOut.duration, easing: Easing.bezier(...curves.easeOut) };

/** A control whose glyph changes (send, stop, sent; add, close) on every send crossfades it in from just under size, without a bounce. */
function controlIconEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: glyphSwap.fromScale }] },
    animations: { opacity: withTiming(1, GLYPH_IN), transform: [{ scale: withTiming(1, GLYPH_IN) }] },
  };
}

/** The outgoing glyph keeps its frame and fades under the incoming one, so the swap reads as one change. */
function controlIconExiting() {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, GLYPH_OUT), transform: [{ scale: withTiming(glyphSwap.fromScale, GLYPH_OUT) }] },
  };
}

const styles = StyleSheet.create({
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  // Concentric with the 44 pt corner controls inset by the 8 pt padding: 8 + 44 / 2.
  composerSurface: { padding: 8, borderRadius: 30, borderCurve: "continuous" },
  composerText: { paddingHorizontal: 4, paddingVertical: COMPOSER_TEXT_PADDING / 2, textAlignVertical: "top", includeFontPadding: false },
  composerPasteTarget: { flex: 1, minWidth: 0 },
});
