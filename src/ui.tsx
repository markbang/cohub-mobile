import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
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
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { icons, type IconName } from "@/src/icons";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { getComposerActionState } from "@/src/data/composer-state";
import { COMPOSER_TEXT_PADDING, estimateComposerContentHeight, getComposerLayout, shouldAutoExpandComposer } from "@/src/ui/composer-layout";
import { isUsableKeyboardFrame, keyboardOverlap } from "@/src/ui/keyboard-frame";
import { useTranslation } from "@/src/i18n";
import { edgeChrome, useAppTheme, typography } from "@/src/theme";
import { LIST_AVATAR_SIZE, type ColorKey } from "@/src/design/tokens";
import { motion } from "@/src/motion";
import type { ActivityItem } from "@/src/data/types";
import { initials } from "@/src/utils";

export { ExpandableSearchBar } from "@/src/ui/ExpandableSearchBar";

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
      <Rect width={192} height={192} rx={32} fill="#ff4500" />
      <G transform="translate(0,192) scale(0.1,-0.1)" fill="#ffffff">
        <Path d="M853 1314 c-63 -23 -128 -86 -164 -160 -27 -54 -33 -79 -37 -157 -10 -196 63 -332 205 -383 53 -18 160 -17 219 3 92 31 184 151 184 240 0 21 -5 23 -45 23 -43 0 -45 -1 -55 -38 -13 -52 -48 -101 -89 -129 -27 -18 -48 -23 -98 -23 -77 0 -120 16 -156 60 -50 59 -61 96 -61 210 -1 89 3 113 22 155 28 61 47 82 95 107 48 24 152 26 195 4 36 -19 80 -69 88 -102 5 -21 12 -24 55 -24 27 0 49 4 49 8 0 5 -7 29 -16 55 -18 54 -74 115 -129 142 -54 25 -203 31 -262 9z" />
      </G>
    </Svg>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return <CohubLogo size={size} />;
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
      {online ? <View className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-success" /> : null}
    </View>
  );
}

export function IconButton({ name, onPress, label, testID, size = 44, tone = "default", disabled = false, onPressIn, onPressOut, onTouchCancel }: { name: IconName; onPress: (event: GestureResponderEvent) => void; label: string; testID?: string; size?: number; tone?: "default" | "accent" | "danger"; disabled?: boolean; onPressIn?: (event: GestureResponderEvent) => void; onPressOut?: (event: GestureResponderEvent) => void; onTouchCancel?: (event: GestureResponderEvent) => void }) {
  // The visual circle can be smaller than 44, but the touch target never is.
  const target = Math.max(44, size);
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
      onPress={onPress}
      className={`items-center justify-center rounded-full disabled:opacity-45 ${tone === "accent" ? "active:bg-accent-soft" : tone === "danger" ? "active:bg-danger-soft" : "active:bg-surface-pressed"}`}
      style={{ width: target, height: target }}
    >
      <AppIcon name={name} size={Math.round(Math.min(size, 44) * 0.5)} tone={tone === "accent" ? "accent" : tone === "danger" ? "danger" : "secondary"} />
    </Pressable>
  );
}

export function Screen({ children, scroll = false, refreshing = false, onRefresh, contentStyle, keyboard = false, scrollRef, edgeToEdge = false }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; contentStyle?: ViewStyle; keyboard?: boolean; scrollRef?: React.RefObject<ScrollView | null>; edgeToEdge?: boolean }) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-background"
      contentContainerStyle={[{ paddingBottom: insets.bottom + 28 }, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} /> : undefined}
      keyboardShouldPersistTaps="handled"
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
};

