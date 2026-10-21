import { ModelIcon, modelMappings } from "@lobehub/icons-rn";
import type { ModelCatalogEntry, ModelStatusEntry } from "@neta-art/cohub";
import { useMemo, useState, type RefObject } from "react";
import { LegendList } from "@legendapp/list/react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ComposerMenu } from "@/src/components/ComposerMenu";
import type { ChatModelSelection } from "@/src/data/types";
import {
  clampThinkingLevel,
  formatThinkingLevel,
  formatThinkingLevelShort,
  getDefaultThinkingLevel,
  getSupportedThinkingLevels,
  modelAvailabilityLabel,
  modelAvailabilityLevel,
  modelContextLabel,
  modelCostLabel,
  modelDisplayName,
  modelSupportsVision,
  type ModelAvailabilityLevel,
} from "@/src/model-catalog";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, IconButton, Loader } from "@/src/ui";

export type ModelSelectorMenuProps = {
  anchorRef: RefObject<View | null>;
  models: ModelCatalogEntry[];
  loading: boolean;
  error: string | null;
  modelStatus?: Record<string, ModelStatusEntry> | null;
  modelStatusLoading?: boolean;
  currentModel: ChatModelSelection | null;
  title?: string;
  automaticLabel?: string;
  automaticDetail?: string;
  onClose: () => void;
  onRetry: () => void;
  onSelect: (model: ChatModelSelection | null) => void;
};

function statusColor(level: ModelAvailabilityLevel, theme: ReturnType<typeof useAppTheme>) {
  switch (level) {
    case "available": return theme.colors.success;
    case "degraded": return theme.colors.warning;
    case "outage": return theme.colors.danger;
    case "unknown": return theme.colors.textFaint;
  }
}

function ModelStatusDot({ status }: { status: ModelStatusEntry | null }) {
  const theme = useAppTheme();
  const level = modelAvailabilityLevel(status);
  const color = statusColor(level, theme);
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />;
}

function modelIconModel(entry: ModelCatalogEntry) {
  const id = modelIconLookupId(entry.id);
  const prefixed = `${entry.provider}/${id}`;
  const matches = (value: string) => modelMappings.some((item) => item.keywords.some((keyword) => new RegExp(keyword, "i").test(value)));
  if (matches(id)) return id;
  return matches(prefixed) ? prefixed : null;
}

// LobeHub treats any "gpt-5" substring as the GPT-5 pink avatar. GPT-5.6+ should use the generic ChatGPT mark, same as gpt-6.
function modelIconLookupId(id: string) {
  return /gpt-5\.(?:[6-9]|\d{2,})/i.test(id) ? "openai" : id;
}

function ModelBrandMark({ entry }: { entry: ModelCatalogEntry }) {
  const model = modelIconModel(entry);
  return model ? <ModelIcon model={model} type="avatar" size={23} shape="square" /> : <AppIcon name={modelSupportsVision(entry) ? "images" : "sparkles"} size={17} tone="muted" />;
}

function makeSelection(entry: ModelCatalogEntry, level?: ChatModelSelection["thinkingLevel"]): ChatModelSelection {
  return { provider: entry.provider, id: entry.id, name: modelDisplayName(entry), ...(level ? { thinkingLevel: level } : {}) };
}

