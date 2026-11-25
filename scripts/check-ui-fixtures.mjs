import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fixtureChats } from "../src/data/fixtures/chats.ts";
import { FIXTURE_ACCOUNT } from "../src/data/fixtures/account.ts";
import { fixtureActivity, FIXTURE_SUBSCRIPTIONS } from "../src/data/fixtures/activity.ts";
import { FIXTURE_MODEL_STATUS, FIXTURE_MODELS, fixtureChatView, REAL_CHAT_ID, STRIPES_CHAT_ID, STRIPES_TITLE, stripesChatView } from "../src/data/fixtures/session.ts";
import { FIXTURE_SPACE_SPECS, fixtureSpaces } from "../src/data/fixtures/spaces.ts";
import { isSessionUnread } from "../src/data/chat-read-state.ts";
import { modelAvailabilityLevel } from "../src/model-catalog.ts";
import { buildFlow, buildMotionFlow, buildTabletFlow, MOTIONS, SCREENS } from "./ui-snapshots.mjs";
import { HEIGHT, pixel, WIDTH } from "./make-stripes-fixture.mjs";

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

const repoFile = (path) => new URL(`../${path}`, import.meta.url);
const flowFile = (path) => readFileSync(repoFile(path), "utf8");

const filterScreen = buildFlow({ platform: "ios", session: true, screens: SCREENS.filter((screen) => screen.name === "chats-filter"), target: "phone", orientation: "portrait" });
assert.match(filterScreen, /- tapOn:\n    text: "Filter Chats by \.\*"/, "iOS opens the Chats source filter by its bar label, which has no testID");
assert.match(filterScreen, /- extendedWaitUntil:\n    visible: "All"\n/, "the source menu is checked by its first item, All, as a whole word");
assert.doesNotMatch(filterScreen, /Filter Chats by source/, "the stale label is gone");
const filterAndroid = buildFlow({ platform: "android", session: false, screens: SCREENS.filter((screen) => screen.name === "chats-filter"), target: "phone", orientation: "portrait" });
assert.match(filterAndroid, /- tapOn:\n    id: "chats-source-menu-button"/, "Android opens the Chats source filter by its testID");
const filterMotion = buildMotionFlow({ platform: "ios", session: true, motions: MOTIONS.filter((motion) => motion.name === "motion-filter") });
assert.match(filterMotion, /- tapOn:\n    text: "Filter Chats by \.\*"/, "the recorded filter taps the same control as the screenshot");

const maestroOrientation = (orientation) => (orientation === "landscape" ? "LANDSCAPE_LEFT" : "PORTRAIT");
const offlineTablet = buildTabletFlow({ platform: "ios", session: true, maestroOrientation });
const signedInTablet = buildTabletFlow({ platform: "ios", session: false, maestroOrientation });
for (const path of ["e2e/tablet/split-layout.yaml", "e2e/tablet/split-send.yaml", "e2e/tablet/split-offline.yaml"]) assert.ok(existsSync(repoFile(path)), `${path} is a tablet flow Maestro runs`);
assert.match(offlineTablet, /split-layout\.yaml/, "the offline tablet run keeps the split layout");
assert.match(offlineTablet, /split-offline\.yaml/, "the offline tablet run picks a seeded Space instead of sending");
assert.doesNotMatch(offlineTablet, /split-send\.yaml/, "the offline tablet run never sends");
assert.match(signedInTablet, /split-send\.yaml/, "a signed-in tablet run still sends its message");
const layoutFlow = flowFile("e2e/tablet/split-layout.yaml");
assert.doesNotMatch(layoutFlow, /Send message|50%, 30%/, "the shared layout flow does not send or pick a Space by position");
assert.match(layoutFlow, /id: "split-right-pane"/, "the layout flow checks the right pane");
const offlineFlow = flowFile("e2e/tablet/split-offline.yaml");
assert.match(offlineFlow, new RegExp(`id: "new-chat-space-${FIXTURE_SPACE_SPECS.finance.id}"`), "the offline flow picks the seeded Finance Ops row by the testID New Chat gives it");
assert.doesNotMatch(offlineFlow, /Send message/, "the offline flow stops before the send");
assert.match(flowFile("app/new-chat.tsx"), /testID=\{`new-chat-space-\$\{space\.id\}`\}/, "New Chat gives each Space row the testID the offline flow taps");
assert.match(flowFile("e2e/tablet/split-send.yaml"), /Send message/, "the signed-in flow sends its message");


const stripesSession = sessions.at(-1);
assert.equal(stripesSession.id, STRIPES_CHAT_ID, "the striped Chat is the last row, so the rows above it do not move");
assert.equal(stripesSession.title, STRIPES_TITLE, "the striped Chat's row carries its title");
const pictureUri = "http://localhost:8081/assets/?unstable_path=.%2Fassets%2Fdebug%2Fstripes.png";
const striped = stripesChatView(spaces.find((space) => space.id === stripesSession.spaceId), now, pictureUri);
assert.equal(striped.session.id, STRIPES_CHAT_ID, "the striped view belongs to the striped row");
const pictureIndex = striped.messages.findIndex((message) => message.text?.includes(`![${STRIPES_TITLE}](${pictureUri})`));
assert.ok(pictureIndex >= 0, "the picture is a Markdown image on the dev server URL in one reply");
assert.equal(striped.messages[pictureIndex]?.role, "assistant", "the picture is an assistant reply");
assert.ok(striped.messages[pictureIndex].text?.trimEnd().endsWith("288 × 160 px."), "the caption below the picture is the reply's last line");
assert.ok(striped.messages.length - pictureIndex >= 9, "replies follow the picture, so the list can scroll it under the back button");
assert.ok(pictureIndex >= 12, "older replies sit above the picture, so it starts below the fold");
const stripesPng = readFileSync(repoFile("assets/debug/stripes.png"));
const pngPixels = (png) => {
  let offset = 8;
  let width = 0;
  let height = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (type === "IHDR") [width, height] = [png.readUInt32BE(offset + 8), png.readUInt32BE(offset + 12)];
    if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return { width, height, rows: inflateSync(Buffer.concat(data)) };
};
const decoded = pngPixels(stripesPng);
assert.deepEqual([decoded.width, decoded.height], [WIDTH, HEIGHT], "the committed picture is the generator's size");
const sample = [[0, 0], [7, 25], [120, 45], [30, 70], [200, 90], [50, 110], [100, 130], [287, 159]];
for (const [x, y] of sample) {
  const at = y * (1 + WIDTH * 3) + 1 + x * 3;
  assert.deepEqual([...decoded.rows.subarray(at, at + 3)], [...pixel(x, y)], `the committed picture matches the generator at (${x}, ${y})`);
}
assert.ok(existsSync(repoFile("app/debug")) && existsSync(repoFile("assets/debug/stripes.png")), "the picture sits in assets/debug");
