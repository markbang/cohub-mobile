import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import { BlurTargetView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { Keyboard, Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, interpolateColor, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { springs } from "@/src/motion";
import { edgeChrome, useAppTheme } from "@/src/theme";
import { EdgeScrim } from "@/src/ui/EdgeChrome";
import { GlassBackground, GlassGroup, useGlassMaterial } from "@/src/ui/Glass";

// Geometry and feel follow UIKit's iOS 26 tab bar: a lens rests under the selected tab, lifts and
// grows under a press, follows a drag across the bar, and settles on the tab it is let go over.
const BAR_HEIGHT = 62;
const BAR_PADDING = 4;
// Four tabs plus the glass outset must fit a 360dp-wide screen.
const ITEM_WIDTH = 76;
const LENS_HEIGHT = BAR_HEIGHT - BAR_PADDING * 2;
/** How far a lifted lens grows past its resting size on each side. */
const LENS_GROWTH = 8;
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
const BAR_SWELL = 0.04;
const PULL_LIMIT = BAR_HEIGHT * 7 / 32;
const BAR_BOTTOM_MARGIN = 8;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Room around the bar for its glass group, so a lifted lens is not clipped where it overhangs the bar. */
const GLASS_OUTSET = 16;

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

function barBottomOffset(bottomInset: number) {
  // iOS's home-indicator inset is sized for edge-to-edge content; like the system tab bar, a floating bar can sit partly inside it.
  if (Platform.OS === "ios") return Math.max(bottomInset - IOS_HOME_INDICATOR_OVERLAP, BAR_BOTTOM_MARGIN * 2);
  return Math.max(bottomInset, BAR_BOTTOM_MARGIN) + BAR_BOTTOM_MARGIN;
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
  const barWidth = ITEM_WIDTH * routes.length + BAR_PADDING * 2;

  const hidden = useSharedValue(0);
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

  const tick = useCallback(() => {
    if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
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
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    hidden.set(withTiming(keyboardVisible ? 1 : 0, { duration: 180, easing: EASE_IN_OUT }));
  }, [hidden, keyboardVisible]);

  // UIKit keeps the lens lifted until it has risen all the way and arrived.
  useAnimatedReaction(() => [lens.get(), lift.get()] as const, ([position, lifted]) => {
    if (!dropping.get() || touching.get() || lifted < LIFT_SNAP) return;
    if (Math.abs(lensTarget.get() - position) > LIFT_RELEASE) return;
    dropping.set(false);
    lift.set(withSpring(0, springs.dockLift));
    scheduleOnRN(setLensLifted, false);
  });

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
  }

  const gesture = Gesture.Manual()
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || touching.get()) return;
      manager.activate();
      const index = indexAt(positionAt(touch.x, lastIndex), lastIndex);
      touching.set(true);
      dragging.set(false);
      dropping.set(false);
      pressed.set(index);
      startX.set(touch.x);
      lastX.set(touch.x);
      lastTime.set(clock());
      velocityX.set(0);
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
      const position = positionAt(touch.x, lastIndex);
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
        const lead = velocityX.get() / ITEM_WIDTH * FLING_PROJECTION_S;
        const flung = Math.min(Math.max(Math.round(lensTarget.get() + lead), index - 1, 0), index + 1, lastIndex);
        if (flung !== index) {
          index = flung;
          scheduleOnRN(tick);
        }
      } else if (index !== selected.get()) {
        scheduleOnRN(tick);
      }
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
  const lensStyle = useAnimatedStyle(() => {
    const growth = LENS_GROWTH * 2 * lift.get();
    const width = (ITEM_WIDTH + growth) * (1 + jelly.get());
    const height = (LENS_HEIGHT + growth) * (1 - jelly.get() * JELLY_ASPECT);
    return {
      width,
      height,
      left: BAR_PADDING + (lens.get() + 0.5) * ITEM_WIDTH - width / 2,
      top: (BAR_HEIGHT - height) / 2,
    };
  });
  // The Liquid Glass lens sits in the glass group, which is offset by its outset around the bar.
  const glassLensStyle = useAnimatedStyle(() => {
    const growth = LENS_GROWTH * 2 * lift.get();
    const width = (ITEM_WIDTH + growth) * (1 + jelly.get());
    const height = (LENS_HEIGHT + growth) * (1 - jelly.get() * JELLY_ASPECT);
    return {
      position: "absolute",
      borderRadius: height / 2,
      width,
      height,
      left: GLASS_OUTSET + BAR_PADDING + (lens.get() + 0.5) * ITEM_WIDTH - width / 2,
      top: GLASS_OUTSET + (BAR_HEIGHT - height) / 2,
    };
  });
  const restingLensStyle = useAnimatedStyle(() => ({ opacity: 1 - lift.get() }));
  const liftedLensStyle = useAnimatedStyle(() => ({ opacity: lift.get() }));

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
        {/* Glass carries its own edge; the solid float steps lighter in dark mode, where the shadow barely shows. */}
        <Animated.View accessibilityRole="tablist" className={`self-center rounded-full ${material === "liquid" ? "" : "shadow-float"}`} style={[{ height: BAR_HEIGHT, width: barWidth }, surfaceStyle]}>
          {/* One glass group holds the bar and the lifted lens so the two merge as liquid where they meet. */}
          <GlassGroup spacing={LENS_GROWTH * 2} style={{ position: "absolute", top: -GLASS_OUTSET, left: -GLASS_OUTSET, right: -GLASS_OUTSET, bottom: -GLASS_OUTSET }} pointerEvents="none">
            <GlassBackground radius={BAR_HEIGHT / 2} blurTarget={blurTarget} style={{ top: GLASS_OUTSET, left: GLASS_OUTSET, right: GLASS_OUTSET, bottom: GLASS_OUTSET }} />
            {material === "liquid" ? <AnimatedGlassView glassEffectStyle={{ style: lensLifted ? "clear" : "none", animate: true, animationDuration: 0.2 }} colorScheme={theme.mode} style={glassLensStyle} /> : null}
          </GlassGroup>
          <Animated.View pointerEvents="none" className="absolute" style={lensStyle}>
            <Animated.View className="absolute inset-0 rounded-full bg-accent-soft" style={restingLensStyle} />
            {/* Without Liquid Glass, the lifted lens stands off the bar as a solid pane rather than a tint on it. */}
            {material === "liquid" ? null : <Animated.View className="absolute inset-0 rounded-full bg-surface-pressed shadow-float" style={liftedLensStyle} />}
          </Animated.View>
          <View className="flex-1 flex-row" style={{ paddingHorizontal: BAR_PADDING }}>
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
                  restIcon={options.tabBarIcon?.({ focused: false, color: theme.colors.textMuted, size: ICON_SIZE })}
                  activeIcon={options.tabBarIcon?.({ focused: state.index === index, color: theme.colors.accent, size: ICON_SIZE })}
                  // design-system-end
                  restColor={theme.colors.textMuted}
                  activeColor={theme.colors.accent}
                  onSelect={select}
                />
              );
            })}
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const ICON_SIZE = 24;

