import type { CohubClient, UserAppFilter, UserAppListItem, UserCronJobFilter, UserCronJobListItem } from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { cronSummaryText, formatRunTime } from "@/src/components/ScheduleForm";
import { SettingsRow } from "@/src/components/SettingsRow";
import { summarizeCron } from "@/src/data/cron";
import { usePagedQuery } from "@/src/data/query";
import { useTranslation } from "@/src/i18n";
import { DataError, EmptyState, ListEdgeLoader, LoadingState, PrimaryButton, Segmented, SettingsGroup } from "@/src/ui";

const PAGE_SIZE = 50;

function appTitle(app: UserAppListItem): string {
  return app.meta?.title?.trim() || app.meta?.name?.trim() || app.slug;
}

/** Every App the viewer can manage, across Spaces, as the web Library lists them. */
export function AppsSection({ client }: { client: CohubClient | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [filter, setFilter] = useState<UserAppFilter>("mine");
  const list = usePagedQuery<UserAppListItem>({
    queryKey: ["library:apps", filter],
    enabled: Boolean(client),
    id: (app) => app.id,
    fetchPage: async (cursor) => {
      const page = await client!.user.listApps({ filter, limit: PAGE_SIZE, cursor });
      return { items: page.items, cursor: page.pageInfo.hasMore ? page.pageInfo.nextCursor : null };
    },
  });
  const options = useMemo(() => [
    { value: "mine" as const, label: t("library.filter.mine") },
    { value: "all" as const, label: t("library.filter.all") },
    { value: "disabled" as const, label: t("library.apps.filter.disabled") },
  ], [t]);
  return <LibraryList
    filter={<Segmented options={options} value={filter} onChange={setFilter} />}
    list={list}
    emptyTitle={t("library.apps.empty")}
    emptyIcon="box"
    connectError={!client ? t("settings.channels.connect") : null}
    renderRow={(app, last) => <SettingsRow
      key={app.id}
      icon="box"
      title={appTitle(app)}
      value={[app.space.name, app.status === "disabled" ? t("library.apps.disabled") : null].filter(Boolean).join(" · ")}
      onPress={() => router.push({ pathname: "/work/[appId]", params: { appId: app.id } })}
      last={last}
    />}
  />;
}

/** Every schedule the viewer created or can manage, across Spaces. */
export function SchedulesSection({ client }: { client: CohubClient | null }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [filter, setFilter] = useState<UserCronJobFilter>("mine");
  const list = usePagedQuery<UserCronJobListItem>({
    queryKey: ["library:schedules", filter],
    enabled: Boolean(client),
    id: (job) => job.id,
    fetchPage: async (cursor) => {
      const page = await client!.user.listCronJobs({ filter, limit: PAGE_SIZE, cursor });
      return { items: page.items, cursor: page.pageInfo.hasMore ? page.pageInfo.nextCursor : null };
    },
  });
  const options = useMemo(() => [
    { value: "mine" as const, label: t("library.filter.mine") },
    { value: "all" as const, label: t("library.filter.all") },
    { value: "paused" as const, label: t("library.schedules.filter.paused") },
    { value: "attention" as const, label: t("library.schedules.filter.attention") },
  ], [t]);
  const status = (job: UserCronJobListItem) => {
    if (job.access === "lost") return t("library.schedules.lost");
    if (job.lastRun?.status === "failed") return t("library.schedules.lastFailed");
    if (!job.enabled) return t("library.schedules.paused");
    return job.nextRunAt ? `${t("space.settings.schedule.nextRun")}: ${formatRunTime(new Date(job.nextRunAt), job.timezone, locale)}` : null;
  };
  return <LibraryList
    filter={<Segmented options={options} value={filter} onChange={setFilter} />}
    list={list}
    emptyTitle={t("library.schedules.empty")}
    emptyIcon="calendar-clock"
    connectError={!client ? t("settings.channels.connect") : null}
    renderRow={(job, last) => {
      const spaceId = job.space?.id ?? job.spaceId;
      return <SettingsRow
        key={job.id}
        icon="clock"
        title={job.title || t("space.settings.schedule.unnamed")}
        value={[job.space?.name, cronSummaryText(summarizeCron(job.cronExpression), job.cronExpression, t), status(job)].filter(Boolean).join(" · ")}
        // A schedule lost from its Space is managed from the web, where its creator can still pause or delete it.
        onPress={spaceId && job.access === "full" ? () => router.push({ pathname: "/space/[spaceId]/schedule/[jobId]", params: { spaceId, jobId: job.id } }) : undefined}
        last={last}
      />;
    }}
  />;
}

function LibraryList<T>({ filter, list, emptyTitle, emptyIcon, connectError, renderRow }: {
  filter: React.ReactNode;
  list: ReturnType<typeof usePagedQuery<T>>;
  emptyTitle: string;
  emptyIcon: "box" | "calendar-clock";
  connectError: string | null;
  renderRow: (item: T, last: boolean) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const items = list.items;
  const error = connectError ?? (list.query.error ? list.query.error.message || t("library.loadFailed") : null);
  return <View className="gap-4 pt-4">
    <View className="px-4">{filter}</View>
    {error ? <DataError message={error} onRetry={() => void list.query.refetch()} />
      : !items ? <LoadingState fill={false} label={t("settings.loading")} />
      : items.length === 0 ? <EmptyState icon={emptyIcon} title={emptyTitle} />
      : <SettingsGroup>{items.map((item, index) => renderRow(item, index === items.length - 1 && !list.hasMore))}</SettingsGroup>}
    {items && list.hasMore ? list.loadingMore ? <ListEdgeLoader label={t("library.loadingMore")} /> : <View className="px-4">
      <PrimaryButton label={list.loadMoreError ? t("common.retry") : t("library.loadMore")} icon={list.loadMoreError ? "refresh" : "chevron-down"} variant="secondary" onPress={() => void list.loadMore().catch(() => undefined)} />
    </View> : null}
  </View>;
}
