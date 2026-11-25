import { Image } from "react-native";
import type { BillingCreditStatus, BillingSubscriptionHistoryList, ModelCatalogEntry, ModelStatusResponse, PaletteOverviewResponse, SpaceRecord, UserActivityResponse, UserSessionListItem } from "@neta-art/cohub";
import { uiSnapshots } from "@/src/config";
import type { SessionSeenState } from "@/src/data/chat-read-state";
import type { SpaceSessionCount } from "@/src/data/space-session-counts";
import type { SessionView } from "@/src/data/types";
import { FIXTURE_ACCOUNT } from "./account";
import { FIXTURE_CREDITS, FIXTURE_SUBSCRIPTIONS, fixtureActivity } from "./activity";
import { fixtureChats } from "./chats";
import { FIXTURE_MODEL_STATUS, FIXTURE_MODELS, fixtureChatView, previewChatView, REAL_CHAT_ID, STRIPES_CHAT_ID, stripesChatView } from "./session";
import { FIXTURE_SPACE_SPECS, fixtureOverview, fixtureSpaces, fixtureSpaceSessionCounts } from "./spaces";

/**
 * Seeded account data for the UI snapshots, so Chats, a Chat, Spaces, Activity and Settings render without an
 * account. These are fake records a shipped app must never show, so the gate is `__DEV__ && uiSnapshots`: a
 * release build has `__DEV__` false, which makes the predicate false and no fixture is read. Only a debug
 * bundle built by `scripts/ui-snapshots.mjs` sets `EXPO_PUBLIC_UI_SNAPSHOTS`.
 */
export const usesFixtures = (): boolean => __DEV__ && uiSnapshots;

export type FixtureSeed = {
  account: typeof FIXTURE_ACCOUNT;
  spaces: SpaceRecord[];
  sessions: UserSessionListItem[];
  sessionSeen: SessionSeenState;
  sessionViews: Record<string, SessionView>;
  models: ModelCatalogEntry[];
  modelStatus: ModelStatusResponse;
  overview: PaletteOverviewResponse;
  spaceSessionCounts: Record<string, SpaceSessionCount>;
  credits: BillingCreditStatus;
  activity: UserActivityResponse;
  subscriptions: BillingSubscriptionHistoryList;
};

let seed: FixtureSeed | null = null;

/** Built on first read, so the clock is read once per app run and a release build never reaches it. */
export function fixtureSeed(): FixtureSeed {
  if (!seed) seed = buildSeed(Date.now());
  return seed;
}

function buildSeed(now: number): FixtureSeed {
  const spaces = fixtureSpaces(now);
  const { sessions, seen } = fixtureChats(now);
  const spaceOf = (spaceId: string) => {
    const space = spaces.find((item) => item.id === spaceId);
    if (!space) throw new Error(`The fixture Chat's Space ${spaceId} is missing from the fixture Spaces.`);
    return space;
  };
  // Every row opens to a loaded Chat, so a tap on any row in a capture reads seeded history.
  const sessionViews = Object.fromEntries(sessions.map((session) => [session.id, previewChatView(spaceOf(session.spaceId), session, now)]));
  sessionViews[REAL_CHAT_ID] = fixtureChatView(spaceOf(FIXTURE_SPACE_SPECS.finance.id), now);
  // The striped test picture, as a dev-server URL a Markdown image loads (`scripts/make-stripes-fixture.mjs`).
  const picture = Image.resolveAssetSource(require("../../../assets/debug/stripes.png")).uri;
  sessionViews[STRIPES_CHAT_ID] = stripesChatView(spaceOf(FIXTURE_SPACE_SPECS.product.id), now, picture);
  return {
    account: FIXTURE_ACCOUNT,
    spaces,
    sessions,
    sessionSeen: seen,
    sessionViews,
    models: FIXTURE_MODELS,
    modelStatus: FIXTURE_MODEL_STATUS,
    overview: fixtureOverview(spaces, now),
    spaceSessionCounts: fixtureSpaceSessionCounts(sessions.map((session) => session.spaceId)),
    credits: FIXTURE_CREDITS,
    activity: fixtureActivity(now),
    subscriptions: FIXTURE_SUBSCRIPTIONS,
  };
}
