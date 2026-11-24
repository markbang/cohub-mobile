import type { ContentBlock, ModelCatalogEntry, ModelStatusResponse, SessionRecord, SessionTurnRecord, SpaceRecord } from "@neta-art/cohub";
import { messagesFromTurns } from "@/src/data/session-history";
import type { SessionView } from "@/src/data/types";

export const REAL_CHAT_ID = "2b1e0000-0000-4000-8000-000000000001";
/** Hours since this Chat's last message; the Chats list shows it first, so the first row opens it. */
export const REAL_CHAT_HOURS = 13;

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

const FIRST_REPLY = [
  "Four invoices are still open after matching, and one of them is a duplicate. Here is where each one stands.",
  "| Vendor | Invoice | Amount | Due | Status |\n| --- | --- | --- | --- | --- |\n| Northwind Print | 1042 | $3,180 | Oct 28 | 14 days overdue |\n| Kestrel Cloud | K-2291 | $1,240 | Nov 2 | Duplicate of K-2290 |\n| Harbor Legal | HL-077 | $2,900 | Oct 30 | Partly paid |\n| Lumen Design | 0931 | $860 | Nov 9 | Not yet due |",
  "The bank export has 1,284 rows for the quarter, and 41 of the 46 invoices matched on amount and date. The five that did not are:",
  "- **Northwind Print 1042**: no payment in the export. The client's remittance email arrived late, so the payment may still be in transit.\n- **Harbor Legal HL-077**: $1,450 was paid on Oct 31, which leaves $1,450 open.\n- **Kestrel Cloud K-2291**: a duplicate of K-2290, which was paid in full. Void it once you confirm.\n- **Lumen Design 0931** and **Stillwater Labs 88**: not due yet. No action this week.",
  "I have not sent anything. Tell me which reminders to send, and I will queue them for Finance.",
].join("\n\n");

const SECOND_REPLY = "Queued for Finance. I'll check the bank export again on Monday and tell you if either payment clears.";

type TurnSpec = {
  sequence: number;
  /** When the user sent the prompt, as milliseconds before now. */
  sentAgoMs: number;
  durationMs: number;
  userText: string;
  assistantContent: ContentBlock[];
  tokens: number;
  toolCallCount: number;
};

/** The models the Chats run and the composer offers; `claude-sonnet` is the Model the seeded Turns record. */
export const FIXTURE_MODELS: ModelCatalogEntry[] = [
  { provider: "cohub", id: "claude-sonnet", model: { name: "Claude Sonnet", contextWindow: 200_000, reasoning: true, cost: { input: 3, output: 15 } } },
  { provider: "cohub", id: "claude-haiku", model: { name: "Claude Haiku", contextWindow: 200_000, reasoning: false, cost: { input: 1, output: 5 } } },
];

/** The Chat screen's model status: every seeded model is operational, and `modelAvailabilityLevel` reads its 5-minute success rate in percent. */
export const FIXTURE_MODEL_STATUS: ModelStatusResponse = {
  generatedAt: new Date(0).toISOString(),
  overallStatus: "operational",
  models: {
    "claude-sonnet": {
      status: "operational",
      successRate5m: 100,
      successRateRecent: 100,
      successRateRecentWindowMinutes: 5,
      successRate2h: 100,
      successRate24h: 100,
      latencyAvgMs: 1200,
      latencyP90Ms: 2400,
      checkedAt: null,
      probeIntervalSeconds: null,
      history: null,
      heartbeats8h: null,
      heartbeatsWindowMinutes: null,
    },
  },
};

function turnRecord(sessionId: string, now: number, spec: TurnSpec): SessionTurnRecord {
  const startedAt = new Date(now - spec.sentAgoMs).toISOString();
  const completedAt = new Date(now - spec.sentAgoMs + spec.durationMs).toISOString();
  const usage = {
    input: Math.round(spec.tokens * 0.62),
    output: Math.round(spec.tokens * 0.05),
    cacheRead: Math.round(spec.tokens * 0.33),
    cacheWrite: 0,
    totalTokens: spec.tokens,
  };
  return {
    id: `${sessionId}:turn-${spec.sequence}`,
    sessionId,
    userUuid: null,
    sequence: spec.sequence,
    executionKind: "agent",
    status: "completed",
    intent: "followup",
    userContent: [{ type: "text", text: spec.userText }],
    userText: spec.userText,
    assistantContent: spec.assistantContent,
    assistantText: null,
    provider: "cohub",
    model: "claude-sonnet",
    stopReason: "stop",
    errorMessage: null,
    finalUsage: usage,
    totalUsage: usage,
    summary: null,
    intermediateIndex: null,
    intermediateSummary: spec.toolCallCount > 0 ? { messageCount: spec.toolCallCount * 2, toolCallCount: spec.toolCallCount } : null,
    meta: null,
    authorProfile: null,
    startedAt,
    completedAt,
    durationMs: spec.durationMs,
    createdAt: startedAt,
    updatedAt: completedAt,
  };
}

