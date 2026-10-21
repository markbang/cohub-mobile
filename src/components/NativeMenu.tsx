import type { AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import type { IconName } from "@/src/icons";

export type NativeMenuSection = { title?: string; actions: readonly NativeMenuAction[] };
/** A menu item; `checked` draws the system check, `detail` a second line under the title. */
export type NativeMenuAction = AnchoredMenuAction & { checked?: boolean; detail?: string };

export type NativeMenuButtonProps = {
  icon: IconName;
  label: string;
  actions?: readonly NativeMenuAction[];
  /** Groups shown with headers and separators, in place of `actions`. */
  sections?: readonly NativeMenuSection[];
  /**
   * `bar`: a top-bar button; `control`: a composer control; `plain`: a bare glyph in content;
   * `chip`: a composer capsule that shows `title` and a disclosure chevron.
   */
  appearance: "bar" | "control" | "plain" | "chip";
  title?: string;
  /** Marks a filter that is on (an accent glyph). */
  active?: boolean;
  disabled?: boolean;
  testID?: string;
};

/**
 * Whether menus are the system's. Android draws them (`AnchoredActionMenu`, `ComposerMenu`); iOS
 * uses UIKit's pull-down menu through `NativeMenu.ios.tsx`, so this stub never renders.
 */
export const nativeMenus = false;

export function NativeMenuButton(_props: NativeMenuButtonProps): null {
  return null;
}
