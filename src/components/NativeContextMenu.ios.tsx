import { ContextMenu, Host, RNHostView, Text, VStack } from "@expo/ui/swift-ui";
import { useState } from "react";
import { View } from "react-native";
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
 * SwiftUI proposes no width to a context menu's trigger, so the hosted view would lay out at its ideal
 * width: a long row then runs past the screen and pushes its trailing time off. The row is pinned to
 * the width React Native gives the host.
 */
export function NativeContextMenu({ actions, menu, preview, children }: NativeContextMenuProps) {
  const theme = useAppTheme();
  const [width, setWidth] = useState<number | null>(null);
  return <View style={STRETCH} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <Host matchContents={{ vertical: true }} colorScheme={theme.mode} style={STRETCH}>
      <ContextMenu>
        <ContextMenu.Items><NativeMenuItems actions={actions} menu={menu} /></ContextMenu.Items>
        {preview ? <ContextMenu.Preview><MenuPreview {...preview} /></ContextMenu.Preview> : null}
        <ContextMenu.Trigger><RNHostView matchContents={{ vertical: true }}><View style={width === null ? null : { width }}>{children}</View></RNHostView></ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  </View>;
}

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
