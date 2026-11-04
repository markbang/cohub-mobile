import type { ReactNode } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
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
  search?: { query: string; onQueryChange: (query: string) => void; placeholder: string; pinned?: boolean };
  close?: { label: string; onPress: () => void };
};

export const nativeHeaders = false;

export const NAVIGATION_BAR_INSETS = { contentInsetAdjustmentBehavior: "automatic" } as const;

export function useNativeHeader(_header: NativeHeader | null) {}

export type EmptyListFill = { onLayout?: (event: LayoutChangeEvent) => void; style: ViewStyle | undefined };

/** Lets an empty tab-root list centre its empty state in the visible area. Android lists start below a drawn header, so they just grow. */
export function useEmptyListFill(empty: boolean): EmptyListFill {
  return { style: empty ? EMPTY_FILL : undefined };
}

const EMPTY_FILL = { flexGrow: 1 } as const;
