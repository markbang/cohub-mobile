import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { disabled as disabledModifier, labelsHidden, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { SettingsRow } from "@/src/components/SettingsRow";
import { traceAction } from "@/src/data/interaction-trace";
import type { SettingsSelectRowProps } from "./SettingsSelectRow";
import { useAppTheme } from "@/src/theme";

export type { SelectOption, SettingsSelectRowProps } from "./SettingsSelectRow";

/**
 * iOS: the system pop-up button (SwiftUI `Picker` in menu style), so the menu, its Liquid Glass,
 * its spring, and press-and-slide selection are UIKit's own. Android renders the drawn version in
 * `SettingsSelectRow.tsx`; both take the same props.
 */
export function SettingsSelectRow<T extends string>({ icon, title, value, options, onChange, last = false, disabled = false, testID }: SettingsSelectRowProps<T>) {
  const theme = useAppTheme();
  return <SettingsRow icon={icon} title={title} last={last} disabled={disabled}>
    <Host matchContents colorScheme={theme.mode} testID={testID}>
      <Picker<string>
        label={title}
        selection={value}
        onSelectionChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (!option || option.value === value) return;
          traceAction("select_choose", { title, value: option.value });
          onChange(option.value);
        }}
        // The value reads as secondary text, like the detail of any other row; the label is the row's title.
        modifiers={[pickerStyle("menu"), labelsHidden(), tint(theme.colors.textMuted), disabledModifier(disabled)]}
      >
        {options.map((option) => <Text key={option.value} modifiers={[tag(option.value)]}>{option.label}</Text>)}
      </Picker>
    </Host>
  </SettingsRow>;
}
