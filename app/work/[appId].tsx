import type { AppDetailResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { AppHostWebView } from "@/src/components/AppHostWebView";
import { useAppActions } from "@/src/data/context";
import { createOptimisticWrites } from "@/src/data/optimistic-write";
import { useScreenQuery } from "@/src/data/query";
import { openWebLink } from "@/src/platform/browser";
import { useTranslation } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { DataError, TopBar, IconButton, LoadingState, Screen } from "@/src/ui";

type Params = { appId?: string | string[] };

export default function WorkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const appId = Array.isArray(params.appId) ? params.appId[0] : params.appId;
  const { t } = useTranslation();
  const { client } = useAppActions();
  const detailQuery = useScreenQuery({
    queryKey: [`app:${appId}:detail`],
    queryFn: (): Promise<AppDetailResponse> => client!.apps.get(appId!),
    enabled: Boolean(client && appId),
  });
  const detail = detailQuery.data ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const likedQuery = useScreenQuery({
    queryKey: [`app:${appId}:liked`],
    queryFn: () => client!.user.likes.isLiked("app", appId!),
    enabled: Boolean(client && appId),
  });
  const liked = likedQuery.data ?? false;
  const [writes] = useState(createOptimisticWrites);
  // The heart flips at once; the count follows the server's answer, never a guess past a failure.
  const toggleLike = () => {
    if (!client || !appId || likedQuery.data === undefined) return;
    void writes.run(appId, {
      value: !liked,
      confirmed: liked,
      apply: (value) => queryClient.setQueryData([`app:${appId}:liked`], value),
      send: (value) => client.user.likes.set("app", appId, value),
      settled: (value, from) => {
        if (value !== from) queryClient.setQueryData<AppDetailResponse>([`app:${appId}:detail`], (current) => current && { ...current, likeCount: Math.max(0, (current.likeCount ?? 0) + (value ? 1 : -1)) });
      },
    }).catch((caught: unknown) => toast({ title: t("work.like.failed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" }));
  };
  const likeCount = detail?.likeCount ?? null;
  const fundable = detail?.space.publicProfile?.fundingEnabled === true;
  const error = detailQuery.error ? detailQuery.error.message || t("work.error") : null;
  const contentUrl = detail?.content?.url ?? null;
  const initialOrigin = useMemo(() => {
    if (!contentUrl) return null;
    try { return new URL(contentUrl).origin; } catch { return null; }
  }, [contentUrl]);

  const title = detail?.app.meta?.title || detail?.app.meta?.name || detail?.app.slug || t("work.fallbackTitle");
  return <Screen>
    <TopBar 
      title={title} 
      subtitle={[detail?.space.name || t("work.published"), likeCount ? t("work.likes", { count: likeCount }) : null].filter(Boolean).join(" · ")} 
      onBack={() => router.back()} 
      actions={detail || contentUrl ? (
        <>
          {detail && <IconButton name={liked ? "heart-fill" : "heart"} tone={liked ? "accent" : "default"} label={liked ? t("work.unlike") : t("work.like")} size={40} disabled={likedQuery.data === undefined} onPress={toggleLike} />}
          {detail && fundable ? <IconButton name="wallet" label={t("wallet.fund.title", { space: detail.space.name || t("space.fallbackName") })} size={40} onPress={() => router.push({ pathname: "/space/[spaceId]/fund", params: { spaceId: detail.space.id } })} /> : null}
          {detail && <IconButton name="settings" label={t("app.manage.title")} size={40} onPress={() => router.push({ pathname: "/work/[appId]/edit", params: { appId: detail.app.id } })} />}
          {contentUrl && <IconButton name="external-link" label={t("file.openExternally")} size={40} onPress={() => void openWebLink(contentUrl).catch(() => undefined)} />}
        </>
      ) : undefined} 
    />
    {error ? <DataError message={error} onRetry={() => void detailQuery.refetch()} /> : null}
    {!detail ? (error ? null : <LoadingState />) : !contentUrl || !initialOrigin ? <View className="flex-1 items-center justify-center p-6"><Text className="text-body text-fg-muted text-center">{t("work.noContent")}</Text></View> : <AppHostWebView detail={detail} contentUrl={contentUrl} />}
  </Screen>;
}
