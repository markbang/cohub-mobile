import type { ReactElement } from "react";
import type { NativeMenuAction } from "@/src/components/NativeMenu";

/** What a long press shows above the menu on iOS, read from data already on screen: never a fetch, never the destination screen itself. */
export type ContextMenuPreview = { title: string; subtitle?: string; body?: string; footnote?: string };

export type NativeContextMenuProps = {
  actions: readonly NativeMenuAction[];
  preview?: ContextMenuPreview;
  /** Names the menu in traces. */
  menu: string;
  children: ReactElement;
};

/**
 * Whether long-press menus are the system's. Android opens its drawn menus from each view's own
 * long press; iOS wraps the view in UIKit's context menu (`NativeContextMenu.ios.tsx`), which lifts
 * it into a preview. Here the view renders unchanged.
 */
export const nativeContextMenus = false;

export function NativeContextMenu({ children }: NativeContextMenuProps) {
  return children;
}