/** A Chat the list shows, opened as its one exchange: the title is the prompt and the last message the reply. */
export function previewChatView(space: SpaceRecord, session: SessionRecord, now: number): SessionView {
  const turn = turnRecord(session.id, now, {
    sequence: 1,
    sentAgoMs: now - Date.parse(session.lastMessageAt ?? session.updatedAt) + 9 * SECOND_MS,
    durationMs: 9 * SECOND_MS,
    userText: session.title ?? "Untitled Chat",
    assistantContent: [{ type: "text", text: session.latestMessageText ?? "" }],
    tokens: 12_000,
    toolCallCount: 0,
  });
  return loadedView(space, session, [turn]);
}

/** One Chat with a tool-using Turn, a long reply and a short Bot reply, as the Chat screen loads it. */
export function fixtureChatView(space: SpaceRecord, now: number): SessionView {
  const sessionId = REAL_CHAT_ID;
  const lastMessageAt = new Date(now - REAL_CHAT_HOURS * HOUR_MS).toISOString();
  const turns = [
    turnRecord(sessionId, now, {
      sequence: 1,
      sentAgoMs: 16 * HOUR_MS,
      durationMs: 42 * SECOND_MS,
      userText: "Reconcile the Q3 vendor invoices against the bank export and tell me what is still unpaid.",
      assistantContent: [
        { type: "text", text: "I'll match each invoice to the bank export by amount and date, then check what is left." },
        { type: "tool_use", id: "fixture-read-export", name: "read", input: { path: "exports/bank-2026-q3.csv" } },
        { type: "tool_result", tool_use_id: "fixture-read-export", content: [{ type: "text", text: "Read 1,284 rows from exports/bank-2026-q3.csv (Jul 1 to Sep 30)." }], is_error: false },
        { type: "tool_use", id: "fixture-reconcile", name: "bash", input: { command: "node scripts/reconcile.mjs --quarter Q3" } },
        { type: "tool_result", tool_use_id: "fixture-reconcile", content: [{ type: "text", text: "matched 41 of 46 invoices\nunmatched 5: 1042, HL-077, K-2291, 0931, 88" }], is_error: false },
        { type: "text", text: FIRST_REPLY },
      ],
      tokens: 29160,
      toolCallCount: 2,
    }),
    turnRecord(sessionId, now, {
      sequence: 2,
      sentAgoMs: REAL_CHAT_HOURS * HOUR_MS + 9 * SECOND_MS,
      durationMs: 9 * SECOND_MS,
      userText: "Draft a reminder for Northwind and Harbor, and queue it for Finance to send.",
      assistantContent: [{ type: "text", text: SECOND_REPLY }],
      tokens: 19560,
      toolCallCount: 0,
    }),
  ];
  const session: SessionRecord = {
    id: sessionId,
    spaceId: space.id,
    userUuid: null,
    title: "Reconcile Q3 vendor invoices",
    source: null,
    status: null,
    externalSessionId: null,
    meta: null,
    latestMessageText: SECOND_REPLY,
    lastMessageAt,
    lastMessageId: `${sessionId}:latest`,
    createdAt: new Date(now - 17 * HOUR_MS).toISOString(),
    updatedAt: lastMessageAt,
    totalMessages: 4,
    totalToolCalls: 2,
  };
  return loadedView(space, session, turns);
}

/** The view the Chat screen holds once a Chat's history has loaded and no reply is streaming. */
function loadedView(space: SpaceRecord, session: SessionRecord, turns: SessionTurnRecord[]): SessionView {
  return {
    space,
    session,
    messages: messagesFromTurns(turns),
    turns,
    historyLoaded: true,
    turnIndex: [],
    turnIndexLoading: false,
    hasMoreOlder: false,
    hasMoreNewer: false,
    loadingOlder: false,
    loadingNewer: false,
    oldestCursor: turns[0]?.sequence ?? null,
    newestCursor: turns.at(-1)?.sequence ?? null,
    windowGeneration: 0,
    loading: false,
    refreshing: false,
    catchingUp: false,
    error: null,
    stream: null,
  };
}
