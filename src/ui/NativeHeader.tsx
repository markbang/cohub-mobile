import type { ReactNode } from "react";
import type { NativeMenuAction } from "@/src/components/NativeMenu";
import type { IconName } from "@/src/icons";

export type NativeHeaderItem =
  | { kind: "button"; label: string; icon: IconName; onPress: () => void; prominent?: boolean; disabled?: boolean }
  | { kind: "menu"; label: string; icon: IconName; title?: string; active?: boolean; actions: readonly NativeMenuAction[] };

export type NativeHeader = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  items?: readonly NativeHeaderItem[];
  search?: { query: string; onQueryChange: (query: string) => void; placeholder: string };
};

export const nativeHeaders = false;

export const NAVIGATION_BAR_INSETS = { contentInsetAdjustmentBehavior: "automatic" } as const;

export function useNativeHeader(_header: NativeHeader | null) {}
