import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";
import type { LauncherShortcut } from "@/src/data/launcher-shortcuts";
import { isAppActive } from "@/src/platform/app-lifecycle";

// SF Symbols are licensed for Apple platforms only; Android draws the app's adaptive icon (see app.json).
const ICONS: Record<LauncherShortcut["kind"], string> = Platform.OS === "ios"
  ? { "new-chat": "symbol:square.and.pencil", chat: "symbol:bubble.left" }
  : { "new-chat": "shortcut_icon", chat: "shortcut_icon" };

function urlOf(action: QuickActions.Action | null | undefined) {
  const url = action?.params?.url;
  return typeof url === "string" ? url : null;
}

/** Replaces the home-screen quick actions. Android needs a live activity to build them. */
export async function setLauncherShortcuts(shortcuts: readonly LauncherShortcut[]) {
  if (!isAppActive()) return;
  await QuickActions.setItems(shortcuts.map((shortcut) => ({ id: shortcut.id, title: shortcut.title, icon: ICONS[shortcut.kind], params: { url: shortcut.url } })));
}

/** Signing out must not leave the previous account's Chat titles on the home screen. */
export function clearLauncherShortcuts() {
  void QuickActions.setItems([]).catch((error: unknown) => console.warn("[quick-actions] could not clear shortcuts", error));
}

/** The URL of the quick action that launched the app, and then of each one used while it runs. */
export function initialLauncherShortcutUrl() {
  return urlOf(QuickActions.initial);
}

export function subscribeLauncherShortcuts(onUrl: (url: string) => void) {
  const subscription = QuickActions.addListener((action) => {
    const url = urlOf(action);
    if (url) onUrl(url);
  });
  return () => subscription.remove();
}
