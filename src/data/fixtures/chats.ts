import type { UserSessionListItem } from "@neta-art/cohub";
import type { SessionSeenEntry, SessionSeenState } from "@/src/data/chat-read-state";
import { FIXTURE_SPACE_SPECS, type FixtureSpaceKey } from "./spaces";
import { REAL_CHAT_HOURS, STRIPES_HOURS, STRIPES_TITLE } from "./session";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The Chats are read as of this long before now; a Chat older than it never shows as unread. */
const READ_BASELINE_MS = 30 * DAY_MS;

type FixtureChatSpec = {
  /** Hours since the Chat's last message. */
  hours: number;
  space: FixtureSpaceKey;
  title: string;
  latest: string;
  unread?: true;
};

// Newest first. Ages run from 13 hours to ten days, so the list shows both relative and dated labels.
const CHAT_SPECS: FixtureChatSpec[] = [
  { hours: REAL_CHAT_HOURS, space: "finance", title: "Reconcile Q3 vendor invoices", latest: "Queued for Finance. I'll check the bank export again on Monday." },
  { hours: 16, space: "product", title: "Draft the Android release notes", latest: "Two drafts are ready: a short one for the store and a long one for the changelog." },
  { hours: 19, space: "chief", title: "Morning brief", latest: "Three things need you today: the board deck review at 2pm, two invoices and a reply from Hana.", unread: true },
  { hours: 26, space: "research", title: "Interview synthesis, batch 3", latest: "Eleven transcripts coded. The strongest theme is setup friction on the second day.", unread: true },
  { hours: 31, space: "finance", title: "October expense categories", latest: "Moved the conference deposits into Travel and split the software renewals by team." },
  { hours: 38, space: "product", title: "Onboarding copy in English and Chinese", latest: "The Chinese strings match the English tone now. Two labels still need a native check." },
  { hours: 45, space: "finance", title: "Overdue retainer reminder", latest: "Draft ready for the client: 14 days overdue, invoice 1042, same terms as last quarter.", unread: true },
  { hours: 52, space: "chief", title: "Headcount slide against Rippling", latest: "Matches Rippling: 48 full-time and 6 contractors. Both duplicates from last month are gone." },
  { hours: 58, space: "research", title: "Competitor pricing memo, outline", latest: "Outline done: three tiers, the discount ladder and two questions for sales." },
  { hours: 71, space: "product", title: "Fix the Android sheet height in the composer, then check the iPad split layout at the new width", latest: "Shipped in the last build. Short sheets now use the fit detent by default." },
  { hours: 79, space: "finance", title: "Tax filing checklist for the LLC", latest: "Checklist done. Two items need your signature before the filing deadline." },
  { hours: 96, space: "chief", title: "Weekly status note", latest: "Sent to the team channel: shipped, blocked and next week's priorities." },
  { hours: 104, space: "research", title: "Glossary for the onboarding flow", latest: "Forty-two terms, with three that still differ between the app and the web." },
  { hours: 120, space: "product", title: "Release checklist for 2.4", latest: "Ten of twelve items are checked. The last two wait on the iOS build." },
  { hours: 131, space: "finance", title: "Vendor contract renewal dates", latest: "Four renewals fall in Q1. The hosting contract renews unless cancelled by December 5." },
  { hours: 150, space: "research", title: "Survey responses, first pass", latest: "Sorted 212 responses into five themes, weighted by plan tier." },
  { hours: 170, space: "chief", title: "Calendar prep for the investor call", latest: "Pulled the last two notes and the open questions onto one page." },
  { hours: 190, space: "product", title: "Accessibility audit notes", latest: "Screen reader labels are mostly fixed. Contrast issues remain on the empty states." },
  { hours: 205, space: "finance", title: "Budget variance for September", latest: "Software is 12% over plan from the seat true-up; everything else is in range." },
  { hours: 222, space: "research", title: "Literature list for the retention study", latest: "Thirty-one papers, sorted by how directly they measure week-four retention." },
  { hours: 240, space: "product", title: "Name options for the sync feature", latest: "Five names shortlisted and checked against existing trademarks in the first two classes." },
  { hours: 250, space: "finance", title: "Bank feed mapping", latest: "Mapped 18 accounts. Two new cards still need categories." },
  // The striped Chat the motion recordings open from this row, last so the rows above it are unchanged.
  { hours: STRIPES_HOURS, space: "product", title: STRIPES_TITLE, latest: "Striped test pattern for the chrome checks." },
];

/** The first Chat is the real Chat, `REAL_CHAT_ID`, which the Chat screen fixture is keyed by. */
const sessionId = (index: number) => `2b1e0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

/** The Chats, newest first, with the read marks the Chats list shows them by. */
export function fixtureChats(now: number): { sessions: UserSessionListItem[]; seen: SessionSeenState } {
  const entries: Record<string, SessionSeenEntry> = {};
  const sessions = CHAT_SPECS.map((spec, index): UserSessionListItem => {
    const id = sessionId(index);
    const space = FIXTURE_SPACE_SPECS[spec.space];
    const lastMessageAt = new Date(now - spec.hours * HOUR_MS).toISOString();
    const lastMessageId = `${id}:latest`;
    if (!spec.unread) entries[id] = { messageId: lastMessageId, seenAt: now };
    return {
      id,
      spaceId: space.id,
      userUuid: null,
      title: spec.title,
      source: null,
      status: null,
      externalSessionId: null,
      meta: null,
      latestMessageText: spec.latest,
      lastMessageAt,
      lastMessageId,
      createdAt: new Date(now - (spec.hours + 6) * HOUR_MS).toISOString(),
      updatedAt: lastMessageAt,
      space: { id: space.id, name: space.name, slug: space.slug, publicProfile: null },
    };
  });
  return { sessions, seen: { baseline: now - READ_BASELINE_MS, entries } };
}
