import { Pressable, Text } from "react-native";
import { useTranslation } from "@/src/i18n";
import { Avatar } from "@/src/ui";
import { GlassBackground } from "@/src/ui/Glass";

const CAPSULE = { minHeight: 44, borderRadius: 22, borderCurve: "continuous" } as const;

/** A Bot Chat's title is the Bot itself, on the bar's glass capsule beside the back button, as messaging apps place it; it opens the Bot's profile. */
export function BotTitle({ name, avatarUrl, onPress }: { name: string; avatarUrl?: string | null; onPress: () => void }) {
  const { t } = useTranslation();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("bots.profile.open", { name })} onPress={onPress} className="max-w-full flex-row items-center gap-2 self-start py-0.5 pl-1.5 pr-4 active:opacity-70" style={CAPSULE}>
    <GlassBackground radius={CAPSULE.borderRadius} />
    <Avatar name={name} uri={avatarUrl} size={32} />
    <Text numberOfLines={1} className="min-w-0 shrink text-headline font-semibold text-fg">{name}</Text>
  </Pressable>;
}
