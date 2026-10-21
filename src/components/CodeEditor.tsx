import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import {
  getCachedHighlightedCode,
  highlightCode,
  highlightCodeSync,
  type CodeHighlightTheme,
  type HighlightedCode,
} from "@/src/data/code-highlight";
import type { CodeLanguageId } from "@/src/data/code-language";
import { useTranslation } from "@/src/i18n";
import { typography, useAppTheme } from "@/src/theme";

const HIGHLIGHT_DEBOUNCE_MS = 160;
// Synchronous tokenization keeps the highlight in lockstep with typing for
// ordinary files; larger files fall back to the debounced async pass.
const SYNC_HIGHLIGHT_CHARS = 12_000;
const MEASURE_CHARACTERS = "0000000000";
const TAB_COLUMNS = 8;
const PADDING_HORIZONTAL = 12;
const PADDING_VERTICAL = 10;

function visualColumns(line: string) {
  let columns = 0;
  for (const character of line) {
    if (character === "\t") columns += TAB_COLUMNS - (columns % TAB_COLUMNS);
    else columns += 1;
  }
  return columns;
}

// The spans become the TextInput's own text, so they must spell `value` exactly or the native
// input would replace the user's text with the tokenizer's.
function renderLines(highlighted: HighlightedCode | null, value: string, fallbackColor: string): ReactNode {
  const lines = highlighted?.lines;
  if (!lines || lines.map((line) => line.map((token) => token.content).join("")).join("\n") !== value) return value;
  const nodes: ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    nodes.push(
      <Text key={lineIndex}>
        {line.map((token, tokenIndex) => {
          const fontStyle = token.fontStyle ?? 0;
          return (
            <Text
              key={tokenIndex}
              style={{
                color: token.color ?? fallbackColor,
                ...(fontStyle & 1 ? { fontStyle: "italic" as const } : null),
                ...(fontStyle & 2 ? { fontWeight: "700" as const } : null),
                ...(fontStyle & 4 ? { textDecorationLine: "underline" as const } : null),
                ...(fontStyle & 8 ? { textDecorationLine: "line-through" as const } : null),
              }}
            >
              {token.content}
            </Text>
          );
        })}
      </Text>,
    );
    if (lineIndex < lines.length - 1) nodes.push("\n");
  });
  return nodes;
}

export function CodeEditor({
  value,
  onChangeText,
  language,
  highlightTheme,
  onCaretChange,
}: {
  value: string;
  onChangeText: (value: string) => void;
  language: CodeLanguageId | null;
  highlightTheme: CodeHighlightTheme;
  /** The caret's top edge in content coordinates, so the editor can be scrolled above the keyboard. */
  onCaretChange?: (y: number) => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [charWidth, setCharWidth] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [asyncHighlight, setAsyncHighlight] = useState<{ value: string; result: HighlightedCode } | null>(null);

  const syncHighlight = useMemo(() => {
    if (!language || value.length > SYNC_HIGHLIGHT_CHARS) return null;
    const cached = getCachedHighlightedCode(value, language, highlightTheme);
    if (cached) return cached;
    return highlightCodeSync(value, language, highlightTheme);
  }, [highlightTheme, language, value]);
  const highlighted = syncHighlight ?? (asyncHighlight?.value === value ? asyncHighlight.result : null);

  useEffect(() => {
    if (!language || syncHighlight) return;
    let active = true;
    const timer = setTimeout(() => {
      void highlightCode(value, language, highlightTheme).then((result) => {
        if (active && result) setAsyncHighlight({ value, result });
      }).catch(() => undefined);
    }, value.length <= SYNC_HIGHLIGHT_CHARS ? 0 : HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [highlightTheme, language, syncHighlight, value]);

  const lines = value.split("\n");
  const lineCount = lines.length;
  const gutterWidth = charWidth > 0 ? Math.ceil(String(lineCount).length * charWidth) + 16 : 28;
  const maxColumns = lines.reduce((max, line) => Math.max(max, visualColumns(line)), 1);
  const contentWidth = charWidth > 0 ? maxColumns * charWidth + PADDING_HORIZONTAL * 2 + charWidth : undefined;
  const codeWidth = contentWidth === undefined ? Math.max(0, availableWidth - gutterWidth) : Math.max(availableWidth - gutterWidth, contentWidth);
  const editorHeight = lineCount * typography.code.lineHeight + PADDING_VERTICAL * 2;
  const metrics: TextStyle = {
    fontFamily: "SpaceMono",
    fontSize: typography.code.fontSize,
    lineHeight: typography.code.lineHeight,
    includeFontPadding: false,
    padding: 0,
    margin: 0,
  };
  const gutter = lines.map((_, index) => String(index + 1)).join("\n");
  const lineStarts = useMemo(() => {
    const starts = [0];
    for (let index = 0; index < value.length; index += 1) {
      if (value.charCodeAt(index) === 10) starts.push(index + 1);
    }
    return starts;
  }, [value]);

  const handleSelectionChange = (event: { nativeEvent: { selection: { start: number } } }) => {
    if (!onCaretChange) return;
    const offset = event.nativeEvent.selection.start;
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    onCaretChange(PADDING_VERTICAL + low * typography.code.lineHeight);
  };

  const measureCharacter = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setCharWidth(width / MEASURE_CHARACTERS.length);
  };

  return (
    <View onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)} className="self-stretch">
      <Text
        numberOfLines={1}
        onLayout={measureCharacter}
        accessible={false}
        pointerEvents="none"
        style={[metrics, { position: "absolute", top: 0, left: 0, opacity: 0 }]}
      >
        {MEASURE_CHARACTERS}
      </Text>
      <View className="flex-row items-start">
        {/* Kept outside the scroller: focusing the input must not scroll the line numbers out of view. */}
        <Text
          selectable={false}
          accessible={false}
          // design-system: the gutter shares the input's measured JS metrics so line numbers stay aligned.
          style={[metrics, { width: gutterWidth, textAlign: "right", paddingRight: 8, paddingTop: PADDING_VERTICAL, color: theme.colors.textFaint }]}
        >
          {gutter}
        </Text>
        <ScrollView style={{ flex: 1 }} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ width: codeWidth, height: editorHeight, overflow: "hidden" }}>
            <TextInput
              multiline
              onChangeText={onChangeText}
              onSelectionChange={handleSelectionChange}
              scrollEnabled={false}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              textContentType="none"
              textAlignVertical="top"
              selectionColor={theme.colors.accent}
              cursorColor={theme.colors.accent}
              underlineColorAndroid="transparent"
              accessibilityLabel={t("code.editor")}
              // design-system: the input shares the gutter's measured JS metrics; spans override the color per token.
              style={[metrics, { width: "100%", height: editorHeight, paddingHorizontal: PADDING_HORIZONTAL, paddingVertical: PADDING_VERTICAL, color: theme.colors.text }]}
            >
              {renderLines(highlighted, value, theme.colors.text)}
            </TextInput>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
