import type { SpaceRecord } from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { BotRow, PinnedBots } from "@/src/components/BotRow";
import { pinnedBotEntries, PRIMARY_BOT_SLUG, type BotEntry } from "@/src/data/bot-mode";
import { Screen, TopBar } from "@/src/ui";

/** The Bots view's pinned faces and rows over fixed Bots, so their layout can be captured without an account's Bots. */
export default function DebugBotListScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState(() => fixtureEntries(Date.now()));
  const togglePin = ({ space }: BotEntry<SpaceRecord>) => setEntries((current) => current.map((entry) => entry.space.id === space.id ? { ...entry, space: { ...space, isPinned: !space.isPinned } } : entry));
  const faces = pinnedBotEntries(entries);
  return <Screen>
    <TopBar title="Bots" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <PinnedBots entries={faces} onPress={() => undefined} onTogglePin={togglePin} />
      {entries.filter((entry) => !faces.includes(entry)).map((entry) => <BotRow key={entry.space.id} entry={entry} onPress={() => undefined} onTogglePin={() => togglePin(entry)} />)}
    </ScrollView>
  </Screen>;
}

function fixtureEntries(now: number): BotEntry<SpaceRecord>[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const entry = (id: string, name: string, minutes: number, text: string, state: Partial<Pick<BotEntry<SpaceRecord>, "running" | "needsYou">> & { from?: string; pinned?: boolean; unread?: boolean } = {}): BotEntry<SpaceRecord> => ({
    space: { id, slug: id === "primary" ? PRIMARY_BOT_SLUG : `${PRIMARY_BOT_SLUG}-${id}`, name, title: name, publicProfile: null, lastActivityAt: ago(minutes), updatedAt: ago(minutes), isPinned: state.pinned ?? false } as unknown as SpaceRecord,
    note: { text, at: ago(minutes), messageId: `${id}:user`, from: state.from ?? null },
    // A Chat never opened on this device is unread when its last message is later than the app's first launch.
    chatId: state.unread ? `${id}-chat` : null,
    running: state.running ?? false,
    needsYou: state.needsYou ?? false,
  });
  return [
    // Pinned: each state once, a name longer than its column, and enough faces to scroll.
    entry("primary", "Chief of staff", 3, "Overnight: 41 new emails. 6 needed you, the rest are filed.", { pinned: true }),
    entry("research", "Researcher", 0, "Three sources disagree on the launch date.", { pinned: true, unread: true }),
    entry("engineer", "Engineer", 5, "Running the migration on staging.", { pinned: true, running: true }),
    entry("legal", "Legal Counsel", 8, "The contract needs your signature.", { pinned: true, running: true, needsYou: true }),
    entry("success", "Customer Success Manager", 12, "Renewal notes are filed.", { pinned: true }),
    entry("analyst", "Analyst", 15, "The weekly numbers are in.", { pinned: true }),
    entry("design", "Designer", 18, "Two icon options are ready.", { pinned: true }),
    entry("sales", "Sales Outbound", 20, "Outreach drafts queued for approval.", { running: true }),
    entry("talent", "Talent Scout", 45, "Shortlist of 6 candidates ready.", { needsYou: true }),
    entry("growth", "Growth Marketer with a name long enough to truncate", 90, "A/B copy variants ready to review, with a preview long enough to need truncating on one line."),
    // From another Bot whose Space this fixture has not loaded, so its name falls back.
    entry("support", "Customer Support", 26 * 60, "12 tickets resolved, 2 escalated.", { from: "7c1d3e5f-8091-4b2c-8d3e-4f5061728394" }),
    entry("expense", "Expense Manager", 3 * 24 * 60, "Receipts coded — one needs a look."),
  ];
}
