import { memo, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardEvents } from "react-native-keyboard-controller";
import Reanimated, { cancelAnimation, Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { IconButton } from "@/src/ui";
import { SheetConfirmButton, type SheetConfirm } from "@/src/components/SheetConfirmButton";
import { CompactSettingsRows } from "@/src/components/SettingsRow";
import { GlassBackdrop } from "@/src/ui/Glass";
import { ToastViewport } from "@/src/components/Toast";
import { setDialogOpen } from "@/src/data/interaction-trace";
import { motion, scrim, springs } from "@/src/motion";

const COMPACT_BREAKPOINT = 720;
// UIScrollView's fast deceleration rate (0.99 per ms) projects a release to where it would coast: v * r / (1 - r) / 1000.
const RELEASE_PROJECTION_S = 0.099;
// A programmatic close has no release velocity to carry, so it eases out on the iOS sheet curve.
const CLOSE_TIMING = { duration: motion.settle.duration, easing: Easing.bezier(0.32, 0.72, 0, 1) };

export type AdaptiveSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
  dismissible?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  fullHeight?: boolean;
  /**
   * The sheet's one confirming action, as iOS 26 sheets carry it: a checkmark at the bar's trailing edge,
   * opposite the close. Destructive or two-way choices stay in `footer` with their words.
   */
  confirm?: SheetConfirm;
  /**
   * `fit` sizes a short sheet to its content, floating clear of the screen's edges as iOS 26's does; `large`
   * (the default) is a page sheet that fills the height below the status bar. Owners keep a `fit` sheet
   * mounted and drive it through `visible`.
   */
  detent?: "fit" | "large";
  testID?: string;
};

export type { SheetConfirm } from "@/src/components/SheetConfirmButton";

