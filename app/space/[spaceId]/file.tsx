import * as Clipboard from "expo-clipboard";
import type { SpaceFsFileResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { AnchoredActionMenu } from "@/src/components/AnchoredActionMenu";
import { CodeBlock } from "@/src/components/CodeBlock";
import { CodeEditor } from "@/src/components/CodeEditor";
import { detectCodeLanguage } from "@/src/data/code-language";
import { classifySaveConflict, isEditableTextFile, isFileConflictError, MAX_EDITABLE_CODE_BYTES } from "@/src/data/code-file";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { typography, useAppTheme } from "@/src/theme";
import { AppIcon, TopBar, IconButton, Loader, LoadingRows, PrimaryButton, Screen } from "@/src/ui";

type Params = { spaceId?: string | string[]; path?: string | string[] };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default function FileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const spaceId = firstParam(params.spaceId);
  const path = Array.isArray(params.path) ? params.path.join("/") : params.path ?? "";
  const theme = useAppTheme();
  const { t } = useTranslation();
  const showToast = useToast();
  const { client } = useApp();
  const [file, setFile] = useState<SpaceFsFileResponse | null>(null);
  const requestIdRef = useRef(0);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pathMenuOpen, setPathMenuOpen] = useState(false);
  const pathTitleRef = useRef<View>(null);
  const editorScrollRef = useRef<ScrollView>(null);
  const editorMetrics = useRef<{ viewport: number; offset: number; caretY: number | null }>({ viewport: 0, offset: 0, caretY: null });

  // Keep the caret above the keyboard; the vertical scroller does not follow a nested input on its own.
  const revealEditorCaret = useCallback(() => {
    const { viewport, offset, caretY } = editorMetrics.current;
    if (!viewport || caretY === null) return;
    const lineHeight = typography.code.lineHeight;
    const bottom = caretY + lineHeight;
    if (bottom + lineHeight > offset + viewport) {
      editorScrollRef.current?.scrollTo({ y: bottom + lineHeight - viewport, animated: true });
    } else if (caretY - lineHeight < offset) {
      editorScrollRef.current?.scrollTo({ y: Math.max(0, caretY - lineHeight), animated: true });
    }
  }, []);

  const loadFile = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!client || !spaceId || !path) {
      setFile(null);
      setUrl(null);
      setLoading(false);
      setError(!spaceId ? t("file.spaceUnavailable") : !path ? t("file.pathMissing") : t("file.connect"));
      return;
    }

    setLoading(true);
    setError(null);
    setFile(null);
    setUrl(null);
    setDraft(null);
    setSaveError(null);
    setConflict(false);
    try {
      const result = await client.space(spaceId).files.read(path);
      if (requestId !== requestIdRef.current) return;
      if ("content" in result) {
        setFile(result);
        if (result.delivery === "url" && result.url) setUrl(result.url);
      } else {
        setError(t("file.preparing"));
      }
    } catch (caught) {
      if (requestId === requestIdRef.current) setError(caught instanceof Error ? caught.message : t("file.openError"));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [client, path, spaceId, t]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadFile();
    });
    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, [loadFile, retryToken]);

  const language = detectCodeLanguage(path);
  const inlineContent = file && file.kind === "text" && file.delivery !== "url" ? file.content : null;
  const editing = draft !== null;
  const dirty = editing && file !== null && draft !== file.content;
  const editable = isEditableTextFile(file);

  useEffect(() => {
    if (!editing) return;
    const metrics = editorMetrics.current;
    const subscription = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", revealEditorCaret);
    return () => {
      subscription.remove();
      metrics.caretY = null;
    };
  }, [editing, revealEditorCaret]);

  const exitEditing = useCallback(() => {
    setDraft(null);
    setSaveError(null);
    setConflict(false);
  }, []);

  const handleBack = useCallback(() => {
    if (saving) return;
    if (!editing) {
      router.back();
      return;
    }
    if (!dirty) {
      exitEditing();
      return;
    }
    Alert.alert(t("file.discard.title"), t("file.discard.body"), [
      { text: t("file.discard.keep"), style: "cancel" },
      { text: t("file.discard.confirm"), style: "destructive", onPress: exitEditing },
    ]);
  }, [dirty, editing, exitEditing, router, saving, t]);

  // Editing is in-screen state: system back and swipe-back cancel it just like the toolbar.
  usePreventRemove(editing || saving, handleBack);

  const save = useCallback(async (force = false) => {
    if (!client || !spaceId || !path || !file || draft === null) return;
    const content = draft;
    setSaving(true);
    setSaveError(null);
    try {
      const write = (expected?: { mtimeMs: number; size: number }) => client.space(spaceId).files.write({
        path,
        content,
        encoding: "utf-8",
        ...(expected ? { expected } : null),
      });
      let saved: { size: number; mtimeMs: number } | null = null;
      try {
        saved = await write(force ? undefined : { mtimeMs: file.mtimeMs, size: file.size });
      } catch (caught) {
        if (force || !isFileConflictError(caught)) throw caught;
        const fresh = await client.space(spaceId).files.read(path);
        if (!("content" in fresh)) throw caught;
        const resolution = classifySaveConflict(fresh, file.content, content);
        if (resolution === "already-saved") {
          saved = { size: fresh.size, mtimeMs: fresh.mtimeMs };
        } else if (resolution === "retry") {
          saved = await write({ mtimeMs: fresh.mtimeMs, size: fresh.size });
        } else {
          setConflict(true);
          setSaveError(t("file.conflict"));
          return;
        }
      }
      if (!saved) throw new Error(t("file.saveIncomplete"));
      const { size, mtimeMs } = saved;
      setFile((current) => current ? { ...current, content, size, mtimeMs } : current);
      // Keep editing if the draft advanced while the write was in flight.
      setDraft((current) => current === content ? null : current);
      setConflict(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : t("file.saveError"));
    } finally {
      setSaving(false);
    }
  }, [client, draft, file, path, spaceId, t]);

  const reloadForConflict = useCallback(async () => {
    if (!client || !spaceId || !path) return;
    setSaving(true);
    setSaveError(null);
    try {
      const fresh = await client.space(spaceId).files.read(path);
      if (!("content" in fresh)) throw new Error(t("file.preparing"));
      setFile(fresh);
      setDraft(fresh.kind === "text" && fresh.delivery !== "url" ? fresh.content : null);
      setConflict(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : t("file.reloadError"));
    } finally {
      setSaving(false);
    }
  }, [client, path, spaceId, t]);

  const copyPath = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(path);
      showToast({ title: t("file.pathCopied") });
    } catch (caught) {
      showToast({ title: t("file.copyPathFailed.title"), message: caught instanceof Error ? caught.message : t("file.copyPathFailed.body"), tone: "danger" });
    }
  }, [path, showToast, t]);
  const title = path.split("/").pop() || t("file.title");
  const subtitle = editing ? (dirty ? t("file.unsaved") : t("file.editing")) : path || t("files.workspace");
  const showWebView = Boolean(file && url && inlineContent === null);

  return (
    <Screen keyboard={editing}>
      <TopBar
        title={title}
        subtitle={subtitle}
        titleRef={pathTitleRef}
        onTitleLongPress={path ? () => setPathMenuOpen(true) : undefined}
        titleMenu={path ? { menu: "file-path-actions-menu", actions: [{ icon: "copy", title: t("file.copyPath"), onPress: () => void copyPath() }] } : undefined}
        titleLongPressLabel={t("file.pathActions.open")}
        onBack={handleBack}
        actions={
          editing ? (
            <>
              <IconButton name="x" label={t("file.cancelEditing")} size={40} onPress={handleBack} disabled={saving} />
              {saving ? (
                <View className="w-10 h-10 items-center justify-center">
                  <Loader accessibilityLabel={t("file.saving")} />
                </View>
              ) : (
                <IconButton name="check" label={t("file.save")} size={40} tone="accent" onPress={() => void save()} disabled={!dirty} />
              )}
            </>
          ) : editable ? (
            <IconButton name="square-pen" label={t("file.edit")} size={40} onPress={() => setDraft(file?.content ?? "")} />
          ) : url ? (
            <IconButton name="external-link" label={t("file.openExternally")} size={40} onPress={() => void openWebLink(url).catch(() => undefined)} />
          ) : undefined
        }
      />
      {saveError ? (
        <SaveBanner
          message={saveError}
          conflict={conflict}
          saving={saving}
          onReload={() => void reloadForConflict()}
          onOverwrite={() => void save(true)}
        />
      ) : null}
      {loading ? (
        <LoadingRows count={5} />
      ) : error ? (
        <FileError
          message={error}
          onRetry={() => setRetryToken((value) => value + 1)}
          onBack={() => router.back()}
        />
      ) : showWebView && url ? (
        <WebView
          source={{ uri: url }}
          // design-system: WebView does not take className.
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          startInLoadingState
        />
      ) : file ? (
        editing && draft !== null ? (
          <ScrollView
            ref={editorScrollRef}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            scrollEventThrottle={16}
            onScroll={(event) => { editorMetrics.current.offset = event.nativeEvent.contentOffset.y; }}
            onLayout={(event) => {
              editorMetrics.current.viewport = event.nativeEvent.layout.height;
              revealEditorCaret();
            }}
          >
            <CodeEditor
              value={draft}
              onChangeText={setDraft}
              language={language}
              highlightTheme={theme.mode === "dark" ? "github-dark" : "github-light"}
              onCaretChange={(y) => {
                editorMetrics.current.caretY = y;
                revealEditorCaret();
              }}
            />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            {file.kind === "text" && file.size > MAX_EDITABLE_CODE_BYTES ? (
              <View className="flex-row items-center gap-2 mb-2">
                <AppIcon name="alert" size={14} tone="muted" />
                <Text className="text-caption text-fg-muted flex-1">
                  {t("file.tooLarge")}
                </Text>
              </View>
            ) : null}
            <CodeBlock code={inlineContent ?? ""} language={language} showLineNumbers />
          </ScrollView>
        )
      ) : null}
      {pathMenuOpen ? <AnchoredActionMenu
        anchorRef={pathTitleRef}
        title={title}
        testID="file-path-actions-menu"
        onClose={() => setPathMenuOpen(false)}
        actions={[{ icon: "copy", title: t("file.copyPath"), onPress: () => void copyPath() }]}
      /> : null}
    </Screen>
  );
}

