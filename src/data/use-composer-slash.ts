import type { PromptTemplateCatalogEntry, SkillCatalogEntry } from "@neta-art/cohub";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import {
  detectSlashCommandTrigger,
  insertSlashCommand,
  selectSlashCommandItems,
  type SlashCommandItem,
  type SlashCommandTrigger,
} from "@/src/data/slash-commands";

export type SlashCommandMenuState = {
  query: string;
  items: SlashCommandItem[];
  loading: boolean;
  failed: boolean;
};

type Catalog = {
  prompts: PromptTemplateCatalogEntry[];
  skills: SkillCatalogEntry[];
};

/**
 * Composer `/` commands. Detection and insertion are text-only — the server
 * expands `/name` and `/skill:name` when the turn starts — so this hook only
 * loads the two catalogs and keeps the menu state.
 */
export function useComposerSlashCommands({ value, onChange, spaceId, composer }: {
  value: string;
  onChange: (markup: string) => void;
  spaceId: string | null;
  composer: { current: { input: TextInput | null } };
}) {
  const { client } = useAppActions();
  const [focused, setFocused] = useState(false);
  // Set when the user picks a command or closes the menu; cleared by the next edit.
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const trigger = useMemo<SlashCommandTrigger | null>(() => (focused ? detectSlashCommandTrigger(value) : null), [focused, value]);
  const open = trigger !== null && value !== dismissedText;
  // Any edit re-arms a dismissed menu, matching the web composer's slash state.
  if (dismissedText !== null && dismissedText !== value) setDismissedText(null);

  // The account-scoped query cache keeps catalogs per Space for the session; opening the menu loads one.
  const catalogQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:slash-commands`],
    queryFn: async (): Promise<Catalog> => {
      const options = { spaceId: spaceId! };
      const [prompts, skills] = await Promise.all([client!.prompts.list(options), client!.skills.list(options)]);
      return { prompts: prompts.prompts, skills: skills.skills };
    },
    enabled: open && Boolean(client && spaceId),
    staleTime: Infinity,
    retry: 0,
  });
  const scoped = catalogQuery.data ?? null;
  const loading = catalogQuery.isFetching;
  // Missing permission or a network failure leaves typing and sending intact.
  const failed = catalogQuery.isError;

  const menu = useMemo<SlashCommandMenuState | null>(() => {
    if (!open || !trigger) return null;
    return {
      query: trigger.query,
      items: selectSlashCommandItems({ prompts: scoped?.prompts ?? [], skills: scoped?.skills ?? [], query: trigger.query }),
      loading: loading || scoped === null,
      failed,
    };
  }, [failed, loading, open, scoped, trigger]);

  const select = useCallback((item: SlashCommandItem) => {
    const current = valueRef.current;
    const active = detectSlashCommandTrigger(current);
    if (!active) return;
    const result = insertSlashCommand(current, active, item);
    valueRef.current = result.markup;
    setDismissedText(result.markup);
    onChange(result.markup);
    requestAnimationFrame(() => {
      composer.current.input?.focus();
      composer.current.input?.setSelection(result.caret, result.caret);
    });
  }, [composer, onChange]);

  const dismiss = useCallback(() => setDismissedText(valueRef.current), []);
  const onFocusChange = useCallback((next: boolean) => setFocused(next), []);

  return {
    menu,
    select,
    dismiss,
    onFocusChange,
  };
}
