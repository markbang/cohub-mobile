import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import Reanimated, { cancelAnimation, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { IconButton } from "@/src/ui";
import { setDialogOpen } from "@/src/data/interaction-trace";
import { springs } from "@/src/motion";

const COMPACT_BREAKPOINT = 720;
// UIScrollView's fast deceleration rate (0.99 per ms) projects a release to where it would coast: v * r / (1 - r) / 1000.
const RELEASE_PROJECTION_S = 0.099;

type AdaptiveSheetProps = {
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
  testID?: string;
};

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
  testID,
}: AdaptiveSheetProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = Math.min(width, height) < COMPACT_BREAKPOINT;
  const hiddenOffset = Math.min(height * 0.56, 520);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragContext = useSharedValue(0);
  const revealDistance = useSharedValue(hiddenOffset);
  const panelHeight = useSharedValue(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

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
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => setKeyboardHeight(event.endCoordinates.height));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [visible]);

  useEffect(() => {
    cancelAnimation(progress);
    cancelAnimation(dragY);
    dragY.set(0);
    dragContext.set(0);

    if (!visible) {
      progress.set(0);
      return;
    }

    const frame = requestAnimationFrame(() => {
      progress.set(withSpring(1, { ...springs.sheet, overshootClamping: true }));
    });

    return () => cancelAnimationFrame(frame);
  }, [dragContext, dragY, progress, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * 0.56,
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
  const availableHeight = Math.max(0, height - keyboardHeight);
  const maxHeight = compact
    ? Math.max(0, availableHeight - insets.top - 12)
    : Math.max(0, Math.min(availableHeight - 48, 760));
  const bottomPadding = Math.max(insets.bottom, theme.spacing.lg);
  // Wrap-content sheets only have maxHeight. A flex:1 scroller then collapses to 0 and hides the body.
  const bodyMaxHeight = Math.max(160, maxHeight - (compact ? 100 : 82) - (footer ? 130 : 20));
  const resolvedContentStyle = [
    CONTENT_PADDING,
    { paddingBottom: footer ? theme.spacing.lg : bottomPadding },
    contentStyle,
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={requestClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }} testID={testID}>
        <Reanimated.View className="absolute inset-0" style={[SCRIM, backdropStyle]}>
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
            accessibilityViewIsModal
            role="dialog"
            className={`min-h-0 w-full overflow-hidden bg-surface ${compact ? "rounded-t-lg" : "max-w-125 rounded-lg"}`}
            style={[
              { borderCurve: "continuous" },
              { maxHeight, height: compact && fullHeight ? maxHeight : undefined },
              compact ? compactPanelStyle : desktopPanelStyle,
            ]}
          >
            {compact ? (
              <GestureDetector gesture={pan}>
                <View testID={dismissible && testID ? `${testID}-drag-handle` : undefined} className="z-2 -mb-0.5 h-7.5 items-center justify-center">
                  {dismissible ? <View className="w-8 h-1 rounded-xs bg-border-strong" /> : null}
                </View>
              </GestureDetector>
            ) : null}
            <View className="min-h-14 flex-row items-center gap-3 border-border px-4 pb-3 pt-2" style={{ borderBottomWidth: StyleSheet.hairlineWidth }}>
              <View className="flex-1 min-w-0">
                <Text accessibilityRole="header" className="text-headline font-semibold text-fg">{title}</Text>
                {subtitle ? (
                  <Text className="text-body text-fg-secondary mt-1">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton
                name="x"
                label={t("ui.sheet.close", { title })}
                size={36}
                disabled={!dismissible}
                onPress={requestClose}
              />
            </View>
            {scrollable ? (
              <ScrollView
                style={fullHeight ? { flex: 1, minHeight: 0 } : { maxHeight: bodyMaxHeight }}
                contentContainerStyle={resolvedContentStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View collapsable={false} style={resolvedContentStyle}>{children}</View>
            )}
            {footer ? (
              <View
                className="border-border px-4 pt-3"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: bottomPadding }}
              >
                {footer}
              </View>
            ) : null}
          </Reanimated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const CONTENT_PADDING = { paddingHorizontal: 16, paddingTop: 12 } as const;
// design-system: the scrim dims whatever theme sits underneath, so it stays black; its opacity is animated.
const SCRIM = { backgroundColor: "#000000" } as const;
