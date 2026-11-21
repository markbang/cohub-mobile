import { Pressable } from "react-native";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Loader } from "@/src/ui";
import { GlassBackground } from "@/src/ui/Glass";

/** The Chat's jump to the newest message, shown once the timeline is no longer following the tail. */
export function JumpToLatest({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("chat.jumpLatest")} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onPress} className="size-11 items-center justify-center rounded-full shadow-float active:opacity-70"><GlassBackground radius={22} />{busy ? <Loader /> : <AppIcon name="arrow-down" size={18} tone="accent" />}</Pressable>;
}
