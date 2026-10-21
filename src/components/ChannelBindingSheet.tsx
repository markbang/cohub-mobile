import type { Channel } from "@neta-art/cohub";
import { Text, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useApp } from "@/src/data/context";
import { useChannelBinding } from "@/src/data/use-channel-binding";
import { useTranslation } from "@/src/i18n";
import { EmptyState, LoadingState, PrimaryButton } from "@/src/ui";

export function ChannelBindingSheet({ channel, onClose, onChanged }: { channel: Channel; onClose: () => void; onChanged: () => void }) {
  const { client } = useApp();
  const { t } = useTranslation();
  const { spaces, loading, saving, error, load, save } = useChannelBinding(client, channel, onChanged);
  // Unbinding is a yes-or-no confirmation; binding picks a Space from a list and stays a sheet.
  if (channel.boundSpace) {
    const boundSpaceId = channel.boundSpace.id;
    return <ConfirmSheet
      visible
      title={t("settings.channels.unbind")}
      subtitle={channel.name}
      message={t("settings.channels.unbindConfirm")}
      confirmLabel={t("settings.channels.unbind")}
      confirmIcon="x"
      busy={saving}
      error={error}
      onConfirm={() => void save(boundSpaceId)}
      onClose={onClose}
    />;
  }
  return <AdaptiveSheet
    visible
    title={t(channel.boundSpace ? "settings.channels.unbind" : "settings.channels.bind")}
    subtitle={channel.name}
    onClose={onClose}
    dismissible={!saving}
    footer={channel.boundSpace ? <PrimaryButton label={t("settings.channels.unbind")} icon="x" variant="danger" loading={saving} onPress={() => void save(channel.boundSpace!.id)} /> : undefined}
  >
    {channel.boundSpace ? <Text className="text-body text-fg">{t("settings.channels.unbindConfirm")}</Text> : loading ? <LoadingState fill={false} /> : <View>
      {spaces.map((space) => <SettingsRow key={space.id} icon="layers" title={space.name || space.id} disabled={saving} onPress={() => void save(space.id)} />)}
      {!spaces.length && !error ? <EmptyState icon="layers" title={t("settings.channels.noSpaces")} /> : null}
    </View>}
    {error ? <View className="gap-3">
      <Text accessibilityRole="alert" className="text-body text-danger">{error}</Text>
      {!channel.boundSpace ? <PrimaryButton label={t("common.retry")} icon="refresh" disabled={saving} onPress={() => void load()} /> : null}
    </View> : null}
  </AdaptiveSheet>;
}
