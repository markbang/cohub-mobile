import type { Channel, CohubClient, SpaceRecord } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";
import { listAllSpaces } from "./space-list";

export function useChannelBinding(client: CohubClient | null, channel: Channel, onChanged: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const spacesQuery = useScreenQuery({
    queryKey: ["space-list", "all"],
    queryFn: (): Promise<SpaceRecord[]> => listAllSpaces(client!),
    enabled: Boolean(client) && !channel.boundSpace,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadError = !client ? t("settings.channels.connect") : spacesQuery.error ? spacesQuery.error.message || t("settings.channels.bindingError") : null;

  const save = async (spaceId: string): Promise<void> => {
    if (!client || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (channel.boundSpace) await client.space(channel.boundSpace.id).channels.unbind(channel.id);
      else await client.space(spaceId).channels.bind(channel.id);
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      onChanged();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : t("settings.channels.bindingError"));
    } finally {
      setSaving(false);
    }
  };
  return {
    spaces: spacesQuery.data ?? [],
    loading: Boolean(client) && !channel.boundSpace && spacesQuery.isPending,
    saving,
    error: saveError ?? loadError,
    load: async () => { setSaveError(null); await spacesQuery.refetch(); },
    save,
  };
}
