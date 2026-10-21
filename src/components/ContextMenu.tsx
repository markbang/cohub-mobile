import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type IconName } from "@/src/ui";
import { PopoverSurface } from "@/src/ui/PopoverSurface";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";
import { RADIUS } from "@/src/design/tokens";

const MIN_MENU_WIDTH = 180;
const MAX_MENU_WIDTH = 280;
const ROW_HEIGHT = 48;

export type ContextMenuAction = {
  icon: IconName;
  title: string;
  onPress: () => void;
};

export function ContextMenu({
  visible,
  x,
  y,
  actions,
  onClose,
  testID,
}: {
  visible: boolean;
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const material = useGlassMaterial();
  const { width, height } = useWindowDimensions();
  const menuHeight = actions.length * ROW_HEIGHT + 8;
  const contentWidth = Math.max(...actions.map((action) => Array.from(action.title).length * 9 + 14 * 2 + 18 + 10), 0);
  const menuWidth = Math.min(width - 24, Math.max(MIN_MENU_WIDTH, Math.min(MAX_MENU_WIDTH, contentWidth)));
  const left = Math.min(Math.max(12, x - menuWidth / 2), Math.max(12, width - menuWidth - 12));
  const top = Math.min(
    Math.max(insets.top + 8, y - menuHeight - 16),
    Math.max(insets.top + 8, height - insets.bottom - menuHeight - 12),
  );
  // Grow from the touch: from the bottom edge when the menu sits above the finger, else from the top.
  const originX = Math.min(Math.max(x - left, 0), menuWidth);
  const originY = top + menuHeight <= y ? menuHeight : 0;

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View className="flex-1" testID={testID}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <PopoverSurface key={`${x}:${y}`} accessibilityRole="menu" origin={[originX, originY, 0]} className={`absolute overflow-hidden rounded-md py-1 ${material === "liquid" ? "" : "shadow-float"}`} style={{ top, left, width: menuWidth, borderCurve: "continuous" }}>
        <GlassBackground radius={RADIUS.md} />
        {actions.map((action) => (
          <Pressable
            key={action.title}
            accessibilityRole="menuitem"
            accessibilityLabel={action.title}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            className="min-h-12 flex-row items-center gap-2.5 px-3.5 active:bg-surface-pressed"
          >
            <AppIcon name={action.icon} size={18} tone="secondary" />
            <Text className="text-body font-semibold text-fg">{action.title}</Text>
          </Pressable>
        ))}
      </PopoverSurface>
    </View>
  </Modal>;
}
