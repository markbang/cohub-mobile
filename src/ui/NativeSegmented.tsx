import type { IconName } from "@/src/icons";

export type NativeSegmentOption<T extends string> = { value: T; label: string; icon?: IconName; locked?: boolean };

export type NativeSegmentedProps<T extends string> = {
  options: readonly NativeSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  onLocked?: () => void;
  className?: string;
};

/**
 * Whether the segmented control is the system's. Android draws it (`Segmented` in `src/ui.tsx`);
 * iOS uses UIKit's through `NativeSegmented.ios.tsx`, so this stub never renders.
 */
export const nativeSegmented = false;

export function NativeSegmented<T extends string>(_props: NativeSegmentedProps<T>): null {
  return null;
}
