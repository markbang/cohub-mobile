import { ContextMenu, Host, RNHostView, Text, VStack, type RNHostViewProps } from "@expo/ui/swift-ui";
import { useState, type ComponentType } from "react";
import { View, useWindowDimensions, type ViewStyle } from "react-native";
import { font, foregroundStyle, frame, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { useAppTheme } from "@/src/theme";
import { NativeMenuItems } from "./NativeMenu.ios";
import type { ContextMenuPreview, NativeContextMenuProps } from "./NativeContextMenu";

export type { ContextMenuPreview, NativeContextMenuProps } from "./NativeContextMenu";

export const nativeContextMenus = true;

/**
 * iOS: the React Native view becomes the trigger of a SwiftUI context menu, so a long press lifts
 * it as the system does and opens the menu beside it. Taps still reach the view: the hosted view
 * stays inside the React Native surface. The host takes the full width and the view's height.
 *
 * The hosted view measures its React Native content with no width limit unless it carries a width
 * itself (expo-modules-core's hosted-content constraints read only its own style), so a row with a long
 * line would lay out wider than the screen and push its trailing parts off. It gets the width React
 * Native gives the host: the window's on the first frame, as for full-width rows, then the measured one.
 */
export function NativeContextMenu({ actions, menu, preview, children }: NativeContextMenuProps) {
  const theme = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState<number | null>(null);
  return <View style={STRETCH} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <Host matchContents={{ vertical: true }} colorScheme={theme.mode} style={STRETCH}>
      <ContextMenu>
        <ContextMenu.Items><NativeMenuItems actions={actions} menu={menu} /></ContextMenu.Items>
        {preview ? <ContextMenu.Preview><MenuPreview {...preview} /></ContextMenu.Preview> : null}
        <ContextMenu.Trigger><SizedHostView matchContents={VERTICAL} style={{ width: width ?? windowWidth }}>{children}</SizedHostView></ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  </View>;
}

// RNHostView forwards its other props to the native view, `style` included; its type omits it.
const SizedHostView = RNHostView as ComponentType<RNHostViewProps & { style?: ViewStyle }>;
const VERTICAL = { vertical: true } as const;
const STRETCH = { alignSelf: "stretch" } as const;

// Peeking is how a list is read without opening each item: what the row truncates, at reading width.
function MenuPreview({ title, subtitle, body, footnote }: ContextMenuPreview) {
  const { colors } = useAppTheme();
  return <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 16 }), frame({ width: 320, alignment: "leading" })]}>
    <Text modifiers={[font({ textStyle: "headline" }), foregroundStyle(colors.text), lineLimit(2)]}>{title}</Text>
    {subtitle ? <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(colors.textMuted), lineLimit(1)]}>{subtitle}</Text> : null}
    {body ? <Text modifiers={[font({ textStyle: "body" }), foregroundStyle(colors.textSecondary), lineLimit(8)]}>{body}</Text> : null}
    {footnote ? <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.textFaint), lineLimit(1)]}>{footnote}</Text> : null}
  </VStack>;
}
