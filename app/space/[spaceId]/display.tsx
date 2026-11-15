import type { DisplayInfo, DisplayInputEvent } from "@neta-art/cohub";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RemoteDisplay } from "@/src/components/RemoteDisplay";
import { useToast } from "@/src/components/Toast";
import { useAppActions } from "@/src/data/context";
import { createInputQueue, DISPLAY_QUALITIES, type InputQueue, typedEvents, withModifiers, type DisplayModifier, type DisplayQuality } from "@/src/data/display-control";
import type { DisplayTouchMode } from "@/src/data/display-touch";
import { useScreenQuery } from "@/src/data/query";
import { useDisplayFrames, type DisplayFrameError } from "@/src/data/use-display-frames";
import { useTranslation, type Translate, type TranslationKey } from "@/src/i18n";
import { isAppActive, subscribeAppActive } from "@/src/platform/app-lifecycle";
import { haptics } from "@/src/platform/haptics";
import { FIELD_INPUT_CLASS, IconButton, LoadingState, PrimaryButton, Screen, Segmented, TopBar } from "@/src/ui";
import { useScreenVisible } from "@/src/ui/pane";

type Params = { spaceId?: string; displayId?: string };

const DISPLAY_REFRESH_MS = 10_000;
const INPUT_ERROR_COOLDOWN_MS = 5_000;

