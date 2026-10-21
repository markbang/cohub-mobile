import { ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import { useAppTheme } from "@/src/theme";
import { NativeMenuItems } from "./NativeMenu.ios";
import type { NativeContextMenuProps } from "./NativeContextMenu";

export type { NativeContextMenuProps } from "./NativeContextMenu";

export const nativeContextMenus = true;

/**
 * iOS: the React Native view becomes the trigger of a SwiftUI context menu, so a long press lifts
 * it as the system does and opens the menu beside it. Taps still reach the view: the hosted view
 * stays inside the React Native surface. The host takes the full width and the view's height.
 */
export function NativeContextMenu({ actions, menu, children }: NativeContextMenuProps) {
  const theme = useAppTheme();
  return <Host matchContents={{ vertical: true }} colorScheme={theme.mode} style={{ alignSelf: "stretch" }}>
    <ContextMenu>
      <ContextMenu.Items><NativeMenuItems actions={actions} menu={menu} /></ContextMenu.Items>
      <ContextMenu.Trigger><RNHostView matchContents={{ vertical: true }}>{children}</RNHostView></ContextMenu.Trigger>
    </ContextMenu>
  </Host>;
}
