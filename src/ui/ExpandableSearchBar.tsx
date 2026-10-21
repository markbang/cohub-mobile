import { useEffect, useRef, useState } from "react";
import { Keyboard, TextInput } from "react-native";
import { IconButton, TopBar } from "@/src/ui";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

type ExpandableSearchBarProps = {
  title: string;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  queryRef?: React.RefObject<TextInput | null>;
  onCreate: () => void;
  createLabel: string;
  transparent?: boolean;
};

export function ExpandableSearchBar({ title, query, onQueryChange, placeholder, queryRef, onCreate, createLabel, transparent = false }: ExpandableSearchBarProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState(Boolean(query));

  useEffect(() => {
    if (!queryRef) return;
    queryRef.current = inputRef.current;
    return () => { queryRef.current = null; };
  }, [expanded, queryRef]);

  const closeSearch = () => {
    Keyboard.dismiss();
    onQueryChange("");
    setExpanded(false);
  };

  return (
    <TopBar
      transparent={transparent}
      titleHidden={!expanded}
      title={title}
      onBack={expanded ? closeSearch : undefined}
      backLabel={t("ui.search.close")}
      actions={expanded
        ? query ? <IconButton name="x" label={t("ui.search.clear")} onPress={() => { onQueryChange(""); inputRef.current?.focus(); }} /> : undefined
        : <>
          <IconButton filled name="search" label={placeholder ?? t("ui.search.placeholder")} onPress={() => setExpanded(true)} />
          <IconButton filled name="plus" label={createLabel} tone="accent" onPress={onCreate} />
        </>}
    >
      {expanded ? <TextInput
        ref={inputRef}
        autoFocus
        accessibilityLabel={placeholder ?? t("ui.search.placeholder")}
        value={query}
        onChangeText={onQueryChange}
        placeholder={placeholder ?? t("ui.search.placeholder")}
        placeholderTextColor={theme.colors.textFaint}
        className="min-h-11 px-0 py-2 text-body text-fg"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      /> : undefined}
    </TopBar>
  );
}
