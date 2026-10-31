import { Link, usePreventZoomTransitionDismissal, useRouter } from "expo-router";
// Internal to expo-router: whether this screen was opened by an Apple zoom transition, which owns its own drag-to-dismiss.
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Platform, Pressable, Text, View, useWindowDimensions, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDecay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { clearImageViewerPayload, getImageViewerPayload, imageViewerPanBounds, imageViewerReleasePage, imageViewerShouldDismiss } from "@/src/data/image-viewer";
import { useTranslation } from "@/src/i18n";
import { motion, springs } from "@/src/motion";
import { AppIcon, Loader } from "@/src/ui";

const MAX_SCALE = 4;
const MIN_DOUBLE_TAP_SCALE = 2;
const EDGE_RESISTANCE = 0.3;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SETTLE = { ...springs.sheet, overshootClamping: true };

type Mode = "idle" | "pan" | "page" | "dismiss" | "none" | "pinch";
type Size = { width: number; height: number };

function resist(value: number, limit: number) {
  "worklet";
  if (value > limit) return limit + (value - limit) * EDGE_RESISTANCE;
  if (value < -limit) return -limit + (value + limit) * EDGE_RESISTANCE;
  return value;
}

function clamp(value: number, limit: number) {
  "worklet";
  return Math.min(Math.max(value, -limit), limit);
}

/** Largest rect with the image's aspect ratio inside the box; the box itself until the image reports its size. */
function fitInside(box: Size, natural: Size | undefined): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0) return box;
  const ratio = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/**
 * Full-screen image viewer. Opened as a Link with an Apple zoom source, so on iOS 18+
 * the tapped thumbnail grows into this screen and can be dismissed interactively.
 */
