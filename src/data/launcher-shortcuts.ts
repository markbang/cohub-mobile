/** Home-screen quick actions: New Chat, then the most recent Chats. Platforms show about four. */
export const RECENT_CHAT_SHORTCUTS = 3;

export type LauncherShortcut = { id: string; kind: "new-chat" | "chat"; title: string; url: string };

type RecentChat = { id: string; title: string; lastActivityAt: string | null };

export function launcherShortcuts(newChatTitle: string, chats: readonly RecentChat[]): LauncherShortcut[] {
  const recent = chats
    .filter((chat) => chat.id && chat.title.trim())
    .slice()
    .sort((a, b) => Date.parse(b.lastActivityAt ?? "") - Date.parse(a.lastActivityAt ?? "") || 0)
    .slice(0, RECENT_CHAT_SHORTCUTS);
  return [
    { id: "new-chat", kind: "new-chat", title: newChatTitle, url: "cohub://new-chat" },
    ...recent.map((chat) => ({ id: `chat:${chat.id}`, kind: "chat" as const, title: chat.title.trim().slice(0, 64), url: `cohub://chat/${encodeURIComponent(chat.id)}` })),
  ];
}

/** Identity of a shortcut list, so an unchanged list is not republished on every store update. */
export function launcherShortcutsKey(shortcuts: readonly LauncherShortcut[]) {
  return shortcuts.map((shortcut) => `${shortcut.id}\u0000${shortcut.title}`).join("\u0001");
}
