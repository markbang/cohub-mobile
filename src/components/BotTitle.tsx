import { Text, View } from "react-native";
import { Avatar } from "@/src/ui";
import { GlassBackground } from "@/src/ui/Glass";

const CAPSULE = { minHeight: 44, borderRadius: 22, borderCurve: "continuous" } as const;

/** A Bot Chat's title: the Bot's face and name, with the Chat under it, on the bar's glass capsule. */
export function BotTitle({ name, avatarUrl, subtitle }: { name: string; avatarUrl?: string | null; subtitle?: string }) {
  return <View accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${name}, ${subtitle}` : name} className="max-w-full flex-row items-center gap-2 self-center py-0.5 pl-1.5 pr-4" style={CAPSULE}>
    <GlassBackground radius={CAPSULE.borderRadius} />
    <Avatar name={name} uri={avatarUrl} size={32} />
    <View className="min-w-0 shrink">
      <Text numberOfLines={1} className="text-headline font-semibold text-fg">{name}</Text>
      {subtitle ? <Text numberOfLines={1} className="text-caption text-fg-muted">{subtitle}</Text> : null}
    </View>
  </View>;
}