const MODIFIER_LABELS: Record<"macos" | "windows" | "other", Record<DisplayModifier, string>> = {
  macos: { Meta: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧" },
  windows: { Control: "Ctrl", Alt: "Alt", Meta: "Win", Shift: "Shift" },
  other: { Control: "Ctrl", Alt: "Alt", Meta: "Super", Shift: "Shift" },
};

const KEYS: readonly { key: string; label: string; a11y?: TranslationKey }[] = [
  { key: "Escape", label: "Esc" },
  { key: "Tab", label: "Tab" },
  { key: "Backspace", label: "⌫", a11y: "display.key.backspace" },
  { key: "Enter", label: "⏎", a11y: "display.key.enter" },
  { key: "ArrowLeft", label: "←", a11y: "display.key.left" },
  { key: "ArrowUp", label: "↑", a11y: "display.key.up" },
  { key: "ArrowDown", label: "↓", a11y: "display.key.down" },
  { key: "ArrowRight", label: "→", a11y: "display.key.right" },
  { key: "Home", label: "Home" },
  { key: "End", label: "End" },
  { key: "PageUp", label: "PgUp" },
  { key: "PageDown", label: "PgDn" },
  { key: "Delete", label: "Del" },
  ...Array.from({ length: 12 }, (_, index) => ({ key: `F${index + 1}`, label: `F${index + 1}` })),
];

export default function DisplayScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { client } = useAppActions();
  const params = useLocalSearchParams<Params>();
  const spaceId = params.spaceId ?? "";
  const displayId = params.displayId ?? "";
  const visible = useScreenVisible();
  const active = useAppActive();

  const displaysQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:displays`],
    queryFn: () => client!.space(spaceId).displays.list(),
    enabled: Boolean(client && spaceId),
    intervalMs: DISPLAY_REFRESH_MS,
  });
  const display: DisplayInfo | null = displaysQuery.data?.displays.find((item) => item.id === displayId) ?? null;
  const gone = displaysQuery.isSuccess && !display;

  const [mode, setMode] = useState<DisplayTouchMode>("touch");
  const [quality, setQuality] = useState<DisplayQuality>("balanced");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [modifiers, setModifiers] = useState<DisplayModifier[]>([]);

  const frames = useDisplayFrames({ client, spaceId, displayId, quality, enabled: visible && active && Boolean(displayId) && display?.capture !== false && !gone });
  const controllable = Boolean(display?.input) && !display?.needs?.includes("accessibility");

  const { kick, noteInput } = frames;
  const queue = useRef<InputQueue | null>(null);
  useEffect(() => {
    if (!client || !spaceId || !displayId) return;
    let lastError = 0;
    const created = createInputQueue(
      (events) => client.space(spaceId).displays.input(displayId, events),
      (error) => {
        const now = Date.now();
        if (now - lastError < INPUT_ERROR_COOLDOWN_MS) return;
        lastError = now;
        toast({ title: t("display.inputFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
      },
      kick,
    );
    queue.current = created;
    return () => {
      created.close();
      if (queue.current === created) queue.current = null;
    };
  }, [client, displayId, kick, spaceId, t, toast]);

  const send = useCallback((events: DisplayInputEvent[]) => {
    noteInput();
    queue.current?.push(events);
  }, [noteInput]);

  const pressKey = (key: string) => {
    haptics.selection();
    send(withModifiers(modifiers, [{ type: "key", action: "press", key }]));
    setModifiers([]);
  };
  const typeText = (text: string) => {
    if (!text) return;
    send(typedEvents(text, modifiers));
    setModifiers([]);
  };
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    if (!text) {
      toast({ title: t("display.pasteEmpty") });
      return;
    }
    send(typedEvents(text, []));
  };
  const toggleModifier = (key: DisplayModifier) => {
    haptics.selection();
    setModifiers((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const title = display ? display.kind === "agent" ? t("display.agentScreen") : display.name || display.id : t("display.title");
  const subtitle = frames.stats ? t("display.stats", { fps: frames.stats.fps.toFixed(frames.stats.fps < 10 ? 1 : 0), ms: String(frames.stats.latencyMs) }) : undefined;
  const notice = display ? displayNotice(display, t) : null;
  const platformLabels = MODIFIER_LABELS[display?.platform === "macos" || display?.platform === "windows" ? display.platform : "other"];
  const modifierOrder: DisplayModifier[] = display?.platform === "macos" ? ["Meta", "Control", "Alt", "Shift"] : ["Control", "Alt", "Meta", "Shift"];

  return <Screen keyboard>
    <TopBar title={title} subtitle={subtitle} onBack={() => router.back()} />
    {notice ? <Text className="px-4 py-2 text-caption text-fg-muted">{notice}</Text> : null}
    <View className="flex-1">
      {display && display.capture !== false ? <RemoteDisplay
        frame={frames.frame}
        width={display.width}
        height={display.height}
        mode={mode}
        controllable={controllable}
        fineScroll={display.platform === "macos"}
        modifiers={modifiers}
        onModifiersUsed={() => setModifiers([])}
        send={send}
        accessibilityLabel={t("display.surface")}
      /> : null}
      <Overlay
        loading={!frames.frame && !frames.error && !gone && display?.capture !== false}
        error={gone ? { code: "display_not_found", message: "", fatal: true } : display?.capture === false ? { code: "display_unsupported", message: "", fatal: true } : displaysQuery.error && !display ? { code: null, message: displaysQuery.error.message, fatal: true } : frames.error}
        hasFrame={Boolean(frames.frame)}
        onRetry={() => { frames.retry(); void displaysQuery.refetch(); }}
      />
    </View>
    {keyboardOpen && controllable ? <View className="border-t border-border bg-background">
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-3 py-2">
        {modifierOrder.map((key) => <KeyChip key={key} label={platformLabels[key]} accessibilityLabel={key} active={modifiers.includes(key)} onPress={() => toggleModifier(key)} />)}
        <View className="w-px self-stretch bg-border mx-1" />
        {KEYS.map((item) => <KeyChip key={item.key} label={item.label} accessibilityLabel={item.a11y ? t(item.a11y) : item.label} onPress={() => pressKey(item.key)} />)}
      </ScrollView>
      <TypeField placeholder={t("display.typePlaceholder")} sendLabel={t("display.typeSend")} onText={typeText} onKey={pressKey} />
    </View> : null}
    <View className="flex-row items-center gap-2 border-t border-border bg-background px-3 pt-2" style={{ paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 8) }}>
      <Segmented<DisplayTouchMode>
        className="flex-1"
        value={mode}
        onChange={setMode}
        disabled={!controllable}
        options={[{ value: "touch", label: t("display.mode.touch") }, { value: "trackpad", label: t("display.mode.trackpad") }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("display.quality.label", { quality: t(`display.quality.${quality}`) })}
        onPress={() => { haptics.selection(); setQuality(DISPLAY_QUALITIES[(DISPLAY_QUALITIES.indexOf(quality) + 1) % DISPLAY_QUALITIES.length]); }}
        hitSlop={8}
        className="min-h-8 justify-center rounded-full bg-surface-raised px-3 active:bg-surface-pressed"
      >
        <Text className="text-caption font-medium text-fg">{t(`display.quality.${quality}`)}</Text>
      </Pressable>
      <IconButton name="copy" label={t("display.paste")} disabled={!controllable} onPress={() => void paste()} />
      <IconButton name="type" label={t("display.keyboard")} tone={keyboardOpen ? "active" : "default"} disabled={!controllable} onPress={() => setKeyboardOpen((open) => !open)} />
    </View>
  </Screen>;
}

function useAppActive() {
  const [active, setActive] = useState(isAppActive);
  useEffect(() => subscribeAppActive(setActive), []);
  return active;
}

function displayNotice(display: DisplayInfo, t: Translate): string | null {
  if (display.needs?.includes("screenRecording")) return t("display.needs.screenRecording");
  if (display.needs?.includes("accessibility")) return t("display.needs.accessibility");
  if (!display.input) return t("display.viewOnly");
  if (display.handover && !display.held) return t("display.handover", { reason: display.handover.reason });
  if (display.activity) return display.activity.label ? t("display.activityLabel", { label: display.activity.label }) : t("display.activity");
  return null;
}

function errorText(error: DisplayFrameError, t: Translate): string {
  switch (error.code) {
    case "sandbox_offline": return t("display.offline");
    case "display_not_found": return t("display.gone");
    case "display_unsupported": return t("display.unsupported");
    case "display_unavailable": return t("display.unavailable");
    case "forbidden": return t("display.forbidden");
    default: return error.message || t("display.failed");
  }
}

function Overlay({ loading, error, hasFrame, onRetry }: { loading: boolean; error: DisplayFrameError | null; hasFrame: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (loading) return <View pointerEvents="none" className="absolute inset-0"><LoadingState label={t("display.connecting")} /></View>;
  if (!error) return null;
  // Over a live frame a transient error stays a strip; the last frame remains readable under it.
  if (hasFrame && !error.fatal) return <View pointerEvents="none" className="absolute left-3 right-3 top-3 rounded-sm bg-danger-soft px-3 py-2"><Text numberOfLines={2} className="text-caption text-danger">{errorText(error, t)}</Text></View>;
  return <View className="absolute inset-0 items-center justify-center gap-4 bg-background p-6">
    <Text selectable className="text-center text-body text-fg-muted">{errorText(error, t)}</Text>
    {error.code === "forbidden" || error.code === "display_unsupported" ? null : <PrimaryButton label={t("common.retry")} icon="refresh" variant="secondary" onPress={onRetry} />}
  </View>;
}

function KeyChip({ label, accessibilityLabel, active = false, onPress }: { label: string; accessibilityLabel: string; active?: boolean; onPress: () => void }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ selected: active }}
    onPress={onPress}
    className={`min-h-9 min-w-10 items-center justify-center rounded-sm px-2.5 ${active ? "bg-accent-soft" : "bg-surface-raised active:bg-surface-pressed"}`}
    style={{ borderCurve: "continuous" }}
  >
    <Text className={`text-subhead font-medium ${active ? "text-accent" : "text-fg"}`}>{label}</Text>
  </Pressable>;
}

/**
 * Text is sent as a whole on Return, so an input method's composition (pinyin, kana) never reaches
 * the computer half-typed. Return or Backspace on an empty field press those keys on the computer.
 */
function TypeField({ placeholder, sendLabel, onText, onKey }: { placeholder: string; sendLabel: string; onText: (text: string) => void; onKey: (key: string) => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (draft) {
      onText(draft);
      setDraft("");
    } else onKey("Enter");
  };
  return <View className="flex-row items-center gap-2 px-3 pb-2">
    <TextInput
      autoFocus
      value={draft}
      onChangeText={setDraft}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="send"
      submitBehavior="submit"
      onSubmitEditing={submit}
      onKeyPress={(event) => { if (event.nativeEvent.key === "Backspace" && !draft) onKey("Backspace"); }}
      className={`${FIELD_INPUT_CLASS} flex-1`}
    />
    <IconButton name="arrow-up" label={sendLabel} tone="accent" onPress={submit} />
  </View>;
}
