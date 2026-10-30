import { Button, Host, HStack, Image, Menu, Section, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled as disabledModifier, font, foregroundStyle, lineLimit } from "@expo/ui/swift-ui/modifiers";
import { traceAction } from "@/src/data/interaction-trace";
import { SF_SYMBOLS } from "@/src/sf-symbols";
import { useAppTheme } from "@/src/theme";
import { liquidGlass } from "@/src/ui/Glass";
import type { NativeMenuAction, NativeMenuButtonProps } from "./NativeMenu";

export type { NativeMenuAction, NativeMenuButtonProps, NativeMenuSection } from "./NativeMenu";

/** iOS menus are UIKit's pull-down menus: Liquid Glass, the spring out of the button, press-and-slide. */
export const nativeMenus = true;

export function NativeMenuItems({ actions, menu }: { actions: readonly NativeMenuAction[]; menu: string }) {
  return <>
    {actions.map((action) => <Button
      key={action.title}
      // A checked item shows the system check in place of its glyph, as iOS pickers do.
      systemImage={action.checked ? "checkmark" : SF_SYMBOLS[action.icon]}
      onPress={() => { traceAction("menu_item", { menu, item: action.title }); action.onPress(); }}
      modifiers={action.disabled ? [disabledModifier(true)] : undefined}
      label={action.detail ? undefined : action.title}
    >
      {action.detail ? [<Text key="title">{action.title}</Text>, <Text key="detail">{action.detail}</Text>] : undefined}
    </Button>)}
  </>;
}

export function NativeMenuButton({ icon, label, title, actions = [], sections, appearance, active = false, disabled = false, testID }: NativeMenuButtonProps) {
  const theme = useAppTheme();
  const symbol = SF_SYMBOLS[icon];
  const menu = testID ?? label;
  // Bar and composer buttons are glass like the rest of the chrome; a plain one is a bare glyph.
  const shape = appearance === "plain"
    ? [buttonStyle("borderless")]
    : appearance === "chip"
      ? [buttonStyle(liquidGlass ? "glass" : "bordered"), buttonBorderShape("capsule")]
      : [buttonStyle(liquidGlass ? "glass" : "bordered"), buttonBorderShape("circle"), controlSize("large")];
  const color = active ? theme.colors.accent : appearance === "plain" ? theme.colors.textMuted : theme.colors.text;
  const trigger = appearance === "chip"
    ? <HStack spacing={4}>
      <Text modifiers={[font({ textStyle: "footnote", weight: "medium" }), foregroundStyle(color), lineLimit(1)]}>{title ?? label}</Text>
      <Image systemName="chevron.down" size={11} color={theme.colors.textMuted} />
    </HStack>
    : <Image systemName={symbol} size={appearance === "control" ? 20 : 17} color={color} />;
  return <Host matchContents colorScheme={theme.mode}>
    <Menu label={trigger} testID={testID} modifiers={[...shape, accessibilityLabel(label), disabledModifier(disabled)]}>
      {sections
        ? sections.map((section, index) => <Section key={section.title ?? index} title={section.title}><NativeMenuItems actions={section.actions} menu={menu} /></Section>)
        : <NativeMenuItems actions={actions} menu={menu} />}
    </Menu>
  </Host>;
}
