import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import { BlurTargetView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import { haptics } from "@/src/platform/haptics";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { Keyboard, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardEvents } from "react-native-keyboard-controller";
import Animated, { Easing, interpolateColor, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { curves, springs, tabBarMinimize } from "@/src/motion";
import { edgeChrome, MAX_FONT_SCALE, useAppTheme } from "@/src/theme";
import { EdgeScrim } from "@/src/ui/EdgeChrome";
import { GlassBackground, GlassGroup, useGlassMaterial } from "@/src/ui/Glass";
import { useTabBarMinimized } from "@/src/ui/tab-bar-minimize";

// Geometry and feel follow UIKit's iOS 26 tab bar: a lens rests under the selected tab, lifts and
// grows under a press, follows a drag across the bar, and settles on the tab it is let go over.
const BAR_HEIGHT = 62;
const BAR_PADDING = 4;
// Four tabs plus the glass outset must fit a 360dp-wide screen.
// The iOS 26 tab bar, measured on a 402 pt iPhone: 21 pt from each screen edge, a 98 pt selection
// capsule, and items centred at even steps between the capsule's two end positions.
const BAR_SIDE_MARGIN = 21;
const LENS_WIDTH = 98;
const LENS_HEIGHT = BAR_HEIGHT - BAR_PADDING * 2;
/** How far a lifted lens grows past its resting size on each side: iOS 27's 94 × 53 lens grows to 117 × 73 (liquidglass). */
const LENS_GROWTH_X = 11.5;
const LENS_GROWTH_Y = 10;
/** A quick tap still keeps the lens up this long, as on iOS 27. */
const LIFT_MIN_MS = 230;
/** What sits under a lifted lens is drawn this much larger, standing in for the glass's magnification. */
const LENS_MAGNIFY = 0.16;
/** A drag past the first or last tab moves the lens this many tabs at most, rubber-banded. */
const OVERDRAG = 0.35;
const TOUCH_SLOP = 10;
/** A drag let go mid-flick carries on as far as its speed would take it in this long, at most one tab. */
const FLING_PROJECTION_S = 0.1;
/** The lift holds until it has risen this far and the lens is this close to its tab, so a tap pops fully. */
const LIFT_SNAP = 0.975;
const LIFT_RELEASE = 0.04;
// The lens stretches along its motion and thins across it, saturating with speed (tabs per second).
const JELLY_SPEED = 3;
const JELLY_STRETCH = 0.2;
const JELLY_ASPECT = 1.4;
const BAR_SWELL = 0.049;
const PULL_LIMIT = BAR_HEIGHT * 7 / 32;
const BAR_BOTTOM_MARGIN = 8;
const EASE_IN_OUT = Easing.bezier(...curves.easeInOut);
/** Room around the bar for its glass group, so a lifted lens is not clipped where it overhangs the bar. */
const GLASS_OUTSET = 16;
// Minimized, the bar is a 48 pt circle 7 pt in from its leading end, holding only the selected tab's glyph.
const MINIMIZED_SIZE = 48;
const MINIMIZED_INSET = 7;
const MINIMIZED_CENTER = MINIMIZED_INSET + MINIMIZED_SIZE / 2;
// The squeeze's inset a side at its height, for the bar's width at that moment.
const SQUEEZE_BASE = 3;
const SQUEEZE_PER_WIDTH = 0.028;
/** Without its label, the selected glyph drops to the bar's centre line: half the label and its gap. */
const MINIMIZED_GLYPH_DROP = 8;
const SQUEEZE_IN = Easing.bezier(...tabBarMinimize.squeeze.curve);
const COLLAPSE = Easing.bezier(...tabBarMinimize.collapse.curve);
const RELEASE = Easing.bezier(...tabBarMinimize.release.curve);

function clamp01(value: number) {
  "worklet";
  return Math.min(Math.max(value, 0), 1);
}

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

type BlurTargets = { targets: Record<string, RefObject<View | null>>; register: (routeKey: string, ref: RefObject<View | null> | null) => void };
const TabBlurTargets = createContext<BlurTargets | null>(null);

/** Holds each tab screen's blur target so the bar can frost what is behind it on Android. */
export function TabBlurTargetsProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Record<string, RefObject<View | null>>>({});
  const register = useCallback((routeKey: string, ref: RefObject<View | null> | null) => {
    setTargets((current) => {
      if (ref) return current[routeKey] === ref ? current : { ...current, [routeKey]: ref };
      if (!(routeKey in current)) return current;
      const { [routeKey]: _removed, ...rest } = current;
      return rest;
    });
  }, []);
  return <TabBlurTargets.Provider value={{ targets, register }}>{children}</TabBlurTargets.Provider>;
}

/**
 * The tab navigator's `screenLayout`. Android blurs only a view it is pointed at, so each tab screen
 * becomes the bar's blur target there; iOS blurs whatever lies beneath and needs no wrapper.
 */
export function TabScreenLayout({ routeKey, children }: { routeKey: string; children: ReactElement }) {
  const blur = useContext(TabBlurTargets);
  const ref = useRef<View | null>(null);
  const register = blur?.register;
  useEffect(() => {
    if (Platform.OS !== "android" || !register) return;
    register(routeKey, ref);
    return () => register(routeKey, null);
  }, [register, routeKey]);
  if (Platform.OS !== "android") return children;
  return <BlurTargetView ref={ref} style={{ flex: 1 }}>{children}</BlurTargetView>;
}

const IOS_HOME_INDICATOR_OVERLAP = 14;

// The iOS 26 tab bar ends 22 pt above the screen edge, clear of the home indicator.
const SYSTEM_BAR_BOTTOM = 22;

function barBottomOffset(bottomInset: number) {
  // iOS's home-indicator inset is sized for edge-to-edge content; like the system tab bar, a floating bar can sit partly inside it.
  if (Platform.OS === "ios") return Math.max(bottomInset - IOS_HOME_INDICATOR_OVERLAP, BAR_BOTTOM_MARGIN * 2);
  // Gesture navigation's handle sits where the home indicator does; three-button navigation needs its own inset.
  return bottomInset <= 34 ? SYSTEM_BAR_BOTTOM : bottomInset + BAR_BOTTOM_MARGIN;
}

/** Distance between neighbouring items' centres, given the bar's width. */
function itemPitch(barWidth: number, count: number) {
  return count > 1 ? (barWidth - BAR_PADDING * 2 - LENS_WIDTH) / (count - 1) : 0;
}

/** Space the tab bar occupies at the bottom of a tab screen. */
export function useFloatingTabBarInset() {
  const insets = useSafeAreaInsets();
  // iOS tab roots scroll with automatic insets, which already clear the system tab bar, so only the
  // breathing room is added. Android draws this bar over the screen.
  if (Platform.OS === "ios") return 16;
  return BAR_HEIGHT + barBottomOffset(insets.bottom) + 16;
}

/** Milliseconds for velocity estimates; touch events carry no timestamp. */
function clock() {
  "worklet";
  return Date.now();
}

function rubberBand(overshoot: number, limit: number) {
  "worklet";
  const pull = 1 - 1 / (Math.abs(overshoot) * 0.55 / limit + 1);
  return limit * pull * Math.sign(overshoot);
}

export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const theme = useAppTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [lensLifted, setLensLifted] = useState(false);
  const routes = state.routes;
  const blurTarget = useContext(TabBlurTargets)?.targets[routes[state.index]?.key ?? ""] ?? null;
  const material = useGlassMaterial({ blurTarget });
  const lastIndex = routes.length - 1;
  const { width: windowWidth } = useWindowDimensions();
  const barWidth = windowWidth - BAR_SIDE_MARGIN * 2;
  const pitch = itemPitch(barWidth, routes.length);
  const itemWidth = pitch > 0 ? pitch : LENS_WIDTH;

  const hidden = useSharedValue(0);
  // Minimizing: `collapse` runs the bar from full (0) to the circle (1); `squeeze` pulls it in on the way.
  const minimizeRequest = useTabBarMinimized();
  const collapse = useSharedValue(0);
  const squeeze = useSharedValue(0);
  const [minimized, setMinimized] = useState(false);
  const selected = useSharedValue(state.index);
  // Lens position in tabs, its target, and its lift (0 resting, 1 lifted).
  const lens = useSharedValue(state.index);
  const lensTarget = useSharedValue(state.index);
  const lift = useSharedValue(0);
  const swell = useSharedValue(0);
  const jelly = useSharedValue(0);
  const pull = useSharedValue(0);
  // Touch tracking, all on the UI thread.
  const touching = useSharedValue(false);
  const dragging = useSharedValue(false);
  const dropping = useSharedValue(false);
  const pressed = useSharedValue(-1);
  const startX = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastTime = useSharedValue(0);
  const velocityX = useSharedValue(0);
  const lensTime = useSharedValue(0);
  const liftStart = useSharedValue(0);

  const tick = useCallback(() => {
    haptics.selection();
  }, []);

  const select = useCallback((index: number) => {
    const route = routes[index];
    if (!route) return;
    const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    // A press on the current tab still emits tabPress so its screen can scroll to top.
    if (state.index === index || event.defaultPrevented) return;
    navigateToTab(route.key);
  }, [emitter, navigateToTab, routes, state.index]);

  useEffect(() => {
    selected.set(state.index);
    // Navigation from elsewhere moves the lens; a lens already headed there keeps its motion.
    if (touching.get() || lensTarget.get() === state.index) return;
    lensTarget.set(state.index);
    lens.set(withSpring(state.index, springs.dockTravel));
  }, [lens, lensTarget, selected, state.index, touching]);

  useEffect(() => {
    // Android's own events only arrive once the keyboard has finished moving; keyboard-controller's
    // will-events start with it, as iOS's do, so the bar leaves before the keyboard reaches it.
    const events = Platform.OS === "ios" ? Keyboard : KeyboardEvents;
    const show = events.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hide = events.addListener("keyboardWillHide", () => setKeyboardVisible(false));
    // keyboard-controller skips will-hide when it resyncs a dismissal it did not animate, as when a
    // Modal opens over the keyboard or the app returns from background; did-hide arrives in every case.
    const hidden = events.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    hidden.set(withTiming(keyboardVisible ? 1 : 0, { duration: 180, easing: EASE_IN_OUT }));
  }, [hidden, keyboardVisible]);

  useAnimatedReaction(() => (minimizeRequest ? minimizeRequest.get() : 0), (next, previous) => {
    if (next === previous || (previous === null && next === 0)) return;
    if (next === 1) {
      const { squeeze: inward, collapse: run, release } = tabBarMinimize;
      squeeze.set(withSequence(
        withTiming(1, { duration: inward.duration, easing: SQUEEZE_IN }),
        withDelay(release.delay, withTiming(0, { duration: release.duration, easing: RELEASE })),
      ));
      collapse.set(withDelay(run.delay, withTiming(1, { duration: run.duration, easing: COLLAPSE })));
    } else {
      squeeze.set(withTiming(0, { duration: 120 }));
      collapse.set(withSpring(0, springs.tabBarExpand));
    }
    scheduleOnRN(setMinimized, next === 1);
  });

  // Choosing a tab some other way (a link, a notification) brings the whole bar back.
  useEffect(() => { minimizeRequest?.set(0); }, [minimizeRequest, state.index]);
  const expand = useCallback(() => { minimizeRequest?.set(0); }, [minimizeRequest]);
  const selectedRoute = routes[state.index];
  const selectedTitle = selectedRoute ? descriptors[selectedRoute.key]?.options.title : undefined;
  const selectedLabel = typeof selectedTitle === "string" ? selectedTitle : selectedRoute?.name;

  // UIKit keeps the lens lifted until it has risen all the way and arrived.
  const dropIfArrived = useCallback(() => {
    "worklet";
    if (!dropping.get() || touching.get() || lift.get() < LIFT_SNAP) return;
    if (Math.abs(lensTarget.get() - lens.get()) > LIFT_RELEASE) return;
    dropping.set(false);
    lift.set(withDelay(Math.max(0, LIFT_MIN_MS - (clock() - liftStart.get())), withSpring(0, springs.dockLift)));
    scheduleOnRN(setLensLifted, false);
  }, [dropping, lens, lensTarget, lift, liftStart, touching]);
  useAnimatedReaction(() => [lens.get(), lift.get()] as const, dropIfArrived);

  useAnimatedReaction(() => lens.get(), (position, previous) => {
    const now = clock();
    const elapsed = now - lensTime.get();
    lensTime.set(now);
    if (previous === null || elapsed <= 0) return;
    const speed = Math.abs(position - previous) / elapsed * 1000;
    jelly.set(withSpring(JELLY_STRETCH * Math.tanh(speed / JELLY_SPEED), springs.dockJelly));
  });

  // Lets go of the lens over `index`: it travels there, then drops once it has arrived.
  function settle(index: number) {
    "worklet";
    touching.set(false);
    dragging.set(false);
    dropping.set(true);
    pressed.set(-1);
    lensTarget.set(index);
    lens.set(withSpring(index, springs.dockTravel));
    swell.set(withSpring(0, springs.dockPress));
    pull.set(withSpring(0, springs.dockPress));
    // A press held until the lens has risen and arrived leaves nothing moving to wake the reaction above.
    dropIfArrived();
  }

  const gesture = Gesture.Manual()
    .enabled(!minimized)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || touching.get()) return;
      manager.activate();
      const index = indexAt(positionAt(touch.x, lastIndex, pitch), lastIndex);
      touching.set(true);
      dragging.set(false);
      dropping.set(false);
      pressed.set(index);
      startX.set(touch.x);
      lastX.set(touch.x);
      lastTime.set(clock());
      velocityX.set(0);
      liftStart.set(clock());
      lift.set(withSpring(1, springs.dockLift));
      swell.set(withSpring(1, springs.dockPress));
      scheduleOnRN(setLensLifted, true);
      lensTarget.set(index);
      lens.set(withSpring(index, springs.dockTravel));
    })
    .onTouchesMove((event) => {
      const touch = event.allTouches[0];
      if (!touch || !touching.get()) return;
      const now = clock();
      const elapsed = Math.max(1, now - lastTime.get());
      velocityX.set(velocityX.get() * 0.6 + (touch.x - lastX.get()) / elapsed * 1000 * 0.4);
      lastX.set(touch.x);
      lastTime.set(now);
      if (!dragging.get()) {
        if (Math.abs(touch.x - startX.get()) < TOUCH_SLOP) return;
        dragging.set(true);
      }
      const overshoot = touch.x - Math.min(Math.max(touch.x, 0), barWidth);
      pull.set(withSpring(rubberBand(overshoot, PULL_LIMIT), springs.dockTrack));
      const position = positionAt(touch.x, lastIndex, pitch);
      lensTarget.set(position);
      lens.set(withSpring(position, springs.dockFollow));
      const index = indexAt(position, lastIndex);
      if (index !== pressed.get()) {
        pressed.set(index);
        scheduleOnRN(tick);
      }
    })
    .onTouchesUp((_event, manager) => {
      if (!touching.get()) return;
      const wasDragging = dragging.get();
      let index = pressed.get();
      if (wasDragging) {
        const lead = velocityX.get() / pitch * FLING_PROJECTION_S;
        const flung = Math.min(Math.max(Math.round(lensTarget.get() + lead), index - 1, 0), index + 1, lastIndex);
        if (flung !== index) {
          index = flung;
          scheduleOnRN(tick);
        }
      }
      // A tap is navigation, which never buzzes; only a drag ticks as it crosses tabs.
      settle(index);
      scheduleOnRN(select, index);
      manager.end();
    })
    // The handler is already finishing when this runs. Failing it again from here re-enters its
    // state change, and RNGH 3.3 then resets it mid-transition and crashes on Android.
    .onTouchesCancelled(() => {
      if (!touching.get()) return;
      settle(selected.get());
    });

  const barStyle = useAnimatedStyle(() => ({
    opacity: 1 - hidden.get(),
    transform: [{ translateY: hidden.get() * (BAR_HEIGHT + 40) }],
  }));
  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pull.get() / 2 },
      { scaleX: 1 + BAR_SWELL * swell.get() + Math.abs(pull.get()) / barWidth },
      { scaleY: 1 + BAR_SWELL * swell.get() },
    ],
  }));
  // The drawn lens rests at one tab's size and is moved and stretched by transform only, so a drag
  // never re-lays-out the bar; its capsule ends flatten slightly while it stretches.
  const lensStyle = useAnimatedStyle(() => {
    const { width, height } = lensSize(lift.get(), jelly.get());
    return { transform: [{ translateX: lens.get() * pitch }, { scaleX: width / LENS_WIDTH }, { scaleY: height / LENS_HEIGHT }] };
  });
  // Liquid Glass keeps a real frame: the glass group merges and refracts by its views' geometry, which
  // a transform would leave behind. It is one childless, absolutely placed view, so nothing else re-lays-out.
  const glassLensStyle = useAnimatedStyle(() => {
    const { width, height } = lensSize(lift.get(), jelly.get());
    return {
      position: "absolute",
      borderRadius: height / 2,
      width,
      height,
      left: GLASS_OUTSET + BAR_PADDING + LENS_WIDTH / 2 + lens.get() * pitch - width / 2,
      top: GLASS_OUTSET + (BAR_HEIGHT - height) / 2,
    };
  });
  // The bar's glass, drawn on its own frame so minimizing re-lays-out nothing else.
  const glassFrameStyle = useAnimatedStyle(() => {
    const q = collapse.get();
    const width = barWidth + (MINIMIZED_SIZE - barWidth) * q;
    const height = BAR_HEIGHT + (MINIMIZED_SIZE - BAR_HEIGHT) * q;
    const inset = squeeze.get() * (SQUEEZE_BASE + SQUEEZE_PER_WIDTH * width);
    const insetY = inset * height / width;
    return {
      left: GLASS_OUTSET + MINIMIZED_INSET * q + inset,
      top: GLASS_OUTSET + (BAR_HEIGHT - height) / 2 + insetY,
      width: width - inset * 2,
      height: height - insetY * 2,
    };
  });
  // The selection capsule goes first, as the bar starts to close.
  const restingLensStyle = useAnimatedStyle(() => ({ opacity: (1 - lift.get()) * (1 - clamp01(collapse.get() / 0.12)) }));
  const liftedLensStyle = useAnimatedStyle(() => ({ opacity: lift.get() * (1 - clamp01(collapse.get() / 0.12)) }));

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? "none" : "box-none"}
      style={[{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: barBottomOffset(insets.bottom),
      }, barStyle]}
    >
      <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
      <GestureDetector gesture={gesture}>
        <Animated.View accessibilityRole="tablist" pointerEvents={minimized ? "none" : "auto"} className="self-center" style={[{ height: BAR_HEIGHT, width: barWidth }, surfaceStyle]}>
          {/* One glass group holds the bar and the lifted lens so the two merge as liquid where they meet. */}
          <GlassGroup spacing={LENS_GROWTH_X * 2} style={{ position: "absolute", top: -GLASS_OUTSET, left: -GLASS_OUTSET, right: -GLASS_OUTSET, bottom: -GLASS_OUTSET }} pointerEvents="none">
            {/* Glass carries its own edge; the solid float steps lighter in dark mode, where the shadow barely shows. */}
            <Animated.View className={`absolute rounded-full ${material === "liquid" ? "" : "shadow-float"}`} style={glassFrameStyle}>
              <GlassBackground radius={BAR_HEIGHT / 2} blurTarget={blurTarget} rim />
            </Animated.View>
            {material === "liquid" ? <AnimatedGlassView glassEffectStyle={{ style: lensLifted ? "clear" : "none", animate: true, animationDuration: 0.2 }} colorScheme={theme.mode} style={glassLensStyle} /> : null}
          </GlassGroup>
          <Animated.View pointerEvents="none" className="absolute" style={[LENS_FRAME, lensStyle]}>
            {/* iOS selects with a neutral capsule; the accent stays on the glyph and label. */}
            <Animated.View className="absolute inset-0 rounded-full bg-glass-lens" style={restingLensStyle} />
            {/* Without Liquid Glass, the lifted lens stands off the bar as a solid pane rather than a tint on it. */}
            {material === "liquid" ? null : <Animated.View className="absolute inset-0 rounded-full bg-surface-pressed shadow-float" style={liftedLensStyle} />}
          </Animated.View>
          <View className="flex-1 flex-row" style={{ paddingHorizontal: BAR_PADDING + (LENS_WIDTH - itemWidth) / 2 }}>
            {routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const label = typeof options.title === "string" ? options.title : route.name;
              return (
                <TabItem
                  key={route.key}
                  index={index}
                  label={label}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                  testID={options.tabBarButtonTestID}
                  focused={state.index === index}
                  lens={lens}
                  lift={lift}
                  // design-system-begin: the icon renderer and the label color interpolation take JS colors.
                  restIcon={options.tabBarIcon?.({ focused: false, color: theme.colors.text, size: ICON_SIZE })}
                  activeIcon={options.tabBarIcon?.({ focused: state.index === index, color: theme.colors.accent, size: ICON_SIZE })}
                  // design-system-end
                  restColor={theme.colors.text}
                  activeColor={theme.colors.accent}
                  onSelect={select}
                  width={itemWidth}
                  collapse={collapse}
                  minimizedShift={MINIMIZED_CENTER - (BAR_PADDING + (LENS_WIDTH - itemWidth) / 2 + itemWidth * (index + 0.5))}
                />
              );
            })}
          </View>
        </Animated.View>
      </GestureDetector>
      {/* Minimized, the circle only brings the bar back, as UIKit's does. */}
      {minimized ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={selectedLabel}
        onPress={expand}
        style={{ position: "absolute", left: (windowWidth - barWidth) / 2 + MINIMIZED_INSET, bottom: barBottomOffset(insets.bottom) + (BAR_HEIGHT - MINIMIZED_SIZE) / 2, width: MINIMIZED_SIZE, height: MINIMIZED_SIZE }}
      /> : null}
    </Animated.View>
  );
}

