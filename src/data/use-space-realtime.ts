import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useAppActions } from "./context";

export function useSpaceRealtime(spaceIds: readonly string[]): void {
  const { spaceRealtime } = useAppActions();
  const key = JSON.stringify([...new Set(spaceIds)].sort());
  useFocusEffect(useCallback(() => {
    const ids: string[] = JSON.parse(key);
    return spaceRealtime?.watch(ids);
  }, [key, spaceRealtime]));
}