export function AdaptiveSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  scrollable = true,
  dismissible = true,
  contentStyle,
  fullHeight = false,
  confirm,
  detent = "large",
  testID,
}: AdaptiveSheetProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = Math.min(width, height) < COMPACT_BREAKPOINT;
  const floating = compact && detent === "fit";
  const page = fullHeight || (compact && detent === "large");
  // A page sheet slides in from fully below the screen; a short one only needs to clear the bottom edge.
  const hiddenOffset = compact && page ? height : Math.min(height * 0.56, 520);
  const scrimOpacity = theme.mode === "dark" ? scrim.dark : scrim.light;

  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragContext = useSharedValue(0);
  const revealDistance = useSharedValue(hiddenOffset);
  const panelHeight = useSharedValue(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The modal outlives `visible` until the close animation lands.
  const [presented, setPresented] = useState(visible);
  if (visible && !presented) {
    setPresented(true);
    // A sheet closed with the keyboard up never hears it hide; resetting here keeps the close animation at its height.
    setKeyboardHeight(0);
  }

  const requestClose = useCallback(() => {
    if (dismissible && visible) onClose();
  }, [dismissible, onClose, visible]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(compact && dismissible)
        .activeOffsetY([-8, 8])
        .failOffsetX([-12, 12])
        .onStart(() => {
          // Grabbing a sheet mid-flight must continue from where the eye last saw it.
          cancelAnimation(dragY);
          dragContext.set(dragY.get());
        })
        .onUpdate((event) => {
          dragY.set(Math.max(0, dragContext.get() + event.translationY));
        })
        .onEnd((event) => {
          // As UISheetPresentationController does: close once the projected release passes half the sheet.
          const projected = dragY.get() + event.velocityY * RELEASE_PROJECTION_S;
          if (projected > panelHeight.get() / 2) {
            dragY.set(
              withSpring(height, { ...springs.sheet, velocity: event.velocityY, overshootClamping: true }, (finished) => {
                if (finished) scheduleOnRN(requestClose);
              }),
            );
            return;
          }
          // A throw back up keeps its speed and lands with UIKit's slight overshoot; a release away from rest lands dead.
          dragY.set(event.velocityY < 0 ? withSpring(0, { ...springs.sheetThrown, velocity: event.velocityY }) : withSpring(0, springs.sheet));
        })
        .onFinalize((_event, success) => {
          if (!success) dragY.set(withSpring(0, springs.sheet));
        }),
    [compact, dismissible, dragContext, dragY, height, panelHeight, requestClose],
  );

  useEffect(() => {
    revealDistance.set(hiddenOffset);
  }, [hiddenOffset, revealDistance]);

  useEffect(() => {
    if (!visible) return;
    setDialogOpen(`sheet:${title}`, true);
    return () => setDialogOpen(`sheet:${title}`, false);
  }, [title, visible]);

  useEffect(() => {
    if (!visible) return;
    // Android's own events wait for the keyboard to finish moving; keyboard-controller's start with it, as iOS's do.
    const showSubscription = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardWillShow", (event) => setKeyboardHeight(event.endCoordinates.height))
      : KeyboardEvents.addListener("keyboardWillShow", (event) => setKeyboardHeight(event.height));
    const hideSubscription = (Platform.OS === "ios" ? Keyboard : KeyboardEvents).addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [visible]);

  useEffect(() => {
    cancelAnimation(progress);

    if (!visible) {
      // dragY stays put: a sheet dragged off screen remains there while the scrim fades.
      progress.set(withTiming(0, CLOSE_TIMING, (finished) => {
        if (finished) scheduleOnRN(setPresented, false);
      }));
      return;
    }

    cancelAnimation(dragY);
    dragY.set(0);
    dragContext.set(0);
    const frame = requestAnimationFrame(() => {
      progress.set(withSpring(1, { ...springs.sheetPresent, overshootClamping: true }));
    });

    return () => cancelAnimationFrame(frame);
  }, [dragContext, dragY, progress, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * scrimOpacity,
  }));
  const compactPanelStyle = useAnimatedStyle(() => ({
    // A sheet slides rather than fades; the brief fade only hides the first frame below the screen edge.
    opacity: interpolate(progress.get(), [0, 0.25], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: (1 - progress.get()) * revealDistance.get() + dragY.get() }],
  }));
  const desktopPanelStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 14 }, { scale: 0.98 + progress.get() * 0.02 }],
  }));
  // Owners that unmount the sheet instead of clearing `visible` get the same close as a native layout animation.
  // Closing through `visible` animates first and then unmounts, so it carries no exit of its own.
  const backdropExiting = useMemo<EntryExitAnimationFunction>(() => () => {
    "worklet";
    return {
      initialValues: { opacity: progress.get() * scrimOpacity },
      animations: { opacity: withTiming(0, CLOSE_TIMING) },
    };
  }, [progress, scrimOpacity]);
  const panelExiting = useMemo<EntryExitAnimationFunction>(() => () => {
    "worklet";
    const shown = progress.get();
    if (compact) {
      const drag = dragY.get();
      return {
        initialValues: { opacity: interpolate(shown, [0, 0.25], [0, 1], Extrapolation.CLAMP), transform: [{ translateY: (1 - shown) * revealDistance.get() + drag }] },
        animations: {
          opacity: withDelay(CLOSE_TIMING.duration * 0.6, withTiming(0, { duration: CLOSE_TIMING.duration * 0.4 })),
          transform: [{ translateY: withTiming(revealDistance.get() + drag, CLOSE_TIMING) }],
        },
      };
    }
    return {
      initialValues: { opacity: shown, transform: [{ translateY: (1 - shown) * 14 }, { scale: 0.98 + shown * 0.02 }] },
      animations: { opacity: withTiming(0, CLOSE_TIMING), transform: [{ translateY: withTiming(14, CLOSE_TIMING) }, { scale: withTiming(0.98, CLOSE_TIMING) }] },
    };
  }, [compact, dragY, progress, revealDistance]);
  const availableHeight = Math.max(0, height - keyboardHeight);
  // As iOS 26's: a page sheet starts right under the status bar; a floating one keeps its margin all round.
  const maxHeight = compact
    ? Math.max(0, availableHeight - insets.top - (floating ? FLOAT_MARGIN * 2 : 0))
    : Math.max(0, Math.min(availableHeight - 48, 760));
  // A floating sheet ends above the screen's edge but still runs its content clear of the home indicator.
  const bottomPadding = floating ? theme.spacing.lg + insets.bottom : Math.max(insets.bottom, theme.spacing.lg);
  // Wrap-content sheets only have maxHeight. A flex:1 scroller then collapses to 0 and hides the body.
  const bodyMaxHeight = Math.max(160, maxHeight - (compact ? 100 : 82) - (footer ? 130 : 20));
  const resolvedContentStyle = [
    CONTENT_PADDING,
    { paddingBottom: footer ? theme.spacing.lg : bottomPadding },
    contentStyle,
  ];

  return (
    <Modal
      visible={presented}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={requestClose}
    >
      {/* A sheet is opaque: glass on it has nothing of the screen beneath to blur. */}
      <GlassBackdrop target={null}>
      <GestureHandlerRootView style={{ flex: 1 }} testID={testID} pointerEvents={visible ? "auto" : "none"}>
        <Reanimated.View className="absolute inset-0" style={[SCRIM, backdropStyle]} exiting={visible ? backdropExiting : undefined}>
          <Pressable accessible={false} aria-hidden tabIndex={-1} className="absolute inset-0" onPress={requestClose} />
        </Reanimated.View>
        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className={`flex-1 ${compact ? "justify-end" : "items-center justify-center px-3 py-6"}`}
        >
          <Reanimated.View
            collapsable={false}
            onLayout={(event) => panelHeight.set(event.nativeEvent.layout.height)}
            exiting={visible ? panelExiting : undefined}
            accessibilityViewIsModal
            role="dialog"
            className={`min-h-0 overflow-hidden bg-surface ${compact ? "" : "w-full max-w-125 rounded-lg"}`}
            style={[
              { borderCurve: "continuous" },
              compact ? (floating ? FLOATING_PANEL : keyboardHeight > 0 ? PAGE_PANEL : [PAGE_PANEL, PAGE_PANEL_BOTTOM]) : null,
              { maxHeight, height: compact && page ? maxHeight : undefined },
              compact ? compactPanelStyle : desktopPanelStyle,
            ]}
          >
            {/* Owners often clear the data behind a sheet as they close it; keep showing what was open while it leaves. */}
            <Freeze frozen={!visible}>
            <SheetDrag gesture={compact ? pan : null}>
              <View>
                {/* iOS shows a grabber only on a sheet sized to its content; it sits over the header, 5 pt down. */}
                {floating && dismissible ? <View testID={testID ? `${testID}-drag-handle` : undefined} pointerEvents="none" className="absolute inset-x-0 z-2 items-center" style={GRABBER_SLOT}>
                  <View className="rounded-xs bg-border-strong" style={GRABBER} />
                </View> : null}
                {/* As in UIKit sheets: close leads, the title centers, the confirm (or an empty slot) trails. */}
                <View className={`min-h-14 flex-row items-center px-2 ${compact ? "pt-2" : "pb-2"}`}>
                  <IconButton
                    filled
                    name="x"
                    label={t("ui.sheet.close", { title })}
                    disabled={!dismissible}
                    onPress={requestClose}
                  />
                  <Text accessibilityRole="header" numberOfLines={1} className="min-w-0 flex-1 px-2 text-center text-headline font-semibold text-fg">{title}</Text>
                  <SheetConfirmButton confirm={confirm} />
                </View>
              </View>
            </SheetDrag>
            {subtitle ? <Text className="px-4 pb-2 text-center text-subhead text-fg-secondary">{subtitle}</Text> : null}
            {scrollable ? (
              <ScrollView
                style={page ? { flex: 1, minHeight: 0 } : { maxHeight: bodyMaxHeight }}
                contentContainerStyle={resolvedContentStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <CompactSettingsRows.Provider value={floating}>{children}</CompactSettingsRows.Provider>
              </ScrollView>
            ) : (
              <View collapsable={false} style={resolvedContentStyle}><CompactSettingsRows.Provider value={floating}>{children}</CompactSettingsRows.Provider></View>
            )}
            {footer ? (
              <View
                className="border-border px-4 pt-3"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: bottomPadding }}
              >
                {footer}
              </View>
            ) : null}
            </Freeze>
          </Reanimated.View>
        </KeyboardAvoidingView>
        <ToastViewport />
      </GestureHandlerRootView>
      </GlassBackdrop>
    </Modal>
  );
}

