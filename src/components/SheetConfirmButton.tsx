import { View } from "react-native";
import { IconButton, Loader } from "@/src/ui";

export type SheetConfirm = { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };

/** The trailing slot of a sheet's bar: the confirm, or an empty 44 pt slot that keeps the title centred. */
export function SheetConfirmButton({ confirm }: { confirm?: SheetConfirm }) {
  if (!confirm) return <View className="size-11" />;
  if (confirm.loading) return <View accessible accessibilityRole="progressbar" accessibilityLabel={confirm.label} className="size-11 items-center justify-center"><Loader /></View>;
  return <IconButton filled tone="accent" name="check" label={confirm.label} disabled={confirm.disabled} onPress={confirm.onPress} />;
}