// SF tab symbols draw about 26 pt; Lucide draws inside its box with padding.
const ICON_SIZE = 28;
const LENS_FRAME = { left: BAR_PADDING, top: (BAR_HEIGHT - LENS_HEIGHT) / 2, width: LENS_WIDTH, height: LENS_HEIGHT } as const;

/** The lens grows as it lifts, and stretches along its motion while thinning across it. */
function lensSize(lifted: number, stretch: number) {
  "worklet";
  return { width: (LENS_WIDTH + LENS_GROWTH_X * 2 * lifted) * (1 + stretch), height: (LENS_HEIGHT + LENS_GROWTH_Y * 2 * lifted) * (1 - stretch * JELLY_ASPECT) };
}

function positionAt(x: number, lastIndex: number, pitch: number) {
  "worklet";
  if (pitch <= 0) return 0;
  const position = (x - BAR_PADDING - LENS_WIDTH / 2) / pitch;
  if (position < 0) return rubberBand(position, OVERDRAG);
  if (position > lastIndex) return lastIndex + rubberBand(position - lastIndex, OVERDRAG);
  return position;
}

function indexAt(position: number, lastIndex: number) {
  "worklet";
  return Math.min(Math.max(Math.round(position), 0), lastIndex);
}

type TabItemProps = {
  index: number;
  label: string;
  accessibilityLabel: string;
  testID?: string;
  focused: boolean;
  lens: SharedValue<number>;
  lift: SharedValue<number>;
  restIcon: React.ReactNode;
  activeIcon: React.ReactNode;
  restColor: string;
  activeColor: string;
  onSelect: (index: number) => void;
  width: number;
  collapse: SharedValue<number>;
  /** How far the glyph travels to the minimized circle's centre. */
  minimizedShift: number;
};

