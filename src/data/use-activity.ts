import type { BillingCreditStatus, UserActivityResponse } from "@neta-art/cohub";
import { useCallback } from "react";
import { useAppActions } from "./context";
import { activityRange } from "./activity";
import { useScreenQuery } from "./query";

type Resource<T> = { data: T | null; error: string | null };
const ACTIVITY_POLL_INTERVAL_MS = 60_000;
const failure = (error: Error | null) => error ? error.message || "Unable to load activity. Please retry." : null;

export function useActivity() {
  const { client } = useAppActions();
  const credits = useScreenQuery({
    queryKey: ["activity", "credits"],
    queryFn: (): Promise<BillingCreditStatus> => client!.billing.getCredits(),
    enabled: Boolean(client),
    intervalMs: ACTIVITY_POLL_INTERVAL_MS,
  });
  const activity = useScreenQuery({
    queryKey: ["activity", "usage"],
    queryFn: (): Promise<UserActivityResponse> => client!.user.getActivity(activityRange(new Date())),
    enabled: Boolean(client),
    intervalMs: ACTIVITY_POLL_INTERVAL_MS,
  });
  const refetchCredits = credits.refetch;
  const refetchActivity = activity.refetch;
  const refresh = useCallback(async () => { await Promise.all([refetchCredits(), refetchActivity()]); }, [refetchActivity, refetchCredits]);
  return {
    credits: { data: credits.data ?? null, error: failure(credits.error) } satisfies Resource<BillingCreditStatus>,
    activity: { data: activity.data ?? null, error: failure(activity.error) } satisfies Resource<UserActivityResponse>,
    loading: credits.isFetching || activity.isFetching,
    refresh,
  };
}