function positionAt(x: number, lastIndex: number) {
  "worklet";
  const position = (x - BAR_PADDING) / ITEM_WIDTH - 0.5;
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
};

/**
 * One destination. Its accent shows wherever the lens is over it, not only once navigation
 * settles, so a drag lights each tab it crosses. Touch is the bar's; screen readers activate here.
 */
function TabItem({ index, label, accessibilityLabel, testID, focused, lens, lift, restIcon, activeIcon, restColor, activeColor, onSelect }: TabItemProps) {
  const contentStyle = useAnimatedStyle(() => {
    const over = Math.max(0, 1 - Math.abs(lens.get() - index));
    return { transform: [{ scale: 1 + LENS_MAGNIFY * lift.get() * over }] };
  });
  // The two icons differ in stroke and offset, so the rest icon fades out where the active one shows; left under it, its edge rims the accent strokes.
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(lens.get() - index)) }));
  const restIconStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs(lens.get() - index)) }));
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(Math.max(0, 1 - Math.abs(lens.get() - index)), [0, 1], [restColor, activeColor]) }));
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
      style={{ width: ITEM_WIDTH }}
    >
      <Animated.View className="items-center justify-center gap-0.5" style={contentStyle}>
        <View style={{ width: ICON_SIZE, height: ICON_SIZE }}>
          <Animated.View className="absolute inset-0 items-center justify-center" style={restIconStyle}>{restIcon}</Animated.View>
          <Animated.View className="absolute inset-0 items-center justify-center" style={activeIconStyle}>{activeIcon}</Animated.View>
        </View>
        {/* Labels are the one place icons never stand alone: tabs name destinations. */}
        <Animated.Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className={`text-micro ${focused ? "font-semibold" : "font-medium"}`} style={labelStyle}>{label}</Animated.Text>
      </Animated.View>
    </View>
  );
}