export function TopBar({ title, subtitle, onBack, backLabel, leading, actions, children, transparent = false, titleRef, onTitleLongPress, titleLongPressLabel }: TopBarProps) {
  const { t } = useTranslation();
  const titleContent = children ?? <>
    <Text accessibilityRole={onTitleLongPress ? undefined : "header"} numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
    {subtitle ? <Text numberOfLines={1} className="text-caption text-fg-muted">{subtitle}</Text> : null}
  </>;
  return (
    <View testID="app-top-bar" className={`shrink-0 flex-row items-center gap-1 px-2 py-1.5 ${transparent ? "" : "bg-background"}`} style={{ minHeight: edgeChrome.headerMinHeight }}>
      {onBack ? <IconButton
        name="arrow-left"
        label={backLabel ?? t("ui.detail.back")}
        onPress={() => { recordDebugEvent("navigation.back.dispatch"); onBack(); }}
        onPressIn={() => recordDebugEvent("navigation.back.press_in")}
        onPressOut={() => recordDebugEvent("navigation.back.press_out")}
        onTouchCancel={() => recordDebugEvent("navigation.back.touch_cancel")}
      /> : leading ? <View className="size-11 items-center justify-center">{leading}</View> : null}
      <View ref={titleRef} collapsable={false} className="min-w-0 flex-1 justify-center px-1">
        {onTitleLongPress ? <Pressable accessibilityRole="header" accessibilityLabel={titleLongPressLabel ?? title} onLongPress={onTitleLongPress} className="min-w-0 flex-1 justify-center rounded-sm active:bg-surface-pressed" style={CONTINUOUS}>{titleContent}</Pressable> : titleContent}
      </View>
      {actions ? <View className="shrink-0 flex-row items-center">{actions}</View> : null}
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
      <Text accessibilityRole="header" className="flex-1 text-caption font-semibold text-fg-muted">{title}</Text>
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
      <View className="size-14 items-center justify-center rounded-full bg-surface-raised">
        <AppIcon name={icon} size={24} tone="muted" />
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
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} className={`min-h-12 flex-row items-center justify-center gap-2 rounded-sm px-4.5 disabled:opacity-55 ${classes.box} ${className}`} style={[CONTINUOUS, style]}>
      {loading ? <ActivityIndicator color={iconColor ?? theme.colors[ICON_TONES[classes.tone]]} size="small" /> : icon ? <AppIcon name={icon} size={18} tone={classes.tone} color={iconColor} /> : null}
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

/** Skeleton in the exact shape of `ListRow`, so content replaces it without a jump. */
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

export function LoadingRows({ count = 5 }: { count?: number }) {
  return <View accessibilityLabel="Loading" className="px-4">{Array.from({ length: count }).map((_, index) => <View key={index} className="min-h-18 flex-row items-center gap-3.5 py-3">
    <View className="bg-surface-raised" style={{ width: LIST_AVATAR_SIZE, height: LIST_AVATAR_SIZE, borderRadius: LIST_AVATAR_SIZE * 0.3, borderCurve: "continuous" }} />
    <View className="flex-1 gap-2">
      <View className="h-3 rounded-full bg-surface-raised" style={{ width: `${58 + (index % 3) * 10}%` }} />
      <View className="h-2.5 rounded-full bg-surface-raised" style={{ width: `${38 + (index % 2) * 15}%` }} />
    </View>
  </View>)}</View>;
}

export type ComposerInputMeasurement = { input: TextInput | null; scrollY: number };

export function ComposerInput({ value, onChangeText, onSend, onStop, onAttach, onVoice, onModelPress, modelLabel, modelStatus = "unknown", disabled = false, sending = false, sendFeedback = "idle", running = false, voiceActive = false, voiceStarting = false, hasAttachment = false, placeholder, anchorRef, measurementRef, attachmentMenuOpen = false, modelMenuOpen = false, showHarnessPicker = false, harnessLabel, harnessMenuOpen = false, onHarnessPress, onSelectionChange, onFocusChange }: { value: string; onChangeText: (value: string) => void; onSend: () => void; onStop?: () => void; onAttach: () => void; onVoice?: () => void; onModelPress?: () => void; modelLabel?: string; modelStatus?: "available" | "degraded" | "outage" | "unknown"; disabled?: boolean; sending?: boolean; sendFeedback?: "idle" | "success"; running?: boolean; voiceActive?: boolean; voiceStarting?: boolean; hasAttachment?: boolean; placeholder?: string; anchorRef?: React.RefObject<View | null>; measurementRef?: React.RefObject<ComposerInputMeasurement>; attachmentMenuOpen?: boolean; modelMenuOpen?: boolean; showHarnessPicker?: boolean; harnessLabel?: string; harnessMenuOpen?: boolean; onHarnessPress?: () => void; onSelectionChange?: (selection: { start: number; end: number }) => void; onFocusChange?: (focused: boolean) => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
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
      <View ref={anchorRef} collapsable={false} testID="chat-composer" style={[styles.composer, { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.borderStrong : theme.colors.border }]}>
        <View className="flex-row items-start">
          <TextInput
            ref={(input) => { inputRef.current = input; if (measurementRef) measurementRef.current.input = input; }}
            testID="chat-composer-input"
            accessibilityLabel={t("ui.composer.placeholder")}
            value={value}
            onChangeText={(next) => { setLastUserText(next); onChangeText(next); }}
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
            style={[typography.body, styles.composerText, { color: theme.colors.text, height: layout.height }]}
            onSelectionChange={onSelectionChange ? (event) => onSelectionChange(event.nativeEvent.selection) : undefined}
            onFocus={() => { setFocused(true); onFocusChange?.(true); }}
            onBlur={() => { setFocused(false); onFocusChange?.(false); }}
            submitBehavior="newline"
          />
          <View className="w-11 h-11">
            {layout.showExpandButton ? <Pressable
              testID="chat-composer-expand"
              accessibilityRole="button"
              accessibilityLabel={t(layout.expanded ? "ui.composer.collapse" : "ui.composer.expand")}
              accessibilityState={{ expanded: layout.expanded }}
              onPress={() => setExpanded(!layout.expanded)}
              style={({ pressed }) => [styles.composerExpandButton, { backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" }]}
            ><AppIcon name={layout.expanded ? "minimize" : "maximize"} size={17} color={theme.colors.textMuted} /></Pressable> : null}
          </View>
        </View>
        <View className="h-11 flex-row items-center gap-1.5">
          <Pressable testID="chat-composer-attach" accessibilityRole="button" accessibilityLabel={t("ui.composer.addAttachment")} accessibilityState={{ expanded: attachmentMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { Keyboard.dismiss(); onAttach(); }} style={({ pressed }) => [styles.composerCircleButton, { backgroundColor: pressed || attachmentMenuOpen ? theme.colors.surfacePressed : theme.colors.surfaceRaised, opacity: blocked ? 0.45 : 1 }]}><AppIcon name={attachmentMenuOpen ? "x" : "plus"} size={22} color={theme.colors.textSecondary} /></Pressable>
          {showHarnessPicker ? <Pressable testID="chat-composer-harness" accessibilityRole="button" accessibilityLabel={t("runtime.harness.current", { harness: harnessLabel ?? "Cohub" })} accessibilityState={{ expanded: harnessMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { Keyboard.dismiss(); onHarnessPress?.(); }} style={({ pressed }) => [styles.composerHarness, { backgroundColor: pressed || harnessMenuOpen ? theme.colors.surfacePressed : theme.colors.surfaceRaised, opacity: blocked ? 0.5 : 1 }]}>
            <AppIcon name={harnessLabel === "Cohub" ? "cloud" : "monitor"} size={16} color={theme.colors.textSecondary} />
            <Text numberOfLines={1} className="text-caption text-fg shrink">{harnessLabel}</Text>
            <AppIcon name="chevron-down" size={13} color={theme.colors.textMuted} />
          </Pressable> : null}
          {onModelPress ? <Pressable testID="chat-composer-model" accessibilityRole="button" accessibilityLabel={t("ui.composer.chooseModel", { model: resolvedModelLabel, status: modelStatusLabel })} accessibilityState={{ expanded: modelMenuOpen, disabled: blocked }} disabled={blocked} onPress={() => { Keyboard.dismiss(); onModelPress(); }} style={({ pressed }) => [styles.composerModel, { backgroundColor: pressed || modelMenuOpen ? theme.colors.surfacePressed : theme.colors.surfaceRaised, opacity: blocked ? 0.5 : 1 }]}>
            <AppIcon name="zap" size={18} color={theme.colors.textSecondary} />
            <Text numberOfLines={1} className="text-body font-semibold text-fg shrink">{resolvedModelLabel}</Text>
            {modelStatus === "unknown" ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: modelStatus === "available" ? theme.colors.success : modelStatus === "degraded" ? theme.colors.warning : theme.colors.danger }} />}
            <AppIcon name="chevron-down" size={14} color={theme.colors.textMuted} />
          </Pressable> : null}
          <View className="flex-1 min-w-0" />
          {onVoice ? <Pressable accessibilityRole="button" accessibilityLabel={voiceActive ? t("ui.composer.voiceStop") : t("ui.composer.voiceStart")} accessibilityState={{ disabled: blocked || voiceStarting, selected: voiceActive }} disabled={blocked || voiceStarting} onPress={onVoice} style={({ pressed }) => [styles.composerCircleButton, { backgroundColor: voiceActive ? (pressed ? theme.colors.accentBorder : theme.colors.accentSoft) : pressed ? theme.colors.surfacePressed : theme.colors.surfaceRaised, opacity: blocked ? 0.45 : 1 }]}>{voiceStarting ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <AppIcon name="mic" size={21} color={voiceActive ? theme.colors.accent : theme.colors.textSecondary} />}</Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={canStop ? t("ui.composer.stop") : t("ui.composer.send")} disabled={!canStop && !canSend} onPress={() => { if (canStop) onStop?.(); else onSend(); }} style={({ pressed }) => [styles.sendButton, { backgroundColor: canStop ? (pressed ? theme.colors.textSecondary : theme.colors.text) : canSend ? (pressed ? theme.colors.accentPressed : theme.colors.accent) : theme.colors.surfaceRaised }]}>
            {canStop ? <AppIcon name="stop" size={17} color={theme.colors.background} fill={theme.colors.background} /> : sendFeedback === "success" ? <AppIcon name="check" size={22} color={theme.colors.accentText} /> : sending ? <ActivityIndicator size="small" color={theme.colors.accentText} /> : <AppIcon name="arrow-up" size={22} color={canSend ? theme.colors.accentText : theme.colors.textFaint} />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function AttachmentChip({ name, uri, mimeType, onRemove }: { name: string; uri?: string; mimeType?: string; onRemove?: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  return <View style={[styles.attachmentChip, { minHeight: 44, backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentBorder }]}>
    {uri && mimeType?.startsWith("image/") ? <Image source={{ uri }} resizeMode="cover" className="w-8 h-8 rounded-xs" /> : <AppIcon name="file-text" size={20} color={theme.colors.accent} />}
    <Text numberOfLines={1} className="text-caption text-fg flex-1 min-w-0">{name}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("common.remove")}: ${name}`} disabled={!onRemove} onPress={onRemove} hitSlop={8}><AppIcon name="x" size={15} color={theme.colors.textMuted} /></Pressable>
  </View>;
}

export function ConnectionBanner({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fade.duration)} pointerEvents="none" className="absolute left-4 right-4 top-full mt-2 items-center">
    <View accessible accessibilityRole="alert" className="max-w-full flex-row items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1.5 shadow-float">
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
      <Text selectable numberOfLines={3} className="text-caption text-danger">{message}</Text>
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

const styles = StyleSheet.create({
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  composer: { paddingHorizontal: 8, paddingVertical: 8, gap: 8, borderRadius: 18, borderCurve: "continuous", borderWidth: 1, overflow: "hidden" },
  composerText: { flex: 1, minWidth: 0, paddingHorizontal: 5, paddingVertical: COMPOSER_TEXT_PADDING / 2, textAlignVertical: "top", includeFontPadding: false },
  composerExpandButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  composerHarness: { height: 40, maxWidth: 104, flexShrink: 1, minWidth: 0, paddingHorizontal: 8, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 5, overflow: "hidden" },
  composerModel: { height: 44, maxWidth: "58%", flexShrink: 1, minWidth: 0, paddingHorizontal: 10, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden" },
  composerCircleButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  attachmentChip: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7, maxWidth: "100%" },
});
