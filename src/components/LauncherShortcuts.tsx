import { useEffect, useMemo } from "react";
import { useAppSelector } from "@/src/data/context";
import { launcherShortcuts, launcherShortcutsKey } from "@/src/data/launcher-shortcuts";
import { useTranslation } from "@/src/i18n";
import { setLauncherShortcuts } from "@/src/platform/quick-actions";
import { displaySessionTitle } from "@/src/utils";

/** Keeps the home-screen quick actions on the signed-in user's latest Chats. */
export function LauncherShortcuts() {
  const { t } = useTranslation();
  // The session list, not the whole store: streaming replies update the store many times a second.
  const sessions = useAppSelector((app) => app.state.sessions);
  const newChatTitle = t("route.newChat");
  const shortcuts = useMemo(() => launcherShortcuts(newChatTitle, sessions.map((session) => ({
    id: session.id,
    title: displaySessionTitle(session),
    lastActivityAt: session.lastMessageAt ?? session.updatedAt,
  }))), [newChatTitle, sessions]);
  const key = launcherShortcutsKey(shortcuts);
  useEffect(() => {
    void setLauncherShortcuts(shortcuts).catch((error: unknown) => console.warn("[quick-actions] could not publish shortcuts", error));
    // `key` is the list's identity; a re-sorted but equal list is not republished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
