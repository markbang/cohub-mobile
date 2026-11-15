import { HttpError, type CohubClient } from "@neta-art/cohub";
import { useCallback, useEffect, useRef, useState } from "react";
import { DISPLAY_QUALITY_PARAMS, type DisplayQuality } from "@/src/data/display-control";

export type DisplayFrame = { uri: string; width: number; height: number; seq: number };
export type DisplayFrameError = { code: string | null; message: string; fatal: boolean };

// Back to back while someone is steering; a still screen still refreshes, only slower.
const ACTIVE_INTERVAL_MS = 120;
const IDLE_INTERVAL_MS = 1_000;
const IDLE_AFTER_MS = 20_000;
const MAX_BACKOFF_MS = 8_000;
const STAT_WINDOW = 8;
// Errors that retrying cannot fix until something else changes; the screen offers a retry instead.
const FATAL_CODES = new Set(["display_not_found", "display_unsupported", "forbidden"]);

/**
 * Polls JPEG frames of a display. Without a WebRTC stack on the phone this is the transport: each
 * frame is one request, so the rate follows the round trip to the computer.
 */
export function useDisplayFrames({ client, spaceId, displayId, quality, enabled }: { client: CohubClient | null; spaceId: string; displayId: string; quality: DisplayQuality; enabled: boolean }) {
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [error, setError] = useState<DisplayFrameError | null>(null);
  const [stats, setStats] = useState<{ fps: number; latencyMs: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastInputAt = useRef(0);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !client) return;
    lastInputAt.current = Date.now();
    const api = client.space(spaceId).displays;
    const controller = new AbortController();
    let alive = true;
    let seq = 0;
    const samples: { at: number; latency: number }[] = [];
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); wake.current = null; resolve(); }
      wake.current = done;
    });
    void (async () => {
      let failures = 0;
      while (alive) {
        const started = Date.now();
        try {
          const capture = await api.capture(displayId, { format: "jpeg", ...DISPLAY_QUALITY_PARAMS[quality] }, { signal: controller.signal });
          if (!alive) return;
          failures = 0;
          seq += 1;
          setFrame({ uri: `data:${capture.mimeType};base64,${capture.data}`, width: capture.width, height: capture.height, seq });
          setError(null);
          const now = Date.now();
          samples.push({ at: now, latency: now - started });
          if (samples.length > STAT_WINDOW) samples.shift();
          if (samples.length > 1) {
            const span = now - samples[0].at;
            setStats({ fps: span > 0 ? ((samples.length - 1) * 1000) / span : 0, latencyMs: Math.round(samples.reduce((sum, sample) => sum + sample.latency, 0) / samples.length) });
          }
        } catch (cause) {
          if (!alive) return;
          failures += 1;
          const next = frameError(cause);
          setError(next);
          if (next.fatal) return;
        }
        const idle = Date.now() - lastInputAt.current > IDLE_AFTER_MS;
        const wait = failures > 0
          ? Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (failures - 1))
          : Math.max(0, (idle ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS) - (Date.now() - started));
        await sleep(wait);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
      wake.current?.();
    };
  }, [attempt, client, displayId, enabled, quality, spaceId]);

  /** Input just landed: fetch the next frame now rather than after the wait. */
  const kick = useCallback(() => {
    lastInputAt.current = Date.now();
    wake.current?.();
  }, []);
  const noteInput = useCallback(() => { lastInputAt.current = Date.now(); }, []);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  return { frame, error, stats, kick, noteInput, retry };
}

export function frameError(cause: unknown): DisplayFrameError {
  if (cause instanceof HttpError) {
    const code = cause.code ?? (cause.status === 403 ? "forbidden" : cause.status === 404 ? "display_not_found" : null);
    return { code, message: cause.message, fatal: code !== null && FATAL_CODES.has(code) };
  }
  return { code: null, message: cause instanceof Error ? cause.message : String(cause), fatal: false };
}
