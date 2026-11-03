import { useEffect, useId } from "react";
import { Platform } from "react-native";
import nativePredictiveBack, { type PredictiveBackOptions } from "@/modules/cohub-predictive-back";
import { record as recordDebugEvent } from "@/src/data/debug-session";

const native = Platform.OS === "android" ? nativePredictiveBack : null;

/**
 * Pushed routes whose back gesture drags the screen and previews the one under it (Android 14+).
 * Every other route keeps the plain back. Modals, the image viewer, and New Chat never preview:
 * the native stack only retains the screen under an opaque push.
 */
const options: PredictiveBackOptions = {
  routes: ["chat/[sessionId]"],
  minScale: 0.95,
  parallax: 0.1,
  commitMs: 180,
  cancelMs: 200,
  popTimeoutMs: 1500,
};

native?.configure(options);
native?.addListener("onBackPhase", ({ phase, ...detail }) => recordDebugEvent(`navigation.predictive_back.${phase}`, detail));

const blockers = new Set<string>();

/**
 * While `active`, a back gesture shows no preview, because something on the screen (a menu, the
 * Space panels) closes on back instead of the screen.
 */
export function usePredictiveBackBlock(active: boolean) {
  const key = useId();
  useEffect(() => {
    if (!native || !active) return;
    blockers.add(key);
    native.setBlocked(true);
    return () => {
      blockers.delete(key);
      native.setBlocked(blockers.size > 0);
    };
  }, [active, key]);
}
