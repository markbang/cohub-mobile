import type { CohubClient } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useScreenQuery } from "./query";

/**
 * The voice this viewer hears replies in within a Space (`.cohub/speech.json`: Space, then user, then
 * platform), or `null` when none is configured; read aloud is offered only with one.
 */
export function useSpeechVoice(client: CohubClient | null, spaceId: string | null, enabled: boolean): string | null {
  const queryClient = useQueryClient();
  const queryKey = [`space:${spaceId}:speech-voice`];
  const query = useScreenQuery({
    queryKey,
    queryFn: async (): Promise<string | null> => {
      const startup = await client!.space(spaceId!).getStartup();
      // Absent when the server could not read the voice config; the last known voice stands.
      return startup.speechVoice === undefined ? queryClient.getQueryData<string | null>(queryKey) ?? null : startup.speechVoice;
    },
    enabled: enabled && Boolean(client && spaceId),
    staleTime: 5 * 60_000,
  });
  return query.data ?? null;
}
