import { harnessLabel, type ApprovalDecision, type CohubClient, type HarnessKind, type SessionApproval } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useScreenQuery } from "@/src/data/query";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { motion } from "@/src/motion";
import { AppIcon, PrimaryButton } from "@/src/ui";

const DECISIONS: Record<ApprovalDecision, { label: TranslationKey; variant: "primary" | "secondary" | "danger" }> = {
  accept: { label: "runtime.approval.accept", variant: "primary" },
  accept_for_session: { label: "runtime.approval.acceptForSession", variant: "secondary" },
  decline: { label: "runtime.approval.decline", variant: "danger" },
};

const MONO = { fontFamily: "SpaceMono" } as const;

type Approvals = { approvals: SessionApproval[]; canDecide: boolean };

/**
 * A local Harness asking to run a command or change files during this Chat's Turn. Anyone who may
 * decide answers here; the Runtime declines on its own once a request expires.
 */
export function SessionApprovals({ client, spaceId, sessionId, running, harnessOf }: { client: CohubClient | null; spaceId: string; sessionId: string; running: boolean; harnessOf: (turnId: string) => HarnessKind }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = [`session:${sessionId}:approvals`];
  // Realtime announces changes; while a Turn runs a slow poll covers a missed event.
  const query = useScreenQuery({
    queryKey: key,
    queryFn: (): Promise<Approvals> => client!.space(spaceId).getSessionApprovals(sessionId),
    enabled: Boolean(client && spaceId && sessionId),
    intervalMs: running ? 10_000 : undefined,
  });
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const approvals = (query.data?.approvals ?? []).filter((approval) => Date.parse(approval.expiresAt) > now);
  const nextExpiry = Math.min(...approvals.map((approval) => Date.parse(approval.expiresAt)));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  if (approvals.length === 0) return null;

  const decide = async (approval: SessionApproval, decision: ApprovalDecision) => {
    if (!client || deciding) return;
    setDeciding(approval.id);
    setError(null);
    try {
      await client.space(spaceId).decideApproval(sessionId, approval.id, decision);
      queryClient.setQueryData<Approvals>(key, (current) => current && { ...current, approvals: current.approvals.filter((item) => item.id !== approval.id) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("runtime.approval.failed"));
      void query.refetch();
    } finally {
      setDeciding(null);
    }
  };

  return <Animated.View exiting={FadeOut.duration(motion.fadeOut.duration)} className="gap-2 bg-background px-3 pt-2">
    {approvals.map((approval) => {
      const title = t(approval.kind === "command" ? "runtime.approval.command" : "runtime.approval.fileChange", { harness: harnessLabel(harnessOf(approval.turnId)) });
      return <View key={approval.id} accessibilityLabel={title} className="gap-2 rounded-md bg-surface-raised p-3" style={{ borderCurve: "continuous" }}>
        <View className="flex-row items-center gap-2">
          <AppIcon name={approval.kind === "command" ? "terminal" : "file-text"} size={16} tone="muted" />
          <Text className="min-w-0 flex-1 text-subhead font-semibold text-fg">{title}</Text>
        </View>
        {approval.command ? <ScrollView style={{ maxHeight: 96 }} className="rounded-sm bg-surface px-2.5 py-1.5"><Text selectable className="text-code text-fg-secondary" style={MONO}>{approval.command}</Text></ScrollView> : null}
        {approval.paths?.length ? <ScrollView style={{ maxHeight: 72 }}>{approval.paths.map((path) => <Text key={path} selectable numberOfLines={1} ellipsizeMode="middle" className="text-code text-fg-secondary" style={MONO}>{path}</Text>)}</ScrollView> : null}
        {approval.reason || approval.cwd ? <Text selectable className="text-caption text-fg-muted">{[approval.reason, approval.cwd].filter(Boolean).join(" · ")}</Text> : null}
        {query.data?.canDecide
          ? <View className="flex-row flex-wrap gap-2">{approval.decisions.map((decision) => <PrimaryButton key={decision} label={t(DECISIONS[decision].label)} variant={DECISIONS[decision].variant} loading={deciding === approval.id && decision === "accept"} disabled={deciding !== null} onPress={() => void decide(approval, decision)} className="min-h-11 px-3" />)}</View>
          : <Text accessibilityRole="text" className="text-caption text-fg-muted">{t("runtime.approval.waiting")}</Text>}
      </View>;
    })}
    {error ? <Text accessibilityRole="alert" selectable className="px-1 text-caption text-danger">{error}</Text> : null}
  </Animated.View>;
}