export function ModelSelectorMenu({ anchorRef, models, loading, error, modelStatus = null, modelStatusLoading = false, currentModel, title, automaticLabel, automaticDetail, onClose, onRetry, onSelect }: ModelSelectorMenuProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [optionsOpenFor, setOptionsOpenFor] = useState<string | null>(null);

  const visibleModels = useMemo(() => {
    const exact = query.trim();
    const needle = exact.toLowerCase();
    // Hidden models stay resolvable by an exact id (mirrors the web picker), and the
    // current selection stays visible so reopening the picker can keep or clear it.
    const revealedHidden = models.filter(
      (entry) =>
        entry.model?.hidden === true &&
        (entry.id === exact ||
          (currentModel?.provider === entry.provider && currentModel.id === entry.id)),
    );
    const filtered = [
      ...models.filter((entry) => entry.model?.hidden !== true),
      ...revealedHidden,
    ].filter((entry) => !needle || [entry.provider, entry.id, modelDisplayName(entry)].some((value) => value.toLowerCase().includes(needle)));
    if (!needle && currentModel) {
      filtered.sort((left, right) => {
        const leftCurrent = left.provider === currentModel.provider && left.id === currentModel.id;
        const rightCurrent = right.provider === currentModel.provider && right.id === currentModel.id;
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        return `${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`);
      });
    }
    return filtered;
  }, [currentModel, models, query]);

  // LegendList memoizes each row on [item, extraData], so state read by renderModel
  // outside `data` must flow through extraData or the expanded settings panel never renders.
  const rowExtraData = useMemo(
    () => ({ currentModel, modelStatus, optionsOpenFor, t, theme }),
    [currentModel, modelStatus, optionsOpenFor, t, theme],
  );

  const isCurrent = (entry: ModelCatalogEntry) => currentModel?.provider === entry.provider && currentModel.id === entry.id;
  const selectEntry = (entry: ModelCatalogEntry, level?: ChatModelSelection["thinkingLevel"]) => {
    onSelect(makeSelection(entry, level));
    setOptionsOpenFor(null);
  };

  const renderModel = ({ item: entry }: { item: ModelCatalogEntry }) => {
    const selected = isCurrent(entry);
    const key = `${entry.provider}/${entry.id}`;
    const levels = getSupportedThinkingLevels(entry);
    const selectedLevel = selected && currentModel?.thinkingLevel ? clampThinkingLevel(entry, currentModel.thinkingLevel) : getDefaultThinkingLevel(entry);
    const optionsOpen = optionsOpenFor === key;
    const context = modelContextLabel(entry);
    const cost = modelCostLabel(entry);
    const summary = [entry.provider, context].filter(Boolean).join(" · ");
    return <View className={`mb-0.5 rounded-sm ${selected ? "bg-surface-raised" : ""}`}>
      <View className="flex-row items-center">
        <Pressable testID={`model-option-${entry.provider}-${entry.id}`} accessibilityRole="radio" accessibilityLabel={`${t("model.use", { name: modelDisplayName(entry) })}, ${modelAvailabilityLabel(modelAvailabilityLevel(modelStatus?.[entry.id]))}`} accessibilityState={{ checked: selected }} onPress={() => selectEntry(entry, levels.length > 1 ? selectedLevel : undefined)} className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2.5 rounded-sm py-2 pl-2.5 pr-1 active:bg-surface-pressed">
          <View className="w-7 h-7 items-center justify-center"><ModelBrandMark entry={entry} /></View>
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="text-body font-semibold text-fg">{modelDisplayName(entry)}</Text>
            <View className="flex-row items-center gap-1"><ModelStatusDot status={modelStatus?.[entry.id] ?? null} /><Text numberOfLines={1} className="text-caption text-fg-muted flex-1">{summary}</Text></View>
          </View>
          <View className="w-5 h-5 items-center justify-center">{selected ? <AppIcon name="check" size={18} tone="fg" /> : null}</View>
        </Pressable>
        <Pressable testID={`model-settings-${entry.provider}-${entry.id}`} accessibilityRole="button" accessibilityLabel={t("model.options", { name: modelDisplayName(entry) })} accessibilityState={{ expanded: optionsOpen }} onPress={() => setOptionsOpenFor(optionsOpen ? null : key)} className={`size-11 items-center justify-center rounded-sm ${optionsOpen ? "bg-surface-pressed" : "active:bg-surface-pressed"}`}>
          <AppIcon name="settings" size={18} tone={optionsOpen ? "accent" : "muted"} />
        </Pressable>
      </View>
      {optionsOpen ? <View testID={`model-details-${entry.provider}-${entry.id}`} className="border-t mx-2 py-2 gap-1 border-border">
        <Text className="text-body font-semibold text-fg">{modelDisplayName(entry)}</Text>
        <Text selectable className="text-caption text-fg-muted">{entry.provider} · {entry.id}</Text>
        {context ? <Text className="text-caption text-fg-muted">{context}</Text> : null}
        {cost ? <Text className="text-caption text-fg-muted">{cost}</Text> : null}
        {levels.length > 1 ? <>
          <Text className="text-caption text-fg-secondary mt-1">{t("model.thinking", { level: formatThinkingLevel(selectedLevel) })}</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">{levels.map((level) => { const active = level === selectedLevel; return <Pressable key={level} accessibilityRole="radio" accessibilityLabel={t("model.useThinking", { level: formatThinkingLevel(level) })} accessibilityState={{ checked: active }} onPress={() => selectEntry(entry, level)} className={`min-h-11 justify-center rounded-sm px-3 ${active ? "bg-accent-soft" : "active:bg-surface-pressed"}`}><Text className={`text-caption ${active ? "text-accent" : "text-fg-muted"}`}>{formatThinkingLevelShort(level)}</Text></Pressable>; })}</ScrollView>
        </> : null}
      </View> : null}
    </View>;
  };

  return <ComposerMenu anchorRef={anchorRef} title={title ?? t("model.title")} onClose={onClose} preferredWidth={360} fillHeight testID="chat-model-selector-menu">
    <View className="min-h-13 flex-row items-center gap-2 pl-4 pr-1.5 border-b border-border">
      <AppIcon name="search" size={18} tone="muted" />
      <TextInput accessibilityLabel={t("model.search")} value={query} onChangeText={setQuery} placeholder={t("model.search")} placeholderTextColor={theme.colors.textFaint} className="text-body flex-1 min-w-0 text-fg py-2" returnKeyType="search" autoCorrect={false} autoCapitalize="none" />
      {loading || modelStatusLoading ? <Loader color={theme.colors.textMuted} /> : null}
      {query ? <IconButton name="circle-x" label={t("ui.search.clear")} size={36} onPress={() => setQuery("")} /> : <IconButton name="x" label={t("ui.sheet.close", { title: t("model.title") })} size={36} onPress={onClose} />}
    </View>
    <LegendList
      estimatedItemSize={56}
      extraData={rowExtraData}
      data={visibleModels}
      keyExtractor={(entry) => `${entry.provider}/${entry.id}`}
      renderItem={renderModel}
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ padding: 6 }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="always"
            ListHeaderComponent={<>
        <Pressable testID="model-option-automatic" accessibilityRole="radio" accessibilityLabel={automaticLabel ?? t("model.automaticA11y")} accessibilityState={{ checked: currentModel === null }} onPress={() => { onSelect(null); setOptionsOpenFor(null); }} className={`mb-0.5 min-h-14 flex-row items-center gap-2.5 rounded-sm px-2.5 py-2 ${currentModel === null ? "bg-surface-raised" : "active:bg-surface-pressed"}`}>
          <View className="w-7 h-7 items-center justify-center"><AppIcon name="sparkles" size={22} tone="secondary" /></View>
          <View className="flex-1 min-w-0"><Text className="text-body font-semibold text-fg">{automaticLabel ?? t("model.automatic")}</Text><Text numberOfLines={1} className="text-caption text-fg-muted">{automaticDetail ?? t("model.automaticDetail")}</Text></View>
          <View className="w-5 h-5 items-center justify-center">{currentModel === null ? <AppIcon name="check" size={18} tone="fg" /> : null}</View>
        </Pressable>
        {error ? <View className="flex-row items-center gap-2 p-2"><Text className="text-caption text-danger flex-1">{error}</Text><IconButton name="refresh" label={t("model.retry")} onPress={onRetry} disabled={loading || modelStatusLoading} /></View> : null}
      </>}
      ListEmptyComponent={error && !loading ? null : <View className="min-h-25 items-center justify-center p-4">
        {loading ? <Loader color={theme.colors.textMuted} /> : <AppIcon name="search" size={22} tone="muted" />}
        <Text className="text-caption text-fg-muted text-center mt-2">{t(loading ? "model.loading" : "model.noMatch")}</Text>
      </View>}
    />
  </ComposerMenu>;
}
