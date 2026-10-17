import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  getComposerActionState,
  type ComposerActionStateInput,
} from "@/src/data/composer-state";
import { AttachmentMenu } from "@/src/components/AttachmentMenu";
import { ModelSelectorMenu } from "@/src/components/ModelSelectorMenu";
import { useApp } from "@/src/data/context";
import type { ChatModelSelection } from "@/src/data/types";
import { formatThinkingLevel, modelAvailabilityLevel } from "@/src/model-catalog";
import { useAppTheme } from "@/src/theme";
import { ComposerInput, Screen, SectionHeader } from "@/src/ui";

function buildMatrix() {
  const rows: ComposerActionStateInput[] = [];
  for (const text of ["", "hi"]) {
    for (const hasAttachment of [false, true]) {
      for (const disabled of [false, true]) {
        for (const sending of [false, true]) {
          for (const running of [false, true]) {
            for (const hasStopHandler of [false, true]) {
              rows.push({ text, hasAttachment, disabled, sending, running, hasStopHandler });
            }
          }
        }
      }
    }
  }
  return rows;
}

export default function DebugComposerScreen() {
  const theme = useAppTheme();
  const matrix = useMemo(() => buildMatrix(), []);
  const { models, modelsLoading, modelsError, modelStatus, modelStatusLoading, modelStatusError, loadModels, loadModelStatus } = useApp();
  const composerRef = useRef<View>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection | null>(null);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [hasStop, setHasStop] = useState(true);
  const modelLabel = selectedModel?.name ?? selectedModel?.id;
  const modelTriggerLabel = selectedModel?.thinkingLevel ? `${modelLabel} · ${formatThinkingLevel(selectedModel.thinkingLevel)}` : modelLabel;
  const live = getComposerActionState({ text, hasAttachment: attach, disabled, sending, running, hasStopHandler: hasStop });

  return (
    <Screen keyboard>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="交互预览" />
        <View className="px-4 pb-1.5 flex-row flex-wrap gap-2">
          <Toggle label="附件" on={attach} onPress={() => setAttach((v) => !v)} />
          <Toggle label="disabled" on={disabled} onPress={() => setDisabled((v) => !v)} />
          <Toggle label="sending" on={sending} onPress={() => setSending((v) => !v)} />
          <Toggle label="running" on={running} onPress={() => setRunning((v) => !v)} />
          <Toggle label="onStop" on={hasStop} onPress={() => setHasStop((v) => !v)} />
        </View>
        <View className="px-4 pb-2">
          <Text testID="debug.composer.state" selectable className="text-code text-fg-secondary">
            {`blocked=${live.blocked}  hasDraft=${live.hasDraft}  canSend=${live.canSend}  canStop=${live.canStop}`}
          </Text>
        </View>
        <View className="px-4 pb-2 flex-row flex-wrap gap-2">
          <Toggle label="单行" on={text === "Hello"} onPress={() => setText("Hello")} />
          <Toggle label="多行" on={text === "First line\nSecond line\nThird line"} onPress={() => setText("First line\nSecond line\nThird line")} />
          <Toggle label="自动折行" on={text.startsWith("A long draft")} onPress={() => setText("A long draft that wraps across the input width. ".repeat(60))} />
          <Toggle label="清空" on={!text} onPress={() => setText("")} />
        </View>
        <SectionHeader title="状态矩阵（64 种组合）" />
        <Text className="text-caption text-fg-muted mx-4 mb-2">
          列：文本 / A 附件 / D disabled / S sending / R running / H onStop → 结果：B blocked / S canSend / T canStop
        </Text>
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <View className="flex-row items-center border-b py-1.5 border-border bg-surface-raised">
            {["文本", "A", "D", "S", "R", "H", "B", "S", "T"].map((cell) => (
              <Text key={cell} className="flex-1 text-center text-micro text-fg-muted">{cell}</Text>
            ))}
          </View>
          {matrix.map((row, index) => {
            const result = getComposerActionState(row);
            return (
              <View key={index} className={`flex-row items-center border-b border-border py-1.5 ${index % 2 === 0 ? "" : "bg-surface-raised"}`}>
                <Text className={`flex-1 text-center text-micro ${row.text ? "text-fg" : "text-fg-faint"}`} style={MONO}>{row.text || "·"}</Text>
                <Flag on={row.hasAttachment} />
                <Flag on={row.disabled} />
                <Flag on={row.sending} />
                <Flag on={row.running} />
                <Flag on={row.hasStopHandler} />
                <Result on={result.blocked} color={theme.colors.danger} />
                <Result on={result.canSend} color={theme.colors.success} />
                <Result on={result.canStop} color={theme.colors.warning} />
              </View>
            );
          })}
        </View>
      </ScrollView>
      <ComposerInput
        anchorRef={composerRef}
        attachmentMenuOpen={attachmentOpen}
        modelMenuOpen={modelOpen}
        value={text}
        onChangeText={setText}
        onSend={() => { setText(""); setAttach(false); }}
        onStop={hasStop ? () => setRunning(false) : undefined}
        onAttach={() => setAttachmentOpen(true)}
        onVoice={() => setVoiceActive((value) => !value)}
        voiceActive={voiceActive}
        onModelPress={() => { setModelOpen(true); void Promise.all([loadModels(), loadModelStatus()]).catch(() => undefined); }}
        modelLabel={modelTriggerLabel}
        modelStatus={selectedModel ? modelAvailabilityLevel(modelStatus?.models[selectedModel.id]) : "unknown"}
        sending={sending}
        running={running}
        disabled={disabled}
        hasAttachment={attach}
      />
      {attachmentOpen ? <AttachmentMenu anchorRef={composerRef} onClose={() => setAttachmentOpen(false)} onCamera={() => { setAttach(true); setAttachmentOpen(false); }} onPhotos={() => { setAttach(true); setAttachmentOpen(false); }} onFile={() => { setAttach(true); setAttachmentOpen(false); }} /> : null}
      {modelOpen ? <ModelSelectorMenu anchorRef={composerRef} models={models} loading={modelsLoading} error={modelsError || modelStatusError} modelStatus={modelStatus?.models ?? null} modelStatusLoading={modelStatusLoading} currentModel={selectedModel} onClose={() => setModelOpen(false)} onRetry={() => void Promise.all([loadModels({ force: true }), loadModelStatus({ force: true })]).catch(() => undefined)} onSelect={(model) => { setSelectedModel(model); setModelOpen(false); }} /> : null}
    </Screen>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} className={`min-h-8 justify-center rounded-full px-3 ${on ? "bg-accent-soft" : "bg-surface active:bg-surface-pressed"}`}>
      <Text className={`text-caption ${on ? "text-accent" : "text-fg-muted"}`}>{label}</Text>
    </Pressable>
  );
}

function Flag({ on }: { on: boolean }) {
  return <Text className={`flex-1 text-center text-micro ${on ? "text-fg" : "text-fg-faint"}`} style={MONO}>{on ? "1" : "0"}</Text>;
}

function Result({ on, color }: { on: boolean; color: string }) {
  // design-system: the result color is passed in per column by the caller.
  return <Text className={`flex-1 text-center text-micro ${on ? "font-bold" : "font-normal text-fg-faint"}`} style={[MONO, on ? { color } : null]}>{on ? "1" : "0"}</Text>;
}

const MONO = { fontFamily: "SpaceMono" } as const;