export default function ImageViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const [payload] = useState(() => getImageViewerPayload());
  const count = payload?.uris.length ?? 0;
  const [index, setIndex] = useState(() => Math.min(Math.max(payload?.index ?? 0, 0), Math.max(count - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const zoomTransition = payload?.zoom === true && Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 18;

  // One-shot payload: a deep link or restored state must not reopen the last gallery.
  useEffect(() => clearImageViewerPayload, []);
  // The zoom transition's own drag would fight panning a zoomed image.
  usePreventZoomTransitionDismissal(zoomed ? { unstable_dismissalBoundsRect: { maxX: 0, maxY: 0 } } : undefined);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // Explicit dimensions: the native Link.AppleZoomTarget wrapper is content-sized, so
  // percentage-sized children would collapse inside it.
  const box = useMemo(() => ({ width: width - 24, height: height * 0.82 }), [height, width]);
  const natural = sizes[index];
  const fit = useMemo(() => fitInside(box, natural), [box, natural]);

  // Page position in pages, not points, so a rotation or resize keeps the current page.
  const page = useSharedValue(index);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const mode = useSharedValue<Mode>("idle");
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });
  const fitSize = useSharedValue(fit);
  useEffect(() => { fitSize.set(fit); }, [fit, fitSize]);
  // A rotated or resized window invalidates the pan bounds; the page itself is kept by `page`.
  const windowKey = `${width}x${height}`;
  const [zoomedWindow, setZoomedWindow] = useState(windowKey);
  if (zoomedWindow !== windowKey) {
    setZoomedWindow(windowKey);
    setZoomed(false);
  }
  useEffect(() => {
    scale.set(1);
    tx.set(0);
    ty.set(0);
  }, [height, scale, tx, ty, width]);

  const showPage = useCallback((next: number) => {
    setIndex(next);
    page.set(withSpring(next, SETTLE));
  }, [page]);

  const gesture = useMemo(() => {
    const resetZoom = (velocity = 0) => {
      "worklet";
      scale.set(withSpring(1, { ...SETTLE, velocity }));
      tx.set(withSpring(0, SETTLE));
      ty.set(withSpring(0, SETTLE));
      scheduleOnRN(setZoomed, false);
    };

    const pinch = Gesture.Pinch()
      .onStart((event) => {
        if (mode.get() === "page" || mode.get() === "dismiss") return;
        mode.set("pinch");
        start.set({ scale: scale.get(), x: tx.get(), y: ty.get(), focalX: event.focalX - width / 2, focalY: event.focalY - height / 2 });
      })
      .onUpdate((event) => {
        if (mode.get() !== "pinch") return;
        const from = start.get();
        const raw = from.scale * event.scale;
        const next = raw > MAX_SCALE ? MAX_SCALE + (raw - MAX_SCALE) * EDGE_RESISTANCE : raw < 1 ? 1 - (1 - raw) * 0.5 : raw;
        const ratio = next / from.scale;
        // Keep the point under the fingers fixed while they also move.
        const focalX = event.focalX - width / 2;
        const focalY = event.focalY - height / 2;
        scale.set(next);
        tx.set(focalX - (from.focalX - from.x) * ratio);
        ty.set(focalY - (from.focalY - from.y) * ratio);
      })
      .onEnd((event) => {
        if (mode.get() !== "pinch") return;
        mode.set("idle");
        if (scale.get() <= 1) { resetZoom(event.velocity); return; }
        const target = Math.min(scale.get(), MAX_SCALE);
        const fitNow = fitSize.get();
        const bounds = imageViewerPanBounds(fitNow.width, fitNow.height, target, width, height);
        scale.set(withSpring(target, SETTLE));
        tx.set(withSpring(clamp(tx.get(), bounds.x), SETTLE));
        ty.set(withSpring(clamp(ty.get(), bounds.y), SETTLE));
        scheduleOnRN(setZoomed, true);
      });

    const pan = Gesture.Pan().maxPointers(1);
    // Under a zoom transition a vertical drag at rest belongs to the native dismissal, so this pan fails on it.
    if (zoomTransition && !zoomed) pan.activeOffsetX([-10, 10]).failOffsetY([-10, 10]);
    else pan.minDistance(8);
    pan
      .onStart(() => {
        if (mode.get() === "pinch") return;
        mode.set(scale.get() > 1 ? "pan" : "idle");
        start.set({ scale: scale.get(), x: tx.get(), y: ty.get(), focalX: 0, focalY: 0 });
      })
      .onUpdate((event) => {
        if (mode.get() === "idle") {
          // The first movement picks the axis: sideways pages, vertical dismisses.
          if (Math.abs(event.translationX) > Math.abs(event.translationY)) mode.set(count > 1 ? "page" : "none");
          else mode.set(zoomTransition ? "none" : "dismiss");
        }
        const current = mode.get();
        if (current === "pan") {
          const fitNow = fitSize.get();
          const bounds = imageViewerPanBounds(fitNow.width, fitNow.height, scale.get(), width, height);
          const from = start.get();
          tx.set(resist(from.x + event.translationX, bounds.x));
          ty.set(resist(from.y + event.translationY, bounds.y));
        } else if (current === "page") {
          const raw = index - event.translationX / width;
          page.set(raw < 0 ? raw * EDGE_RESISTANCE : raw > count - 1 ? count - 1 + (raw - count + 1) * EDGE_RESISTANCE : raw);
        } else if (current === "dismiss") {
          dragX.set(event.translationX);
          dragY.set(event.translationY);
        }
      })
      .onEnd((event) => {
        const current = mode.get();
        if (current === "pinch") return;
        mode.set("idle");
        if (current === "pan") {
          const fitNow = fitSize.get();
          const bounds = imageViewerPanBounds(fitNow.width, fitNow.height, scale.get(), width, height);
          const coast = (value: SharedValue<number>, velocity: number, limit: number) => {
            if (Math.abs(value.get()) > limit) value.set(withSpring(clamp(value.get(), limit), { ...SETTLE, velocity }));
            else value.set(withDecay({ velocity, clamp: [-limit, limit] }));
          };
          coast(tx, event.velocityX, bounds.x);
          coast(ty, event.velocityY, bounds.y);
        } else if (current === "page") {
          const next = imageViewerReleasePage(index, event.translationX, event.velocityX, width, count);
          page.set(withSpring(next, { ...SETTLE, velocity: -event.velocityX / width }));
          if (next !== index) scheduleOnRN(setIndex, next);
        } else if (current === "dismiss") {
          if (imageViewerShouldDismiss(event.translationY, event.velocityY)) {
            const direction = event.translationY === 0 ? Math.sign(event.velocityY) || 1 : Math.sign(event.translationY);
            dragY.set(withTiming(direction * height, { duration: motion.settle.duration, easing: EASE_OUT }, (finished) => {
              if (finished) scheduleOnRN(close);
            }));
          } else {
            dragX.set(withSpring(0, { ...springs.sheetThrown, velocity: event.velocityX }));
            dragY.set(withSpring(0, { ...springs.sheetThrown, velocity: event.velocityY }));
          }
        }
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(250)
      .onEnd((event) => {
        if (scale.get() > 1) { resetZoom(); return; }
        const fitNow = fitSize.get();
        const target = Math.min(MAX_SCALE, Math.max(MIN_DOUBLE_TAP_SCALE, width / fitNow.width, height / fitNow.height));
        const bounds = imageViewerPanBounds(fitNow.width, fitNow.height, target, width, height);
        scale.set(withSpring(target, SETTLE));
        // Zoom toward the tapped point.
        tx.set(withSpring(clamp(-(event.x - width / 2) * (target - 1), bounds.x), SETTLE));
        ty.set(withSpring(clamp(-(event.y - height / 2) * (target - 1), bounds.y), SETTLE));
        scheduleOnRN(setZoomed, true);
      });

    return Gesture.Simultaneous(pinch, pan, doubleTap);
  }, [close, count, dragX, dragY, fitSize, height, index, mode, page, scale, start, tx, ty, width, zoomTransition, zoomed]);

  const dismissProgress = (y: number) => {
    "worklet";
    return Math.min(Math.abs(y) / (height * 0.4), 1);
  };
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - dismissProgress(dragY.get()) }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: interpolate(dismissProgress(dragY.get()), [0, 0.3], [1, 0], "clamp") }));
  const pagerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -page.get() * width }] }));
  const currentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.get() + dragX.get() },
      { translateY: ty.get() + dragY.get() },
      { scale: scale.get() * (1 - dismissProgress(dragY.get()) * 0.25) },
    ],
  }));

  const closeButtonStyle = {
    position: "absolute" as const,
    zIndex: 2,
    top: insets.top + 8,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: VIEWER.control,
  };
  const closeButton = (
    <Pressable accessibilityRole="button" accessibilityLabel={t("imageViewer.close")} hitSlop={6} onPress={close} style={closeButtonStyle}>
      <AppIcon name="x" size={22} color={VIEWER.foreground} />
    </Pressable>
  );

  if (!payload || count === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: VIEWER.background }} onAccessibilityEscape={close}>
        <StatusBar style="light" />
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <AppIcon name="images" size={32} color={VIEWER.muted} />
          <Text className="text-center text-subhead" style={{ color: VIEWER.foreground }}>{t("imageViewer.unavailable")}</Text>
        </View>
        {closeButton}
      </View>
    );
  }

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const next = event.nativeEvent.actionName === "increment" ? index + 1 : event.nativeEvent.actionName === "decrement" ? index - 1 : index;
    if (next !== index && next >= 0 && next < count) showPage(next);
  };
  const pageLabel = t("imageViewer.page", { current: index + 1, total: count });

  return (
    <View style={{ flex: 1 }} onAccessibilityEscape={close}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: VIEWER.background }, backdropStyle]} />
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[{ width, height }, pagerStyle]}>
            {payload.uris.map((uri, itemIndex) => {
              // Only the visible page and its neighbours stay mounted; a long gallery would otherwise hold every image.
              if (Math.abs(itemIndex - index) > 1) return null;
              const current = itemIndex === index;
              return (
                <View
                  key={`${uri}-${itemIndex}`}
                  accessibilityElementsHidden={!current}
                  importantForAccessibility={current ? "auto" : "no-hide-descendants"}
                  style={{ position: "absolute", top: 0, left: itemIndex * width, width, height, alignItems: "center", justifyContent: "center" }}
                >
                  <Animated.View style={current ? currentStyle : undefined}>
                    <ViewerImage
                      uri={uri}
                      box={box}
                      zoomTarget={itemIndex === payload.index && Platform.OS === "ios"}
                      label={pageLabel}
                      pageable={count > 1}
                      onAccessibilityAction={onAccessibilityAction}
                      onSize={(size) => setSizes((previous) => previous[itemIndex] ? previous : { ...previous, [itemIndex]: size })}
                    />
                  </Animated.View>
                </View>
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>
      <Animated.View style={[{ position: "absolute", top: 0, right: 0, left: 0, zIndex: 2 }, chromeStyle]} pointerEvents="box-none">
        {closeButton}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: "absolute", top: insets.top + 20, left: 16 }}>
          <Text className="text-caption tabular-nums" style={{ color: VIEWER.foreground }}>{index + 1} / {count}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

function ViewerImage({ uri, box, zoomTarget, label, pageable, onAccessibilityAction, onSize }: { uri: string; box: Size; zoomTarget: boolean; label: string; pageable: boolean; onAccessibilityAction: (event: AccessibilityActionEvent) => void; onSize: (size: Size) => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const image = (
    <Image
      key={attempt}
      source={{ uri }}
      resizeMode="contain"
      style={box}
      onLoad={(event) => {
        setStatus("loaded");
        const { width, height } = event.nativeEvent.source;
        if (width > 0 && height > 0) onSize({ width, height });
      }}
      onError={() => setStatus("error")}
    />
  );
  return (
    <View style={box}>
      {/* Adjustable so VoiceOver and TalkBack page with a vertical swipe, which the pager's own pan cannot get. */}
      <View
        accessible
        accessibilityRole={pageable ? "adjustable" : "image"}
        accessibilityLabel={label}
        accessibilityActions={pageable ? [{ name: "increment" }, { name: "decrement" }] : undefined}
        onAccessibilityAction={onAccessibilityAction}
      >
        {zoomTarget ? <Link.AppleZoomTarget>{image}</Link.AppleZoomTarget> : image}
      </View>
      {status === "loading" ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
          <Loader color={VIEWER.foreground} accessibilityLabel={t("imageViewer.loading")} />
        </View>
      ) : status === "error" ? (
        <View accessibilityRole="alert" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <AppIcon name="alert" size={28} color={VIEWER.muted} />
          <Text className="text-center text-subhead" style={{ color: VIEWER.foreground }}>{t("imageViewer.failed")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.retry")}
            onPress={() => { setStatus("loading"); setAttempt((value) => value + 1); }}
            className="min-h-11 flex-row items-center gap-2 rounded-full px-4"
            style={{ backgroundColor: VIEWER.control }}
          >
            <AppIcon name="refresh" size={16} color={VIEWER.foreground} />
            <Text className="text-subhead font-semibold" style={{ color: VIEWER.foreground }}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// design-system: the photo viewer is black in every theme so images read true; its controls are white on black.
const VIEWER = { background: "#000000", foreground: "#ffffff", muted: "rgba(255,255,255,0.6)", control: "rgba(255,255,255,0.14)" } as const;
