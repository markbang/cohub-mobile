import type { AppDetailResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { AppHostWebView } from "@/src/components/AppHostWebView";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { openWebLink } from "@/src/platform/browser";
import { useTranslation } from "@/src/i18n";
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
      subtitle={detail?.space.name || t("work.published")} 
      onBack={() => router.back()} 
      actions={detail || contentUrl ? (
        <>
          {detail && <IconButton name="settings" label={t("app.manage.title")} size={40} onPress={() => router.push({ pathname: "/work/[appId]/edit", params: { appId: detail.app.id } })} />}
          {contentUrl && <IconButton name="external-link" label={t("file.openExternally")} size={40} onPress={() => void openWebLink(contentUrl).catch(() => undefined)} />}
        </>
      ) : undefined} 
    />
    {error ? <DataError message={error} onRetry={() => void detailQuery.refetch()} /> : null}
    {!detail ? (error ? null : <LoadingState />) : !contentUrl || !initialOrigin ? <View className="flex-1 items-center justify-center p-6"><Text className="text-body text-fg-muted text-center">{t("work.noContent")}</Text></View> : <AppHostWebView detail={detail} contentUrl={contentUrl} />}
  </Screen>;
}
