import type { SpaceRecord } from "@neta-art/cohub";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { BotRow } from "@/src/components/BotRow";
import { PRIMARY_BOT_SLUG, type BotEntry } from "@/src/data/bot-mode";
import { Screen, TopBar } from "@/src/ui";

/** The Bots view's rows over fixed Bots, so their layout can be captured without an account's Bots. */
export default function DebugBotListScreen() {
  const router = useRouter();
  const [entries] = useState(() => fixtureEntries(Date.now()));
  return <Screen>
    <TopBar title="Bots" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      {entries.map((entry) => <BotRow key={entry.space.id} entry={entry} onPress={() => undefined} />)}
    </ScrollView>
  </Screen>;
}

function fixtureEntries(now: number): BotEntry<SpaceRecord>[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const entry = (id: string, name: string, minutes: number, text: string, state: Partial<Pick<BotEntry<SpaceRecord>, "running" | "needsYou">> & { from?: string } = {}): BotEntry<SpaceRecord> => ({
    space: { id, slug: id === "primary" ? PRIMARY_BOT_SLUG : `${PRIMARY_BOT_SLUG}-${id}`, name, title: name, publicProfile: null, lastActivityAt: ago(minutes), updatedAt: ago(minutes) } as unknown as SpaceRecord,
    note: { text, at: ago(minutes), messageId: `${id}:user`, from: state.from ?? null },
    chatId: null,
    running: state.running ?? false,
    needsYou: state.needsYou ?? false,
  });
  return [
    entry("primary", "Chief of staff", 3, "Overnight: 41 new emails. 6 needed you, the rest are filed."),
    entry("sales", "Sales Outbound", 20, "Outreach drafts queued for approval.", { running: true }),
    entry("talent", "Talent Scout", 45, "Shortlist of 6 candidates ready.", { needsYou: true }),
    entry("growth", "Growth Marketer with a name long enough to truncate", 90, "A/B copy variants ready to review, with a preview long enough to need truncating on one line."),
    // From another Bot whose Space this fixture has not loaded, so its name falls back.
    entry("support", "Customer Support", 26 * 60, "12 tickets resolved, 2 escalated.", { from: "primary" }),
    entry("expense", "Expense Manager", 3 * 24 * 60, "Receipts coded — one needs a look."),
  ];
}
