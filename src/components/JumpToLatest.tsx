import { Pressable, Text, View } from "react-native";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Loader } from "@/src/ui";
import { GlassBackground } from "@/src/ui/Glass";

/** The Chat's jump to the newest message, shown once the timeline is no longer following the tail. `unread` counts the replies it reveals. */
export function JumpToLatest({ busy, unread, onPress }: { busy: boolean; unread: number; onPress: () => void }) {
  const { t } = useTranslation();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("chat.jumpLatest")} accessibilityState={{ busy, disabled: busy }} accessibilityValue={unread > 0 ? { text: String(unread) } : undefined} disabled={busy} onPress={onPress} className="size-11 items-center justify-center rounded-full shadow-float active:opacity-70"><GlassBackground radius={22} />{busy ? <Loader /> : <AppIcon name="arrow-down" size={18} tone="accent" />}{unread > 0 && !busy ? <View className="absolute -top-1 -right-1 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1"><Text className="text-micro font-semibold text-on-accent">{unread > 99 ? "99+" : String(unread)}</Text></View> : null}</Pressable>;
}
