import { requireNativeView, requireOptionalNativeModule, type NativeModule } from "expo";
import type { ComponentType, ReactNode } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

/** The menu glass, upstream's `TMenuConfig`. Omitted fields take upstream's defaults. */
export type GlassMenuConfig = {
  /** Backdrop blur, in points. */
  blur?: number;
  /** How strongly the rows and the trigger blur while they morph. */
  morphBlur?: number;
  tintColor?: string;
  tintOpacity?: number;
  saturation?: number;
  refraction?: number;
  rim?: number;
  shine?: number;
  highlightOpacity?: number;
  /** How far a drag on the rows pulls the panel. */
  jelly?: number;
  /** Multiplies every spring's pace. */
  speed?: number;
};

/** The glass the trigger is while it morphs, and the morph's springs (upstream's `TMenuTriggerConfig`). */
export type GlassTriggerConfig = {
  blur?: number;
  tintColor?: string;
  tintOpacity?: number;
  saturation?: number;
  refraction?: number;
  rim?: number;
  shine?: number;
  jelly?: number;
  shrink?: { duration?: number; damping?: number; scale?: number };
  absorb?: { duration?: number; damping?: number };
};

/** The capsule behind the lit row. */
export type GlassPlate = { inset?: number; darkOpacity?: number; darkShine?: number; lightOpacity?: number };

export type GlassMenuState = "opening" | "open" | "closing" | "closed";

export type GlassMenuViewProps = ViewProps & {
  /** Turning false runs the menu back into its trigger; `onStateChange` reports `closed` once it is there. */
  open: boolean;
  /** The trigger, in points in this view's coordinates. */
  sourceRect: { x: number; y: number; width: number; height: number };
  /** The trigger's view, drawn inside the glass while it morphs; JS hides the trigger itself meanwhile. */
  sourceTag: number | null;
  /**
   * Whether the trigger is glass. A glass trigger buds into the menu as a second lobe and is drawn inside the glass;
   * a plain one (a select's value) is drawn over the screen shrinking away while the glass fades in from its spot.
   */
  sourceGlass?: boolean;
  /** An expo-blur `BlurTargetView` the glass refracts. It must not contain this view. */
  backdropTag: number | null;
  /** The page color behind the backdrop content, and all the glass shows without one. */
  backdropColor: string;
  dark: boolean;
  cornerRadius: number;
  /** The lit row's view (a descendant of the panel), or null for none. */
  plateTag: number | null;
  plate?: GlassPlate;
  config?: GlassMenuConfig;
  triggerConfig?: GlassTriggerConfig;
  onStateChange?: (event: NativeSyntheticEvent<{ state: GlassMenuState }>) => void;
  /** Exactly one child: the menu panel, absolutely positioned where the menu settles. */
  children: ReactNode;
};

declare class CohubGlassMenuModule extends NativeModule {
  /** Android 13+: RuntimeShader is available. */
  readonly supported: boolean;
}

const glassMenuModule = requireOptionalNativeModule<CohubGlassMenuModule>("CohubGlassMenu");

/** Null on iOS and in binaries without the module. */
export const GlassMenuView: ComponentType<GlassMenuViewProps> | null = glassMenuModule ? requireNativeView("CohubGlassMenu") : null;

export const glassMenuSupported = glassMenuModule?.supported ?? false;
