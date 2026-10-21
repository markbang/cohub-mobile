import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { disabled as disabledModifier, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import { traceAction } from "@/src/data/interaction-trace";
import { useAppTheme } from "@/src/theme";
import type { NativeSegmentedProps } from "./NativeSegmented";

export type { NativeSegmentOption, NativeSegmentedProps } from "./NativeSegmented";

/** iOS segments are UIKit's segmented control: Liquid Glass on iOS 26, and its own drag between segments. */
export const nativeSegmented = true;

export function NativeSegmented<T extends string>({ options, value, onChange, disabled = false, onLocked, className = "" }: NativeSegmentedProps<T>) {
  const theme = useAppTheme();
  return <View className={className}>
    <Host matchContents={{ vertical: true }} colorScheme={theme.mode} style={{ alignSelf: "stretch" }}>
      <Picker<string>
        selection={value}
        onSelectionChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (!option || option.value === value) return;
          traceAction("segment", { label: option.label, value: option.value, selected: false, locked: Boolean(option.locked) });
          // A locked segment cannot refuse the tap natively: the selection stays bound to `value`, so it
          // springs back while the owner explains why.
          if (option.locked) { onLocked?.(); return; }
          onChange(option.value);
        }}
        modifiers={[pickerStyle("segmented"), disabledModifier(disabled)]}
      >
        {options.map((option) => <Text key={option.value} modifiers={[tag(option.value)]}>{option.label}</Text>)}
      </Picker>
    </Host>
  </View>;
}
