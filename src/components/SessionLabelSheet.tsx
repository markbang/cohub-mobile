import type { CohubClient, LabelAssignmentRecord } from "@neta-art/cohub";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import {
  attachSessionLabel,
  createSessionLabel,
  detachSessionLabel,
  fetchSessionLabelAssignments,
  fetchSessionLabels,
  formatLabelRef,
  toUserSessionLabels,
  type SessionLabel,
} from "@/src/data/session-labels";
import { createOptimisticWrites } from "@/src/data/optimistic-write";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, FIELD_INPUT_CLASS, Loader, LoadingState } from "@/src/ui";

type SessionLabelSheetProps = {
  client: CohubClient;
  spaceId: string;
  session: { id: string; title?: string | null };
  labels?: SessionLabel[];
  labelsError?: string | null;
  onLabelsReload?: () => void;
  onClose: () => void;
  onChanged: () => void;
};

export function SessionLabelSheet({ client, spaceId, session, labels = [], labelsError = null, onLabelsReload, onClose, onChanged }: SessionLabelSheetProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [fetchedCatalog, setFetchedCatalog] = useState<SessionLabel[]>([]);
  const [assignments, setAssignments] = useState<LabelAssignmentRecord[]>([]);
  const [loading, setLoading] = useState(labels.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [writes] = useState(createOptimisticWrites);
  const [newLabelName, setNewLabelName] = useState("");
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const catalog = fetchedCatalog.length > 0 ? fetchedCatalog : labels;

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setError(null);
      }
    });
    void Promise.all([
      fetchSessionLabels(client, spaceId),
      fetchSessionLabelAssignments(client, spaceId, session.id),
    ])
      .then(([tree, assigned]) => {
        if (!active) return;
        setFetchedCatalog(toUserSessionLabels(tree));
        setAssignments(assigned);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t("labels.error"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, reloadToken, session.id, spaceId, t]);

  const assignedIds = useMemo(() => new Set(assignments.map((item) => item.labelId)), [assignments]);
  const selectable = useMemo(() => catalog.filter((label) => !label.system), [catalog]);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
    onLabelsReload?.();
  }, [onLabelsReload]);

  const toggle = useCallback((label: SessionLabel) => {
    const ref = formatLabelRef(label);
    if (label.system || !ref) return Promise.resolve();
    const assigned = assignedIds.has(label.id);
    setError(null);
    return writes.run(label.id, {
      value: !assigned,
      confirmed: assigned,
      apply: (on) => setAssignments((current) => {
        const rest = current.filter((item) => item.labelId !== label.id);
        return on ? [...rest, { labelId: label.id, labelName: label.name, labelSystemKey: label.systemKey } as LabelAssignmentRecord] : rest;
      }),
      send: async (on) => {
        await (on ? attachSessionLabel : detachSessionLabel)(client, spaceId, ref, session.id);
        return on;
      },
      settled: () => onChanged(),
    }).then(() => undefined, (caught: unknown) => setError(caught instanceof Error ? caught.message : t("labels.updateError")));
  }, [assignedIds, client, onChanged, session.id, spaceId, t, writes]);

  const create = useCallback(async () => {
    const name = newLabelName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createSessionLabel(client, spaceId, name);
      setNewLabelName("");
      const tree = await fetchSessionLabels(client, spaceId);
      const nextCatalog = toUserSessionLabels(tree);
      setFetchedCatalog(nextCatalog);
      onLabelsReload?.();
      const createdLabel = created ? nextCatalog.find((item) => item.id === created.id) ?? created : null;
      if (createdLabel) await toggle(createdLabel);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("labels.createError"));
    } finally {
      setCreating(false);
    }
  }, [client, creating, newLabelName, onLabelsReload, spaceId, t, toggle]);

  return (
    <AdaptiveSheet
      visible
      title={t("labels.title")}
      subtitle={t("labels.subtitle")}
      onClose={onClose}
      testID="session-label-sheet"
      footer={
        <View>
          <Text className="text-caption text-fg-muted mb-2">{t("labels.createSection")}</Text>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <TextInput
                value={newLabelName}
                onChangeText={setNewLabelName}
                placeholder={t("labels.namePlaceholder")}
                placeholderTextColor={theme.colors.textFaint}
                editable={!creating}
                onSubmitEditing={() => void create()}
                className={FIELD_INPUT_CLASS}
              />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("labels.create")} disabled={!newLabelName.trim() || creating} onPress={() => void create()} className={`min-h-12 items-center justify-center rounded-sm px-4 ${!newLabelName.trim() || creating ? "bg-surface-raised opacity-60" : "bg-accent active:bg-accent-pressed"}`}>
              {creating ? <Loader color={theme.colors.accentText} /> : <Text className="text-body font-semibold text-on-accent">{t("common.create")}</Text>}
            </Pressable>
          </View>
        </View>
      }
    >
      {labelsError ? <Pressable accessibilityRole="button" accessibilityLabel={t("labels.retry")} onPress={reload} className="py-2"><Text className="text-caption text-accent">{t("labels.loadFailed")}</Text></Pressable> : null}
      {loading && selectable.length === 0 ? <LoadingState fill={false} /> : selectable.length === 0 ? (
        <Text className="text-caption text-fg-muted py-4">{t("labels.none")}</Text>
      ) : selectable.map((item) => {
        const assigned = assignedIds.has(item.id);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityLabel={t("labels.addTo", { name: item.name })}
            accessibilityState={{ checked: assigned }}
            onPress={() => void toggle(item)}
            className={`min-h-12 flex-row items-center gap-3 rounded-sm px-3 ${assigned ? "bg-accent-soft" : "active:bg-surface-pressed"}`}
          >
            <View className={`size-6 items-center justify-center rounded-xs border-2 ${assigned ? "border-accent bg-accent" : "border-border-strong"}`}>
              {assigned ? <AppIcon name="check" size={16} tone="onAccent" /> : null}
            </View>
            <Text numberOfLines={1} className="text-body font-semibold text-fg flex-1">{item.name}</Text>
          </Pressable>
        );
      })}
      {error ? <Text selectable className="text-micro font-semibold text-danger mt-2">{error}</Text> : null}
    </AdaptiveSheet>
  );
}
