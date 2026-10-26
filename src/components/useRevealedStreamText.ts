import { useLayoutEffect, useState } from "react";
import { StreamRevealController } from "@/src/data/stream-reveal";

/**
 * Hands the Markdown renderer a paced prefix of streamed text instead of every network chunk, so
 * text appears smoothly rather than in server-sized lumps. Non-streaming text passes through
 * untouched, and a rewrite (correction, history reload) shows in full without replaying.
 *
 * The controller starts with the mounting text, so the first frame carries it and a mount costs one
 * render; non-streaming text never segments graphemes, so mounting a long history stays cheap.
 * Steps are plain state updates: an external store re-rendered every mounting block synchronously,
 * which kept list fills in synchronous chains until React's nested-update limit ended the runtime.
 */
export function useRevealedStreamText(source: string, streaming: boolean) {
  const [controller] = useState(() => new StreamRevealController(source));
  const [displayed, setDisplayed] = useState(controller.getDisplayed);

  // Subscribed before the target syncs below, so a rewrite published there is not missed.
  useLayoutEffect(() => controller.subscribe(() => setDisplayed(controller.getDisplayed())), [controller]);

  useLayoutEffect(() => {
    if (streaming) controller.setTarget(source);
    else controller.flush(source);
  }, [controller, source, streaming]);

  useLayoutEffect(() => () => controller.stop(), [controller]);

  if (!streaming) return source;
  return source.startsWith(displayed) ? displayed : source;
}
