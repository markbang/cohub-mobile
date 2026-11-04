import { NativeModule, requireOptionalNativeModule } from "expo";

export type PredictiveBackOptions = {
  /** Expo Router route names whose screen previews the one under it during a back gesture. */
  routes: string[];
  /** Scale of the dragged screen at full progress. */
  minScale: number;
  /** How far, as a fraction of the width, the screen under it starts offset. */
  parallax: number;
  commitMs: number;
  cancelMs: number;
  /** How long a committed gesture waits for JS to pop before the screen slides back. */
  popTimeoutMs: number;
};

export type PredictiveBackPhase = "passthrough" | "started" | "cancelled" | "committed" | "popped" | "aborted" | "timeout" | "ignored";

export type PredictiveBackState = {
  /** The callback is registered: Android 13+ with `predictiveBackGestureEnabled`. */
  installed: boolean;
  /** Back gestures can drag screens: installed and Android 14+. */
  animated: boolean;
  phase: string;
};

type PredictiveBackEvents = {
  onBackPhase(event: { phase: PredictiveBackPhase } & Record<string, string | number | boolean | null>): void;
};

declare class CohubPredictiveBackModule extends NativeModule<PredictiveBackEvents> {
  configure(options: PredictiveBackOptions): void;
  /** While true, every back goes to JS without a preview. */
  setBlocked(blocked: boolean): void;
  state(): PredictiveBackState;
}

/** Null on iOS and in binaries without the module. */
export default requireOptionalNativeModule<CohubPredictiveBackModule>("CohubPredictiveBack");