/**
 * One destination. Its accent shows wherever the lens is over it, not only once navigation
 * settles, so a drag lights each tab it crosses. Touch is the bar's; screen readers activate here.
 */
function TabItem({ index, label, accessibilityLabel, testID, focused, lens, lift, restIcon, activeIcon, restColor, activeColor, onSelect, width, collapse, minimizedShift }: TabItemProps) {
  // Minimizing, the other tabs fade out while the selected glyph moves into the circle and sheds its label.
  const contentStyle = useAnimatedStyle(() => {
    const over = Math.max(0, 1 - Math.abs(lens.get() - index));
    const q = collapse.get();
    const travel = focused ? clamp01(q / 0.45) : 0;
    return {
      opacity: focused ? 1 : 1 - clamp01(q / 0.35),
      transform: [{ translateX: minimizedShift * travel }, { translateY: MINIMIZED_GLYPH_DROP * travel }, { scale: 1 + LENS_MAGNIFY * lift.get() * over }],
    };
  });
  // The two icons differ in stroke and offset, so the rest icon fades out where the active one shows; left under it, its edge rims the accent strokes.
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(lens.get() - index)) }));
  const restIconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs(lens.get() - index)) }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - clamp01(collapse.get() / 0.3), color: interpolateColor(Math.max(0, 1 - Math.abs(lens.get() - index)), [0, 1], [restColor, activeColor]) }));
  return (
    <View
      accessible
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => onSelect(index)}
      testID={testID}
      className="h-full items-center justify-center"
      style={{ width }}
    >
      <Animated.View className="items-center justify-center gap-0.5" style={contentStyle}>
        <View style={{ width: ICON_SIZE, height: ICON_SIZE }}>
          <Animated.View className="absolute inset-0 items-center justify-center" style={restIconStyle}>{restIcon}</Animated.View>
          <Animated.View className="absolute inset-0 items-center justify-center" style={activeIconStyle}>{activeIcon}</Animated.View>
        </View>
        {/* Labels are the one place icons never stand alone: tabs name destinations. */}
        <Animated.Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className={`text-micro ${focused ? "font-semibold" : "font-medium"}`} style={labelStyle}>{label}</Animated.Text>
      </Animated.View>
    </View>
  );
}
