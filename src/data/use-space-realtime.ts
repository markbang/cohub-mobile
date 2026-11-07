import { useCallback } from "react";
import { useScreenVisibleEffect } from "@/src/ui/pane";
import { useAppActions } from "./context";

export function useSpaceRealtime(spaceIds: readonly string[]): void {
  const { spaceRealtime } = useAppActions();
  const key = JSON.stringify([...new Set(spaceIds)].sort());
  useScreenVisibleEffect(useCallback(() => {
    const ids: string[] = JSON.parse(key);
    return spaceRealtime?.watch(ids);
  }, [key, spaceRealtime]));
}