/** Compact sheets drag from their top: the grabber and the header. */
function SheetDrag({ gesture, children }: { gesture: ReturnType<typeof Gesture.Pan> | null; children: ReactElement }) {
  return gesture ? <GestureDetector gesture={gesture}>{children}</GestureDetector> : children;
}

const Freeze = memo(function Freeze({ children }: { frozen: boolean; children: ReactNode }) {
  return children;
}, (_previous, next) => next.frozen);

const CONTENT_PADDING = { paddingHorizontal: 16, paddingTop: 12 } as const;
// iOS 27's sheets on a 402 pt iPhone, measured from the UI Snapshots captures: a fitted sheet floats 8 pt in
// with 36 pt corners; a page sheet starts right under the status bar with 38 pt top corners; the grabber is
// 57 × 4 pt, 6 pt down.
const FLOAT_MARGIN = 8;
const FLOATING_PANEL = { marginHorizontal: FLOAT_MARGIN, marginBottom: FLOAT_MARGIN, borderRadius: 36 } as const;
const PAGE_PANEL = { width: "100%", borderTopLeftRadius: 38, borderTopRightRadius: 38 } as const;
// Its bottom follows the screen's corners (62 pt on the reference iPhone); above the keyboard it stays square.
const PAGE_PANEL_BOTTOM = { borderBottomLeftRadius: 62, borderBottomRightRadius: 62 } as const;
const GRABBER = { width: 57, height: 4 } as const;
const GRABBER_SLOT = { top: 6 } as const;
// design-system: the scrim dims whatever theme sits underneath, so it stays black; its opacity is animated.
const SCRIM = { backgroundColor: "#000000" } as const;
