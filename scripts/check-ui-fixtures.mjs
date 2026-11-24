import assert from "node:assert/strict";
import { fixtureChats } from "../src/data/fixtures/chats.ts";
import { FIXTURE_ACCOUNT } from "../src/data/fixtures/account.ts";
import { fixtureActivity, FIXTURE_SUBSCRIPTIONS } from "../src/data/fixtures/activity.ts";
import { FIXTURE_MODEL_STATUS, FIXTURE_MODELS, fixtureChatView, REAL_CHAT_ID } from "../src/data/fixtures/session.ts";
import { fixtureSpaces } from "../src/data/fixtures/spaces.ts";
import { isSessionUnread } from "../src/data/chat-read-state.ts";
import { modelAvailabilityLevel } from "../src/model-catalog.ts";

const DAY_MS = 86_400_000;
const now = Date.parse("2026-11-24T04:00:00Z");

const spaces = fixtureSpaces(now);
const { sessions, seen } = fixtureChats(now);
const spaceIds = new Set(sessions.map((session) => session.spaceId));

assert.ok(sessions.length >= 20, "the Chats list needs enough rows to scroll");
assert.ok(spaceIds.size >= 3 && spaceIds.size <= 4, "the Chats span three or four Spaces");
assert.equal(sessions[0].id, REAL_CHAT_ID, "the first row is the real Chat, which chat-real opens");
assert.ok(sessions.some((session) => session.title.length > 60), "one title is long enough to truncate");
assert.ok(sessions.some((session) => (now - Date.parse(session.lastMessageAt)) >= 10 * DAY_MS), "the oldest rows are dated");
const unread = sessions.filter((session) => isSessionUnread(session, seen));
assert.ok(unread.length >= 2, "several rows are unread");
assert.ok(spaces.some((space) => space.isPinned && space.slug === "cohubbot"), "a pinned Bot is in the Spaces");

const chat = fixtureChatView(spaces.find((space) => space.name === "Finance Ops"), now);
const assistantBlocks = chat.turns.flatMap((turn) => turn.assistantContent ?? []).map((block) => block.type);
assert.ok(assistantBlocks.includes("tool_use") && assistantBlocks.includes("tool_result"), "the Chat shows tool rows");
assert.ok(chat.messages.some((message) => message.role === "assistant" && (message.text ?? "").length > 600), "the Chat has a long reply");
assert.equal(chat.messages.at(-1)?.role, "assistant", "the Chat ends on a Bot reply");

const activity = fixtureActivity(now);
assert.equal(activity.days, 91, "the heatmap spans thirteen weeks");
const totals = new Set(activity.hourly.map((bucket) => bucket.totalTokens));
assert.ok(totals.size > 3, "the heatmap's usage varies");
assert.equal(FIXTURE_SUBSCRIPTIONS.items.length, 0, "the Activity page has no active subscription");
assert.ok(FIXTURE_ACCOUNT.name && FIXTURE_ACCOUNT.email && FIXTURE_ACCOUNT.avatar.startsWith("data:image/png;base64,"), "the Settings card has a name, an email and an avatar");
assert.ok(FIXTURE_MODELS.length >= 2, "the composer offers more than one model");
assert.equal(modelAvailabilityLevel(FIXTURE_MODEL_STATUS.models["claude-sonnet"]), "available", "the Chats' model reads as available, not as an outage");
assert.ok(FIXTURE_MODELS.some((entry) => entry.id === "claude-sonnet"), "the Chats' recorded model is in the catalog");