function SaveBanner({
  message,
  conflict,
  saving,
  onReload,
  onOverwrite,
}: {
  message: string;
  conflict: boolean;
  saving: boolean;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="bg-danger-soft border-b border-border px-4 py-2 gap-2">
      <View className="flex-row items-center gap-2">
        <AppIcon name="alert" size={15} tone="danger" />
        <Text className="text-caption text-danger flex-1">{message}</Text>
      </View>
      {conflict ? (
        <View className="flex-row items-center gap-2 pl-6">
          <PrimaryButton label={t("file.reload")} icon="refresh" onPress={onReload} disabled={saving} />
          <Pressable accessibilityRole="button" accessibilityLabel={t("file.overwriteA11y")} disabled={saving} onPress={onOverwrite} className="min-h-11 justify-center px-2 active:opacity-60 disabled:opacity-60">
            <Text className="text-body font-semibold text-danger">{t("file.overwrite")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FileError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const isDirectory = /not a file|directory|folder/i.test(message);
  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="w-13 h-13 rounded-md items-center justify-center bg-danger-soft">
        <AppIcon name={isDirectory ? "folder" : "cloud-off"} size={24} tone="danger" />
      </View>
      <Text className="text-headline font-semibold text-fg text-center mt-4">
        {isDirectory ? t("file.folder.title") : t("file.error.title")}
      </Text>
      <Text selectable className="text-body text-fg-muted text-center mt-1.5 max-w-80">
        {isDirectory ? t("file.folder.body") : message}
      </Text>
      <View className="flex-row items-center gap-2 mt-4">
        <PrimaryButton label={t("files.backToFiles")} icon="arrow-left" onPress={onBack} className="min-h-11 px-4" />
        {!isDirectory ? <Pressable accessibilityRole="button" accessibilityLabel={t("common.retry")} onPress={onRetry} className="min-h-11 justify-center px-3 active:opacity-60"><Text className="text-body font-semibold text-accent">{t("common.retry")}</Text></Pressable> : null}
      </View>
    </View>
  );
}

