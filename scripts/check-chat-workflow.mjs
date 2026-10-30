import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { mock } from "node:test";
import ts from "typescript";
import { latestUnreadAssistantIndex } from "../src/data/chat-read-state.ts";
import { sessionActivity } from "../src/data/session-activity.ts";
import { ChatScrollTrace, setDebugTraceSink } from "../src/data/chat-scroll-trace.ts";
import { MessageMeasurements, answerBlocks, createStreamBatch, liveReplyAnchor, rowHeightMeasurement, thinkingBlocks } from "../src/data/chat-rendering.ts";
import { CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD, CHAT_FOLLOW_TAIL_MAINTAIN_THRESHOLD, CHAT_TAIL_THRESHOLD, chatFollowPinAnimated, chatListDistances, chatListViewOffset, chatMaintainScrollAtEnd, chatTailDisplaced, chatTailScrolledAway, chatTailStalled, isChatRowVisible, nextChatTailFollowing } from "../src/data/chat-scroll.ts";
import { StreamRevealController } from "../src/data/stream-reveal.ts";
import { formatMessageClock } from "../src/data/chat-format.ts";
import { getComposerActionState } from "../src/data/composer-state.ts";
import { RADIUS, TEXT_RAMP, darkPalette, lightPalette, pureBlackOverrides } from "../src/design/tokens.ts";
import { imageViewerPageIndex } from "../src/data/image-viewer.ts";
import { collapsedComposerHeight, COMPOSER_CHROME_HEIGHT, COMPOSER_TEXT_PADDING, estimateComposerContentHeight, getComposerLayout, shouldAutoExpandComposer } from "../src/ui/composer-layout.ts";
import { BUBBLE_META_GAP, bubbleTextLines, getBubbleMaxWidth, getBubbleMetaLayout } from "../src/ui/message-bubble-layout.ts";
import { getComposerMenuLayout } from "../src/ui/composer-menu-layout.ts";
import { isUsableKeyboardFrame, keyboardOverlap } from "../src/ui/keyboard-frame.ts";
import { getAnchoredMenuLayout } from "../src/ui/anchored-menu-layout.ts";
import { interpolateSendBubbleRect, isSendBubbleMessage, measureSendBubbleSource } from "../src/ui/send-bubble-motion.ts";
import { motion } from "../src/motion.ts";
import { getResourcePinState, invalidateResourcePinReads, isResourcePinned, toggleResourcePin } from "../src/data/resource-pins.ts";
import { hasFinalAssistantForTurn, isActiveTurnStatus, isTerminalTurnStatus, liveStreamStatusFromPatch, pendingStreamForTurn, shouldShowLiveStream, streamRecoveryFromTail } from "../src/data/chat-stream.ts";
import { fetchSessionLabels, fetchLabelSessionIds, formatLabelRef, isWebSessionSource, sessionSourceGroup, toUserSessionLabels } from "../src/data/session-labels.ts";
import { sessionSourceFilterKeys, sessionSourceFilterOf } from "../src/data/session-source.ts";
import { chatThreadPlaceholder, mergeDisplayMessages, mergeTurnWindows, messageIndexForTurn, messageRowKey, messagesFromTurns, messagesInWindow, nextTurnSequence, turnFitsWindow, turnSequenceForMessage, turnWindowsJoin, withFallbackUserContent, withTurnSequences } from "../src/data/session-history.ts";
import { compactionFromMessage, compactionStats } from "../src/data/compaction.ts";
import { mapRemoteSearchResults, normalizeSearchQuery } from "../src/data/session-search.ts";
import { accessTokenExpiresAt, conflictedDeviceRuntimes, deviceDisplayStateKey, deviceFolderName, deviceRuntimeRefusalKey, deviceRuntimeStateKey, isDeviceRuntimeRunning, runtimeGatewayOrigin } from "../src/data/device-runtime.ts";
import { listAllSpaces, selectSpaceList, recentSpaceVisits, SPACE_VISIT_MAX_AGE_MS } from "../src/data/space-list.ts";
import { createSessionLifecycle } from "../src/data/session-lifecycle.ts";
import { createSyncScheduler } from "../src/data/sync-scheduler.ts";
import { reconcileSessionHead } from "../src/data/session-list-sync.ts";
import { mergeTaskRuns, refreshTaskRuns } from "../src/data/task-sync.ts";
import { emptyRunningSessions, loadRunningSessions, parseCachedRunningSessions, reconcileRunningSessions, runningSessionCandidates } from "../src/data/running-sessions.ts";
import { createSpaceRealtime } from "../src/data/space-realtime.ts";
import { spaceRealtimeChange, userSessionRealtimeChange } from "../src/data/space-realtime-events.ts";
import { DEFAULT_SESSION_FILTER_MINUTES, getSessionStatus, sessionListStatus, hasMoreRecentSessions, isSessionInFilterWindow, latestTurn, loadSessionLatestTurns, parseSessionFilterMinutes, reconcileLatestTurn, reconcileTurnStatusPatch, sessionFilterCutoff, sessionPageState } from "../src/data/session-status.ts";
import { followupPreviewText, queuedFollowupTurns, followupQueueItems, isOptimisticFollowup, isSendQueueItem, shouldQueueFollowup } from "../src/data/followup-queue.ts";
import { classifySaveConflict, isEditableTextFile, isFileConflictError } from "../src/data/code-file.ts";
import { detectCodeLanguage, resolveCodeLanguage } from "../src/data/code-language.ts";
import { StreamingCodeTokenizer } from "../src/data/code-highlight-stream.ts";
import { connectionDisplayState, createRealtimeRecovery, createSessionResyncCoordinator, isTransportRecovery, withSettledClose } from "../src/data/session-reconnect.ts";
import { PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_VERTICAL_SLOP_PX, panelForScrollOffset, panelSwipeTarget } from "../src/data/space-panel-pager.ts";
import { getSpaceSessionCount, loadSpaceSessionCounts, publishSpaceSessionCount } from "../src/data/space-session-counts.ts";
import { cacheRetentionCutoff, DEFAULT_CACHE_RETENTION } from "../src/data/cache-retention.ts";
import { formatToolCallCaption, toolCallPreview } from "../src/data/tool-call.ts";
import { forkPoint, forkSessionTurn } from "../src/data/session-fork.ts";
import { buildSessionForkTree, mergeSessionForks, realtimeSessionFork } from "../src/data/session-fork-tree.ts";
import { SETUP_STATUS, sandboxSetupInfo, sandboxSetupLogPaths, sandboxSetupStatus } from "../src/data/sandbox-setup.ts";
import { appendWalletActivity, formatWalletUsd, walletProductBalanceUsd } from "../src/data/space-wallet.ts";
import { nextCronRuns, parseCron, summarizeCron } from "../src/data/cron.ts";
import { appDevicesRequest, appHostScript, appNavigationRequest, appRuntimeSignal, readAppHostMessage } from "../src/data/app-host.ts";
import { dailyViews, promotionUrl, withCohubBar } from "../src/data/app-manage.ts";
import { imageThumbnailUrl, modelFormat } from "../src/data/media.ts";
import { createRelatedSessionStore, sentFrom, sentSessions } from "../src/data/related-sessions.ts";
import { COHUB_WEB_ORIGIN_SOURCE as MESSAGE_LINK_ORIGIN_SOURCE, resolveMessageLink } from "../src/data/message-links.ts";
import { applyComposerDisplayEdit, COHUB_WEB_ORIGIN_SOURCE, draftMentions, extractSpaceMentions, mentionDisplayText, detectSpaceMentionTrigger, findCohubLinks, restoreDraftMentions, insertSpaceMention, replaceCohubLinks, selectSpaceMentionSuggestions, textMatchScore } from "../src/data/space-mentions.ts";
import { androidUpdateApkUrl, selectYaotaAndroidUpdate, validateAndroidUpdateAsset, verifyAndroidUpdateIntegrity } from "../src/data/update-assets.ts";
import { isSettingsSection, settingsMenu } from "../src/data/settings-navigation.ts";
import { colorWithOpacity } from "../src/design/color.ts";
import { parseBrowserPreference } from "../src/data/browser-preference.ts";
import { channelHealthState, createSettingsChannel, createWeChatLoginPoller, isChannelProvider, missingChannelField } from "../src/data/channel-settings.ts";

import { activityContributorName, activityRange, localDateKey, tokenDays } from "../src/data/activity.ts";
import { installSpaceMod } from "../src/data/space-mods.ts";
import { detectSlashCommandTrigger, insertSlashCommand, selectSlashCommandItems, slashCommandLabel, slashCommandText } from "../src/data/slash-commands.ts";
import { canUseRuntimeHarness, harnessOptions, runtimeHarnessFromTurn } from "../src/data/runtime.ts";

const flushSync = async () => { for (let tick = 0; tick < 20; tick++) await Promise.resolve(); };
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
try {
  const requests = [];
  const scheduler = createSyncScheduler({ random: () => 0.5 });
  const task = { intervalMs: () => 1000, run: () => { const request = Promise.withResolvers(); requests.push(request); return request.promise; } };
  const stop = scheduler.watch("chats", task);
  const stopSecondReader = scheduler.watch("chats", task);
  mock.timers.tick(5000);
  await flushSync();
  assert.equal(requests.length, 0, "background scopes do not start polling");
  scheduler.setActive(true);
  scheduler.invalidate();
  scheduler.invalidate("chats");
  mock.timers.tick(250);
  await flushSync();
  assert.equal(requests.length, 1, "focus/foreground/reconnect and multiple readers share one request");
  scheduler.invalidate("chats");
  scheduler.invalidate("chats");
  requests[0].resolve();
  await flushSync();
  mock.timers.tick(250);
  await flushSync();
  assert.equal(requests.length, 2, "invalidation during a read queues exactly one follow-up");
  scheduler.setActive(false);
  requests[1].resolve();
  await flushSync();
  mock.timers.tick(10000);
  await flushSync();
  assert.equal(requests.length, 2, "finishing in the background does not restart a timer");
  scheduler.setActive(true);
  mock.timers.tick(250);
  await flushSync();
  assert.equal(requests.length, 3);
  stop();
  stopSecondReader();
  scheduler.dispose();
  requests[2].resolve();
  await flushSync();
  mock.timers.tick(10000);
  await flushSync();
  assert.equal(requests.length, 3, "late old-account completions cannot revive disposed work");

  let attempts = 0;
  const retrying = createSyncScheduler({ active: true, random: () => 0.5 });
  retrying.watch("failed", { intervalMs: () => 1000, run: async () => { attempts++; throw new Error("offline"); } });
  mock.timers.tick(250);
  await flushSync();
  mock.timers.tick(1999);
  await flushSync();
  assert.equal(attempts, 1);
  mock.timers.tick(1);
  await flushSync();
  assert.equal(attempts, 2, "first failure doubles the request interval");
  mock.timers.tick(3999);
  await flushSync();
  assert.equal(attempts, 2);
  retrying.dispose();

  const admitted = [];
  const limited = createSyncScheduler({ active: true, random: () => 0.5 });
  for (let id = 0; id < 6; id++) limited.watch(String(id), { intervalMs: () => 1000, run: () => {
    const request = Promise.withResolvers(); admitted.push(request); return request.promise;
  } });
  mock.timers.tick(250);
  await flushSync();
  assert.equal(admitted.length, 4, "at most four automatic resource operations are admitted");
  admitted[0].resolve();
  await flushSync();
  assert.equal(admitted.length, 5, "queued resources are not starved");
  limited.dispose();
  for (const request of admitted) request.resolve();
  await flushSync();

  let deniedReads = 0;
  const denied = createSyncScheduler({ active: true, random: () => 0.5 });
  denied.watch("denied", { intervalMs: () => 1000, run: async () => { deniedReads++; throw new Error("status batch failed", { cause: { status: 403 } }); } });
  mock.timers.tick(250);
  await flushSync();
  mock.timers.tick(120000);
  await flushSync();
  assert.equal(deniedReads, 1, "permission failures do not retry indefinitely");
  denied.invalidate();
  mock.timers.tick(250);
  await flushSync();
  assert.equal(deniedReads, 2, "explicit invalidation can retry after access changes");
  denied.dispose();

  let suspendedReads = 0;
  const suspended = createSyncScheduler({ active: true });
  suspended.watch("suspended", { intervalMs: () => 1000, run: async () => { suspendedReads++; } });
  mock.timers.tick(250);
  suspended.setActive(false);
  await flushSync();
  assert.equal(suspendedReads, 0, "backgrounding between timer admission and execution suppresses the read");
  suspended.dispose();
} finally { mock.timers.reset(); }

const runningFixture = { id: "ancient", spaceId: "space", title: "Old running Chat", lastMessageAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", activeTurn: { id: "active", status: "running" } };
const slowRunningTail = Promise.withResolvers();
const runningProgress = [];
const progressiveRunning = loadRunningSessions({ user: { listSessions: async (options) => options.cursor ? slowRunningTail.promise : { sessions: [runningFixture], pageInfo: { hasMore: true, nextCursor: "slow-tail" } } } }, {
  signal: new AbortController().signal,
  onPage: (page) => runningProgress.push(page),
});
await flushSync();
assert.equal(runningProgress.length, 1, "the first Running page publishes without waiting for historical pages");
assert.deepEqual(runningProgress[0], [runningFixture]);
slowRunningTail.resolve({ sessions: [], pageInfo: { hasMore: false, nextCursor: null } });
assert.deepEqual(await progressiveRunning, [runningFixture]);
const discoveryPages = [];
const accountRunning = await loadRunningSessions({ user: { listSessions: async (options) => {
  discoveryPages.push(options);
  if (!options.cursor) return { sessions: Array.from({ length: 60 }, (_, index) => ({ ...runningFixture, id: String(index), activeTurn: null })), pageInfo: { hasMore: true, nextCursor: "older" } };
  if (options.cursor === "older") return { sessions: [], pageInfo: { hasMore: true, nextCursor: "oldest" } };
  return { sessions: [runningFixture], pageInfo: { hasMore: false, nextCursor: null } };
} } }, { source: ["web"], signal: new AbortController().signal });
assert.deepEqual(accountRunning, [runningFixture], "Running discovery reaches older pages and never stops at a time window");
assert.equal(discoveryPages.length, 3);
assert.ok(discoveryPages.every((page) => page.source[0] === "web"), "source membership is filtered by the server on every page");
for (const malformed of [
  { sessions: [{ ...runningFixture, activeTurn: undefined }], pageInfo: { hasMore: false } },
  { sessions: [runningFixture] },
  { sessions: [], pageInfo: { hasMore: true, nextCursor: null } },
]) await assert.rejects(loadRunningSessions({ user: { listSessions: async () => malformed } }, { signal: new AbortController().signal }), /server|pagination/);
await assert.rejects(loadRunningSessions({ user: { listSessions: async () => ({ sessions: [], pageInfo: { hasMore: true, nextCursor: "same" } }) } }, { signal: new AbortController().signal }), /did not advance/);
const discoveryAbort = new AbortController();
let discoveryReads = 0;
await assert.rejects(loadRunningSessions({ user: { listSessions: async () => {
  discoveryReads++;
  discoveryAbort.abort();
  return { sessions: [runningFixture], pageInfo: { hasMore: true, nextCursor: "next" } };
} } }, { signal: discoveryAbort.signal }), /cancelled/);
assert.equal(discoveryReads, 1, "background/account cancellation stops after the in-flight page without publishing partial results");

const cacheScanAt = Date.parse("2026-10-20T00:00:00Z");
const cachedRunning = parseCachedRunningSessions(JSON.stringify([
  runningFixture,
  { ...runningFixture, id: "settled", activeTurn: null },
  { id: "broken" },
]), cacheScanAt, cacheScanAt + 1000);
assert.equal(cachedRunning.sessions.length, 2);
assert.equal(parseCachedRunningSessions(JSON.stringify([runningFixture]), cacheScanAt, cacheScanAt + 31 * 24 * 60 * 60 * 1000), null, "stale Running snapshots are ignored");
assert.equal(parseCachedRunningSessions("not json", cacheScanAt, cacheScanAt), null);
assert.deepEqual(
  reconcileRunningSessions(
    [{ ...runningFixture, id: "web", source: "web", updatedAt: "2026-10-20T00:00:00Z" }],
    [{ ...runningFixture, id: "web", source: "web", updatedAt: "2026-10-19T00:00:00Z" }, { ...runningFixture, id: "older", source: "web" }],
  ).map((session) => [session.id, session.updatedAt]),
  [["web", "2026-10-20T00:00:00Z"], ["older", "2020-01-01T00:00:00Z"]],
  "server rows win and cached rows fill an unfinished scan",
);
assert.deepEqual(reconcileRunningSessions([], [{ ...runningFixture, activeTurn: null }]), [], "settled cached rows are not candidates");

const roomListeners = new Map();
const roomJoins = [];
const roomLeaves = [];
const roomEvents = [];
const roomErrors = [];
const realtime = createSpaceRealtime({
  subscribe: (id, listener) => { roomJoins.push(id); roomListeners.set(id, listener); return () => roomLeaves.push(id); },
  event: (event) => roomEvents.push(event), error: (error) => roomErrors.push(error),
});
const closeRoomA = realtime.watch(["space", "space"]);
const closeRoomB = realtime.watch(["space"]);
assert.equal(roomJoins.length, 0, "inactive apps do not join Space rooms");
realtime.setActive(true);
assert.deepEqual(roomJoins, ["space"], "multiple focused readers share one SDK subscription");
const removedRoomListener = roomListeners.get("space");
closeRoomA();
assert.equal(roomLeaves.length, 0);
realtime.setActive(false);
removedRoomListener({ type: "space.fs.changed", spaceId: "space", payload: {} });
assert.equal(roomEvents.length, 0, "released/background callbacks cannot update state");
realtime.setActive(true);
assert.equal(roomJoins.length, 2);
roomListeners.get("space")({ type: "system.subscribe.error", payload: { rejected: [{ room: "space:space" }] } });
assert.match(roomErrors.at(-1), /access was rejected/);
const releaseMany = realtime.watch(Array.from({ length: 12 }, (_, id) => `room-${id}`));
assert.equal(roomJoins.length - roomLeaves.length, 10, "room budget counts distinct Space IDs");
closeRoomB();
assert.equal(roomJoins.length - roomLeaves.length, 10, "freeing one room admits the next interested Space");
releaseMany();
realtime.dispose();
assert.equal(roomJoins.length, roomLeaves.length);
assert.deepEqual(spaceRealtimeChange({ type: "session.turn.patch", spaceId: "space", sessionId: "chat", payload: {} }), { exact: [], prefixes: [] }, "token patches never trigger HTTP invalidations");
const fileChange = spaceRealtimeChange({ type: "space.fs.changed", spaceId: "space", payload: {} });
assert.deepEqual(fileChange.prefixes, ["space:space:files:", "space:space:files-panel:"]);
assert.equal(fileChange.exact.length, 0, "file changes do not refetch unrelated task/resource sections");
const finishedTask = spaceRealtimeChange({ type: "task.updated", spaceId: "space", payload: { task: { id: "task", status: "completed" } } });
assert.ok(finishedTask.exact.includes("task:task") && finishedTask.exact.includes("space:space:resources"));
assert.deepEqual(spaceRealtimeChange({ type: "app.domain.updated", spaceId: "space", payload: { domain: { id: "d", appId: "app" } } }).exact, ["app:app:domains"]);
assert.deepEqual(spaceRealtimeChange({ type: "app.domain.removed", spaceId: "space", payload: { appId: "app", domainId: "d" } }).exact, ["app:app:domains"]);
assert.throws(() => spaceRealtimeChange({ type: "app.domain.removed", spaceId: "space", payload: {} }), /Invalid realtime App domain/);
const statusChange = spaceRealtimeChange({ type: "session.turn.updated", spaceId: "space", sessionId: "chat", payload: { turn: { id: "turn", sequence: 2, status: "running", updatedAt: "2026-09-16T00:00:00Z" } } });
assert.equal(statusChange.turn.status, "running");
const failedTurn = spaceRealtimeChange({ type: "session.turn.updated", spaceId: "space", sessionId: "chat", payload: { turn: { id: "turn", sequence: 2, status: "failed", errorMessage: "model overloaded" } } });
assert.equal(failedTurn.turn.errorMessage, "model overloaded", "a settled Turn carries its reason to the row instead of the empty preview");
// The list row reads the elapsed clock and reason from the Turn already fetched for its status.
const t = (key, vars = {}) => key + (Object.keys(vars).length ? ` ${JSON.stringify(vars)}` : "");
const running = sessionActivity({ activeTurn: { id: "turn", sequence: 2, status: "running", provider: null, model: null, startedAt: "2026-01-01T00:00:00Z", anchorUserMessageId: null } }, { status: "running", latestTurn: null, live: null, t, now: Date.parse("2026-01-01T03:05:00Z") });
assert.equal(running.text, 'ui.status.running session.activity.elapsedHours {"hours":3}', "running rows show elapsed buckets");
assert.equal(sessionActivity({ activeTurn: null }, { status: "failed", latestTurn: { id: "turn", sequence: 2, status: "failed", updatedAt: "2026-01-01T00:00:00Z", errorMessage: "model overloaded" }, live: null, t }).text, "ui.status.failed · model overloaded", "the fetched Turn explains a failed row");
assert.equal(sessionActivity({ activeTurn: null, lastTurnIssue: null }, { status: "idle", latestTurn: { id: "turn", sequence: 2, status: "completed", updatedAt: "2026-01-01T00:00:00Z", assistantText: "done" }, live: null, t }), null, "finished rows fall back to the preview");
assert.ok(statusChange.prefixes.includes("chats") && !statusChange.prefixes.includes("running:"), "Turn events update Running in place instead of rescanning the account");
assert.throws(() => spaceRealtimeChange({ type: "session.updated", spaceId: "space", sessionId: "chat", payload: { session: { id: "other", spaceId: "space" } } }), /Invalid realtime/);
assert.throws(() => spaceRealtimeChange({ type: "session.turn.updated", spaceId: "space", sessionId: "chat", payload: { turn: { id: "turn", status: "bogus" } } }), /Invalid realtime/);
const userTurnProjection = { type: "session.turn.updated", spaceId: "unwatched", sessionId: "chat", payload: { turn: { id: "turn", sessionId: "chat", sequence: 3, status: "completed", executionKind: "agent", updatedAt: "2026-10-12T00:00:00Z", errorMessage: null, summary: {}, meta: { userMessageId: null } } } };
const listedUserTurn = userSessionRealtimeChange(userTurnProjection, (id) => id === "chat");
assert.deepEqual(listedUserTurn.turn, { id: "turn", sequence: 3, status: "completed", updatedAt: "2026-10-12T00:00:00Z", errorMessage: null }, "user-room Turn projections update status for Chats in unwatched Spaces");
assert.deepEqual([listedUserTurn.exact, listedUserTurn.prefixes], [[], []], "a held Chat reconciles a user-room projection without HTTP reads");
assert.deepEqual(userSessionRealtimeChange(userTurnProjection, () => false).prefixes, ["chats"], "an unloaded Chat refreshes the list head; Running admits it with a single Chat read");
const userSnapshot = userSessionRealtimeChange({ type: "session.updated", spaceId: "unwatched", sessionId: "chat", payload: { session: { id: "chat", spaceId: "unwatched", updatedAt: "2026-10-12T00:00:01Z", latestMessageText: "done", lastMessageAt: "2026-10-12T00:00:01Z" } } }, () => true);
assert.equal(userSnapshot.session.latestMessageText, "done");
assert.deepEqual(userSessionRealtimeChange({ type: "space.fs.changed", spaceId: "unwatched", payload: {} }, () => false), { exact: [], prefixes: [] }, "user-room handling ignores Space-only events delivered on the shared socket");
assert.deepEqual(userSessionRealtimeChange({ type: "session.turn.patch", spaceId: "unwatched", sessionId: "chat", payload: {} }, () => false), { exact: [], prefixes: [] }, "assistant stream patches never reach list status");
assert.throws(() => userSessionRealtimeChange({ ...userTurnProjection, payload: { turn: { id: "turn", status: "bogus" } } }, () => true), /Invalid realtime/);
const activeTurnPatch = { type: "session.updated", spaceId: "unwatched", sessionId: "chat", payload: { session: { id: "chat", spaceId: "unwatched", activeTurn: { id: "turn", sequence: 4, status: "running" }, activeTurnSequence: 4, lastTurnIssue: null }, changed: ["activeTurn", "activeTurnSequence", "lastTurnIssue"] } };
assert.equal(spaceRealtimeChange(activeTurnPatch).session, undefined, "an activeTurn-only update has no revision to order metadata");
assert.deepEqual(userSessionRealtimeChange(activeTurnPatch, () => true), { exact: [], prefixes: [], sessionId: "chat" }, "an activeTurn-only update is accepted, not reported as invalid metadata");
assert.throws(() => spaceRealtimeChange({ ...activeTurnPatch, payload: { session: { ...activeTurnPatch.payload.session, updatedAt: "not-a-date" } } }), /Invalid realtime Chat metadata/);

mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
try {
  let scans = 0;
  const boundedSync = createSyncScheduler({ active: true, random: () => 0.5 });
  boundedSync.watch("running:all", { intervalMs: () => 120000, minRefreshMs: 30000, run: async () => { scans++; } });
  mock.timers.tick(250);
  await flushSync();
  for (let index = 0; index < 29; index++) { boundedSync.invalidatePrefix("running:"); mock.timers.tick(1000); await flushSync(); }
  assert.equal(scans, 1, "event bursts never cause repeated full-account scans within the cooldown");
  mock.timers.tick(1000);
  await flushSync();
  assert.equal(scans, 2, "continuous invalidations do not postpone the pending scan indefinitely");
  boundedSync.dispose();
} finally { mock.timers.reset(); }

const syncRows = Array.from({ length: 120 }, (_, index) => ({ id: String(1000 - index), spaceId: "space", lastMessageAt: new Date(200000 - index * 1000).toISOString(), updatedAt: new Date(200000 - index * 1000).toISOString() }));
const newHeadRow = { ...syncRows[0], id: "new", lastMessageAt: new Date(201000).toISOString(), updatedAt: new Date(201000).toISOString() };
const mergedHead = reconcileSessionHead(syncRows, [newHeadRow, ...syncRows.slice(0, 59)], true, 300000);
assert.equal(mergedHead.length, 121, "refreshing the first page retains loaded older pages");
assert.ok(mergedHead.some((row) => row.id === syncRows.at(-1).id));
const removedHead = reconcileSessionHead(syncRows, syncRows.slice(1, 61), true, 300000);
assert.ok(!removedHead.some((row) => row.id === syncRows[0].id), "missing rows within the authoritative head boundary are removed");
const eventRow = { ...syncRows[0], updatedAt: new Date(400000).toISOString(), title: "newer event" };
assert.equal(reconcileSessionHead([eventRow], [syncRows[0]], false, 300000)[0].title, "newer event");
assert.equal(reconcileSessionHead([eventRow], [], false, 300000).length, 1, "an event received after the read started survives an empty snapshot");
assert.equal(reconcileSessionHead(syncRows, [], false, 300000).length, 0);
assert.equal(reconcileSessionHead(syncRows, [], true, 300000), syncRows, "an empty nonterminal page cannot prove that cached rows were deleted");

assert.equal(isSettingsSection("channels"), true);
for (const invalid of [undefined, ["channels"], "constructor", "__proto__", "appearance"]) assert.equal(isSettingsSection(invalid), false);
const settingsItems = settingsMenu.flatMap((group) => group.items);
assert.equal(new Set(settingsItems.map((item) => item.href)).size, settingsItems.length);
assert.ok(settingsItems.some((item) => item.href === "/settings/storage"));
assert.ok(settingsItems.some((item) => item.href === "/settings/channels"));
assert.ok(settingsItems.some((item) => item.href === "/settings/browser"));
assert.equal(parseBrowserPreference(null), "system");
assert.equal(parseBrowserPreference("in-app"), "in-app");
assert.throws(() => parseBrowserPreference("embedded"), /Invalid browser preference/);
assert.ok(!readFileSync(new URL("../src/components/SettingsScreen.tsx", import.meta.url), "utf8").includes('accessibilityRole="tab"'));
assert.equal(isChannelProvider("wechat"), true);
for (const invalid of ["web", "unknown", ["discord"], undefined]) assert.equal(isChannelProvider(invalid), false);
const channelDraft = { name: " My bot ", token: " token ", appId: " app ", secret: " secret ", brand: "lark" };
assert.equal(missingChannelField("discord", { ...channelDraft, name: " " }), "name");
assert.equal(missingChannelField("discord", { ...channelDraft, token: " " }), "token");
assert.equal(missingChannelField("qq", { ...channelDraft, appId: " " }), "appId");
assert.equal(missingChannelField("feishu", { ...channelDraft, secret: " " }), "secret");
assert.equal(missingChannelField("wechat", { ...channelDraft, token: "", appId: "", secret: "" }), null);
const channelCreates = [];
const channelClient = { channels: { create: async (input) => channelCreates.push(input) } };
for (const provider of ["discord", "feishu", "qq"]) await createSettingsChannel(channelClient, provider, channelDraft);
assert.deepEqual(channelCreates, [
  { provider: "discord", name: "My bot", credentials: { token: "token" } },
  { provider: "feishu", name: "My bot", credentials: { appId: "app", appSecret: "secret", brand: "lark" } },
  { provider: "qq", name: "My bot", credentials: { appId: "app", clientSecret: "secret" } },
]);
await assert.rejects(createSettingsChannel(channelClient, "discord", { ...channelDraft, token: "" }), /token is required/);
assert.equal(channelCreates.length, 3, "invalid channel credentials never reach the SDK");
assert.equal(channelHealthState({ status: "active", boundSpace: null }), "unbound");
assert.equal(channelHealthState({ status: "active", boundSpace: { id: "space" } }), "connecting");
assert.equal(channelHealthState({ health: { state: "error" } }), "error");

const loginEvents = [];
const loginRequests = [];
const loginPoller = createWeChatLoginPoller((input) => new Promise((resolve, reject) => loginRequests.push({ input, resolve, reject })));
const reportLogin = (status) => loginEvents.push(status);
const reportLoginError = (error) => loginEvents.push(error);
const flushLogin = async () => { await Promise.resolve(); await Promise.resolve(); };
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
loginPoller.start("old", 20000, reportLogin, reportLoginError);
loginPoller.stop();
loginRequests[0].resolve({ connected: true, message: "connected" });
await flushLogin();
assert.equal(loginEvents.length, 0, "leaving the screen suppresses a late success");
loginPoller.start("new", 20000, reportLogin, reportLoginError);
loginRequests[1].resolve({ connected: false, needVerifyCode: true, message: "code" });
await flushLogin();
mock.timers.tick(1200);
assert.equal(loginRequests.length, 2, "verification pauses polling");
loginPoller.start("new", 20000, reportLogin, reportLoginError, "123456");
assert.deepEqual(loginRequests[2].input, { sessionKey: "new", verifyCode: "123456" });
loginRequests[2].resolve({ connected: false, message: "confirming" });
await flushLogin();
mock.timers.tick(1200);
assert.deepEqual(loginRequests[3].input, { sessionKey: "new", verifyCode: undefined }, "verification codes are sent once");
loginRequests[3].resolve({ connected: true, message: "connected" });
await flushLogin();
mock.timers.tick(1200);
assert.equal(loginRequests.length, 4, "successful login stops polling");
loginPoller.start("expired", 1000, reportLogin, reportLoginError);
assert.equal(loginEvents.at(-1).expired, true);
assert.equal(loginRequests.length, 4, "expired logins make no network request");
loginPoller.start("failed", 20000, reportLogin, reportLoginError);
const loginError = new Error("Network unavailable");
loginRequests[4].reject(loginError);
await flushLogin();
assert.equal(loginEvents.at(-1), loginError);
loginPoller.stop();
mock.timers.reset();

const activityNow = new Date(2026, 8, 12, 12);
const range = activityRange(activityNow);
assert.equal(range.from.getDay(), 0);
const activityDays = tokenDays([
  { bucketStartAt: new Date(2026, 8, 11, 1).toISOString(), totalTokens: 10 },
  { bucketStartAt: new Date(2026, 8, 11, 2).toISOString(), totalTokens: 30 },
  { bucketStartAt: new Date(2026, 8, 12, 1).toISOString(), totalTokens: 10 },
], range.from, range.to);
assert.equal(activityDays.length, 91);
assert.deepEqual(activityDays.at(-2), { date: "2026-09-11", tokens: 40, level: 4 });
assert.deepEqual(activityDays.at(-1), { date: localDateKey(activityNow), tokens: 10, level: 1 });
assert.equal(activityDays[0].level, 0);
assert.throws(() => tokenDays([{ bucketStartAt: "bad", totalTokens: 1 }], range.from, range.to), /Invalid token/);
assert.throws(() => tokenDays([{ bucketStartAt: activityNow.toISOString(), totalTokens: -1 }], range.from, range.to), /Invalid token/);

// Exercise the shared chrome's real JSX and callbacks without pretending to test native layout.
function loadChromeComponent(path, name, scope) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements = source.statements.filter((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => [name, "styles"].includes(declaration.name.getText(source))))
  ).map((statement) => statement.getText(source).replace(/^export (?:default )?/, ""));
  const code = ts.transpileModule(`${statements.join("\n")}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}
// className utilities as a set, for asserting the styling contract without a native renderer.
const classes = (node) => new Set(String(node.props.className ?? "").split(/\s+/).filter(Boolean));
// theme.ts builds its themes from the token module; evaluated in isolation, they need it in scope.
const themeTokenScope = { lightPalette, darkPalette, pureBlackOverrides, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }, radius: { sm: RADIUS.sm, md: RADIUS.md, lg: RADIUS.lg, pill: 999 } };
function chromeNodes(node) {
  if (Array.isArray(node)) return node.flatMap(chromeNodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...chromeNodes(node.props?.children)];
}
const chromeScope = {
  React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: "Fragment" },
  View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", IconButton: "IconButton", AppIcon: "AppIcon", TopBar: "TopBar",
  // Design-system primitives render as named placeholders, like the components above.
  Field: "Field", FIELD_INPUT_CLASS: "", Segmented: "Segmented", ListRow: "ListRow", Meta: "Meta", Tag: "Tag", AvatarStatus: "AvatarStatus", LIST_AVATAR_SIZE: 46, FilterChip: "FilterChip",
  StyleSheet: { create: (styles) => styles },
  COMPOSER_TEXT_PADDING,
  colorWithOpacity,
  edgeChrome: { headerMinHeight: 56, fade: 24 },
  recordDebugEvent: () => {},
  traceAction: () => {},
  setDialogOpen: () => {},
  nativeContextMenus: false, NativeContextMenu: "NativeContextMenu",
  nativeHeaders: false, useNativeHeader: () => {}, NAVIGATION_BAR_INSETS: {},
  useTranslation: () => ({ t: (key) => key }),
  typography: { heading: { fontSize: 17 }, caption: { fontSize: 12 }, body: { fontSize: 15 }, code: { fontSize: 12, lineHeight: 16 } },
  Keyboard: { addListener: () => ({ remove() {} }) }, Platform: { OS: "android" },
  AppRefreshControl: "AppRefreshControl",
  listRefreshProps: (options) => ({ refreshControl: { type: "AppRefreshControl", props: options } }),
  useAppTheme: () => ({ colors: { background: "background", text: "text", textMuted: "muted", textSecondary: "secondary", accent: "accent", accentSoft: "selected", surfacePressed: "pressed" } }),
};
// The Android ScrollView clones the refresh control and passes the list as children; the wrapper must forward them.
{
  const renderRefresh = loadChromeComponent("../src/ui/AppRefreshControl.tsx", "AppRefreshControl", {
    ...chromeScope,
    RefreshControl: "RefreshControl",
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length === 0 ? null : { children: children.length === 1 ? children[0] : children }) } }) },
  });
  const list = { type: "List" };
  const control = renderRefresh({ refreshing: false, onRefresh() {}, progressViewOffset: 103, children: list });
  assert.equal(control.type, "RefreshControl");
  assert.equal(control.props.children, list, "the wrapped list must reach the native refresh control");
  assert.equal(control.props.progressViewOffset, 103);
  assert.equal(control.props.colors[0], "accent");
}
// A minimal hook runner exercises real screen callbacks, not native layout or gestures.
function createScreenHooks() {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const changed = (previous, deps) => !previous || !deps || deps.some((value, index) => value !== previous.deps[index]);
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(current) { const index = cursor++; return slots[index] ??= { current }; },
    useMemo(factory, deps) {
      const index = cursor++;
      if (changed(slots[index], deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (changed(slots[index], deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: callback() };
      });
    },
  };
  return {
    hooks,
    render(run) { cursor = 0; const result = run(); while (effects.length) effects.shift()(); return result; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const translateForScreen = (key) => key;
const resourceKeys = ["env", "config", "ports", "allowedSpec", "members", "invitations", "mods", "schedules"];
const formScope = {
  ...chromeScope,
  useTranslation: () => ({ t: translateForScreen }),
  useAppTheme: () => ({ colors: {}, spacing: { md: 12, lg: 16 }, radius: { md: 12 } }),
  Screen: "Screen", ScrollView: "ScrollView", Avatar: "Avatar", PrimaryButton: "PrimaryButton",
  LoadingRows: "LoadingRows", LoadingFlatRows: "LoadingFlatRows", LoadingDocument: "LoadingDocument", LoadingSections: "LoadingSections", LoadingBlock: "LoadingBlock", DataError: "DataError", InlineError: "InlineError",
  SettingsGroup: "SettingsGroup", SettingsRow: "SettingsRow", SectionHeader: "SectionHeader", Metric: "Metric",
};

// Adding a Mod must open a real input on Android too; Alert.prompt is iOS-only.
{
  let cursor = 0;
  const slots = [];
  const requests = [];
  const alerts = [];
  let mods = [];
  const client = { space: () => ({ mods: { create: (input) => {
    const pending = Promise.withResolvers(); requests.push({ input, ...pending }); return pending.promise;
  } } }) };
  const renderSettings = loadChromeComponent("../app/space/[spaceId]/settings.tsx", "SpaceSettingsScreen", {
    ...chromeScope,
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef: (current) => { const index = cursor++; if (!(index in slots)) slots[index] = { current }; return slots[index]; },
    useEffect: () => {}, useFocusEffect: () => {}, useCallback: (callback) => callback, useRouter: () => ({}), useLocalSearchParams: () => ({ spaceId: "space" }),
    useApp: () => ({ client }), useToast: () => (notice) => alerts.push(notice),
    SettingsRow: "SettingsRow", SETUP_STATUS, sandboxSetupInfo, sandboxSetupStatus, formatWalletUsd, cronSummaryText: (_summary, expression) => expression, summarizeCron,
    useSpaceSettings: () => ({ env: [], config: null, ports: {}, allowedSpec: "standard", members: [], invitations: [], mods, setMods: (next) => { mods = next(mods); }, schedules: [], resources: Object.fromEntries(resourceKeys.map((key) => [key, { loaded: true, loading: false, error: null }])), loadResource: async () => {} }),
    ResourceStatus: "ResourceStatus",
    useAppTheme: () => ({ colors: {}, spacing: { md: 12 }, radius: { md: 12 } }),
    installSpaceMod,
    Alert: { prompt: () => {}, alert: (...args) => alerts.push(args) },
    Screen: "Screen", ScrollView: "ScrollView", SpecOptionList: "SpecOptionList", ActionButton: "ActionButton", Switch: "Switch",
    AdaptiveSheet: "AdaptiveSheet", PrimaryButton: "PrimaryButton", Loader: "Loader", LoadingState: "LoadingState", ListEdgeLoader: "ListEdgeLoader",
    DEFAULT_IDLE_TTL_SECONDS: 43200, MIN_IDLE_TTL_SECONDS: 60, MAX_IDLE_TTL_SECONDS: 2592000, CUSTOM_TTL_UNITS: { minutes: 60, hours: 3600, days: 86400 },
    specNeedsRestart: () => false, idleTtlChoices: () => [], formatIdleTtl: String,
    deviceRuntimeSupported: false, DeviceRuntimeSection: "DeviceRuntimeSection",
  });
  const render = () => { cursor = 0; return chromeNodes(renderSettings()); };
  const add = render().find((node) => node.props?.label === "space.settings.addMod" || String(node.props?.onPress).includes("Alert.prompt"));
  assert.ok(add, "Mods has an accessible Add control");
  add.props.onPress();
  const sheet = () => render().find((node) => node.type === "AdaptiveSheet");
  const input = () => render().find((node) => node.props.testID === "space-add-mod-input");
  const submit = () => render().find((node) => node.type === "PrimaryButton");
  assert.ok(sheet()?.props.visible, "Android Add opens the cross-platform Mod input instead of the unsupported Alert.prompt");
  assert.equal(submit().props.disabled, true, "an empty Mod ID cannot be submitted");
  sheet().props.onClose();
  assert.equal(sheet(), undefined, "Cancel dismisses without creating a Mod");
  assert.equal(requests.length, 0);
  add.props.onPress();
  const modId = "7a316e62-207b-480d-9cb0-7b62564129dc";
  input().props.onChangeText(`  ${modId}  `);
  const send = submit().props.onPress;
  send(); send();
  assert.equal(requests.length, 1, "rapid taps cannot install the same Mod twice");
  assert.deepEqual(requests[0].input, { modSpaceId: modId });
  assert.equal(input().props.editable, false);
  assert.equal(sheet().props.dismissible, false);
  assert.equal(submit().props.loading, true);
  requests[0].reject(new Error("Permission denied"));
  await flushSync();
  assert.equal(input().props.value, `  ${modId}  `, "a failed install keeps the entered ID for retry");
  assert.equal(sheet().props.dismissible, true);
  assert.ok(render().some((node) => node.type === "Text" && node.props.children.includes("Permission denied")));
  submit().props.onPress();
  const installed = { id: "mod", name: "Project tools", mountSlug: "tools", mountPath: "/mods/tools", modSpaceId: modId, enabled: true };
  requests[1].resolve({ item: installed, sandboxRestarting: true });
  await flushSync();
  assert.equal(sheet(), undefined, "successful installation closes the input sheet");
  assert.ok(render().some((node) => node.type === "Text" && node.props.children.includes(installed.name)), "the accepted Mod appears without another list request");
  assert.equal(alerts.at(-1).message, "space.settings.modRestarting");
  add.props.onPress();
  assert.equal(input().props.value, "");
  await assert.rejects(installSpaceMod(client, "space", "  "), /Mod Space ID/);
  assert.equal(requests.length, 2, "invalid input never reaches the SDK");
}

// The Space contributor renderer must show a human name, including when the API uses a UUID placeholder.
{
  const source = ts.createSourceFile("space.tsx", readFileSync(new URL("../app/space/[spaceId]/index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function findContributors(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "activity.contributors.items.slice(0, 5).map") expression = node.getText(source);
    ts.forEachChild(node, findContributors);
  }
  findContributors(source);
  assert.ok(expression);
  const scope = { ...chromeScope, Avatar: "Avatar", Meta: "Meta", formatNumber: String, activityContributorName, t: (key) => key, theme: { colors: {}, spacing: { sm: 8 } } };
  const render = new Function(...Object.keys(scope), "activity", ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText);
  const uuid = "7a316e62-207b-480d-9cb0-7b62564129dc";
  for (const [profile, expected] of [
    [{ displayName: "  Alice Chen  ", username: "alice" }, "Alice Chen"],
    [{ displayName: uuid, username: "alice" }, "alice"],
    [{ displayName: " ", username: "  alice  " }, "alice"],
    [{ displayName: uuid.toUpperCase(), username: uuid }, "space.activity.unknownContributor"],
    [null, "space.activity.unknownContributor"],
  ]) {
    const nodes = chromeNodes(render(...Object.values(scope), { contributors: { items: [{ userUuid: uuid, profile, requests: 42 }] } }));
    assert.equal(nodes.find((node) => node.type === "Avatar").props.name, expected);
    assert.ok(nodes.some((node) => node.type === "Text" && node.props.children.includes(expected)), "the name must be visible, not only passed to Avatar");
    assert.ok(!nodes.some((node) => node.type === "Text" && node.props.children.includes(uuid)));
    assert.equal(nodes.find((node) => node.type === "Text" && node.props.children.includes(expected)).props.numberOfLines, 1, "long names cannot overlap the request count");
  }
}

mock.timers.enable({ apis: ["Date"], now: activityNow.getTime() });
try {
  for (const [accent, border] of [["#b85427", "#e1e3df"], ["#f08349", "#2d333c"]]) {
    const renderHeatmap = loadChromeComponent("../src/components/ActivityHeatmap.tsx", "ActivityHeatmap", {
      ...chromeScope, memo: (component) => component, useMemo: (factory) => factory(),
      useAppTheme: () => ({ colors: { accent, border }, spacing: { xs: 4, sm: 8 } }),
      useTranslation: () => ({ locale: "en", t: (key) => key }), localDateKey,
      LEGEND_CELL_SIZE: 11, CELL_GAP: 3, DAYS_IN_WEEK: 7,
    });
    for (const days of [7, 30, 91]) {
      const tree = renderHeatmap({ hourly: [], days });
      const nodes = chromeNodes(tree);
      assert.ok(classes(tree).has("self-stretch"));
      const grid = nodes.find((node) => node.props.testID === (days === 7 ? "activity-heatmap-week" : "activity-heatmap-grid"));
      assert.ok(grid);
      if (days > 7) assert.equal(grid.props.style.flex, 1, "the grid fills the width remaining beside weekday labels");
      const columns = grid.props.children.flat().filter(Boolean);
      const flexFill = (node) => node.props.style ? node.props.style.flex === 1 && node.props.style.width === undefined : classes(node).has("flex-1") && ![...classes(node)].some((name) => /^w-/.test(name));
      assert.ok(columns.every(flexFill), "columns divide all available width instead of staying 11px wide");
      const cells = chromeNodes(grid).filter((node) => node.props.style?.aspectRatio === 1);
      assert.ok(cells.every((node) => node.props.style.width === undefined && node.props.style.height === undefined));
      assert.equal(cells.filter((node) => node.props.accessible).length, days, "only requested dates are active; calendar padding remains blank");
      if (days === 7) assert.equal(columns.length, 7, "a short range uses one full-width row, not oversized vertical weeks");
      assert.ok(cells.filter((node) => node.props.accessible).every((node) => node.props.style.backgroundColor === border), "an empty dataset remains an empty grid in either theme");
    }
    const populated = chromeNodes(renderHeatmap({ hourly: [{ bucketStartAt: activityNow.toISOString(), totalTokens: 20 }], days: 7 }));
    assert.equal(populated.find((node) => node.props.accessibilityLabel?.includes(": 20 tokens")).props.style.backgroundColor, accent);
  }
} finally { mock.timers.reset(); }

// Data requests triggered by tab focus must not activate the pull-to-refresh control.
for (const [tab, component, expectedRequests] of [
  ["(activity)/activity", "ActivityScreen", ["activity", "subscriptions"]],
  ["(spaces)/spaces", "SpacesScreen", ["home", "spaces"]],
  ["(chats)/index", "ChatsScreen", ["home"]],
]) {
  let cursor = 0;
  const slots = [];
  const requests = [];
  let pending = Promise.withResolvers();
  const request = (resource) => { requests.push(resource); return pending.promise; };
  const state = { booting: false, refreshing: true, spaces: [], sessions: [], sessionForks: {}, sessionViews: {}, sessionLatestTurns: {}, sessionTurnStatuses: {}, runningSessions: {}, sessionStatusRequests: 0 };
  const spaceList = { loading: true, overview: {}, visits: [], refresh: () => request("spaces") };
  const activityData = { loading: true, credits: { data: { netUsd: 1 }, error: null }, days: { data: [], error: null }, activity: { data: { hourly: [], days: 91 }, error: null }, refresh: () => request("activity") };
  const renderTab = loadChromeComponent(`../app/(tabs)/${tab}.tsx`, component, {
    ...chromeScope,
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback) => callback, useMemo: (factory) => factory(), useEffect: () => {}, useFocusEffect: () => {}, useSyncScope: () => {}, useSpaceRealtime: () => {},
    useRouter: () => ({}), useIsFocused: () => true, useScrollToTop: () => {}, useFloatingTabBarInset: () => 80,
    useEdgeChrome: () => ({ headerHeight: 103, onHeaderLayout: () => {} }), EdgeHeader: "EdgeHeader",
    useApp: () => ({ state, spaceList, userUuid: "user", client: {}, connectionState: "open", refreshHome: () => request("home") }),
    useActivity: () => activityData, useBillingHistory: () => ({ data: null, loading: true, load: () => request("subscriptions") }),
    useAppTheme: () => ({ colors: {}, spacing: {} }),
    useRemoteSearch: () => ({ query: "", sessions: [], spaces: [] }), useSpaceSessionCounts: () => ({}),
    useSourceSessions: () => ({ sessions: [], loading: false, loadingMore: false, error: null, hasMore: false, initialized: true, loadMore: () => {}, reload: () => {} }),
    useSessionFilterPreference: () => ({ loaded: true, minutes: 30 }), loadSessionFilterMinutes: async () => 30,
    useSessionSourcePreference: () => ({ filter: "all", loaded: true, error: null }), saveSessionSourcePreference: async () => {}, loadSessionSourcePreference: async () => "all",
    useToast: () => () => {},
    useDeviceRuntimeInstances: () => null, deviceRuntimeSupported: false, startDeviceRuntime: async () => null,
    useDeviceFolderBrowser: () => ({ listing: null, loading: false, failure: null, load: async () => {} }), DeviceFolderBrowser: "DeviceFolderBrowser",
    isDeviceRuntimeRunning, deviceFolderName, deviceRuntimeRefusalKey,
    sessionFilterCutoff, normalizeSearchQuery, buildSessionForkTree, selectSpaceList: () => [], personalSpaceActivity: () => new Map(), emptyRunningSessions, runningSessionCandidates, sessionListStatus,
    CHAT_SEARCH_TYPES: ["chat", "space"], SPACE_SEARCH_TYPES: ["space"],
    Screen: "Screen", ScrollView: "ScrollView", LegendList: "LegendList", RefreshControl: "RefreshControl",
    AccountAvatar: "AccountAvatar", TokenHeatmap: "TokenHeatmap", ActivityHeatmap: "ActivityHeatmap", PressableScale: "PressableScale",
    ConnectionBanner: "ConnectionBanner", DataError: "DataError", LoadingRows: "LoadingRows", SectionHeader: "SectionHeader",
    EmptyState: "EmptyState", ExpandableSearchBar: "ExpandableSearchBar", Loader: "Loader", LoadingState: "LoadingState", ListEdgeLoader: "ListEdgeLoader",
    AdaptiveSheet: "AdaptiveSheet", PrimaryButton: "PrimaryButton", FilterChip: "FilterChip", Segmented: "Segmented",
    AnchoredActionMenu: "AnchoredActionMenu", SettingsGroup: "SettingsGroup", SettingsRow: "SettingsRow", Field: "Field", FIELD_INPUT_CLASS: "",
    nativeMenus: false, NativeMenuButton: "NativeMenuButton",
  });
  const render = () => { cursor = 0; return chromeNodes(renderTab()); };
  const surface = () => render().find((node) => node.type === (tab.endsWith("activity") ? "ScrollView" : "LegendList"));
  const refresh = () => surface().props.refreshControl;
  const scrollSurface = surface();
  assert.equal(render().find((node) => node.type === "Screen").props.edgeToEdge, true);
  assert.equal(scrollSurface.props.contentContainerStyle.paddingTop, 103, `${tab}: initial content clears the measured header`);
  assert.equal(scrollSurface.props.contentContainerStyle.paddingBottom, 80, `${tab}: the last item clears the floating tabs`);
  assert.equal(refresh().props.progressViewOffset, 103, `${tab}: refresh feedback clears the header`);
  assert.equal(refresh().props.refreshing, false, `${tab}: automatic loading must not show the pull-to-refresh spinner`);
  assert.equal(requests.length, 0, `${tab}: rendering the refresh control does not start a request`);
  for (const failed of [false, true]) {
    pending = Promise.withResolvers();
    const task = refresh().props.onRefresh();
    assert.equal(refresh().props.refreshing, true, `${tab}: the pull gesture immediately shows feedback, even during automatic loading`);
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    assert.deepEqual(requests.splice(0), expectedRequests);
    if (failed) {
      state.error = "Unable to refresh";
      activityData.credits.error = state.error;
    }
    pending.resolve(); // Data hooks report failures in their resource state.
    await task;
    assert.equal(refresh().props.refreshing, false, `${tab}: completion stops the spinner on success and failure`);
    if (failed) assert.ok(render().some((node) => node.type === "DataError"), `${tab}: refresh errors remain actionable`);
  }
  state.error = null;
  if (tab === "(chats)/index") {
    // Replay the installed list's anchor algorithm with the real screen props.
    // This checks automatic scroll requests, not native navigation/layout itself.
    const legendSource = ts.createSourceFile("legend.js", readFileSync(new URL("../node_modules/@legendapp/list/react-native.js", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const mvcpCode = ["normalizeMaintainVisibleContentPosition", "prepareMVCP", "updateAnchorLock", "shouldQueueNativeMVCPAdjust"].map((name) => {
      const declaration = legendSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
      assert.ok(declaration, `installed LegendList has ${name}`);
      return declaration.getText(legendSource);
    }).join("\n");
    for (const platform of ["ios", "android"]) {
      for (const scroll of [0, 228]) {
        for (const change of ["status", "reorder", "prepend", "append", "remove", "empty"]) {
          state.sessions = Array.from({ length: 12 }, (_, index) => ({ ...runningFixture, id: `chat-${index}` }));
          const before = surface().props;
          const adjustments = [];
          const scope = {
            Platform: { OS: platform }, MVCP_POSITION_EPSILON: 0.1,
            getContentSize: ({ state: listState }) => listState.props.data.length * before.estimatedItemSize + 153,
            requestAdjust: (_ctx, amount) => adjustments.push(amount),
          };
          const { prepareMVCP, normalizeMaintainVisibleContentPosition } = new Function(...Object.keys(scope), `${mvcpCode}\nreturn { prepareMVCP, normalizeMaintainVisibleContentPosition };`)(...Object.values(scope));
          const firstVisible = Math.floor(scroll / before.estimatedItemSize);
          const listState = {
            props: { data: before.data, maintainVisibleContentPosition: normalizeMaintainVisibleContentPosition(before.maintainVisibleContentPosition) },
            idsInView: before.data.slice(firstVisible, firstVisible + 7).map(before.keyExtractor),
            indexByKey: new Map(before.data.map((row, index) => [before.keyExtractor(row), index])),
            positions: before.data.map((_, index) => index * before.estimatedItemSize),
            scroll, scrollLength: 600, didContainersLayout: true,
          };
          const restore = prepareMVCP({ state: listState }, true);
          const sessions = state.sessions;
          const newSession = { ...runningFixture, id: "new-chat" };
          state.sessions = change === "reorder" ? [sessions[2], sessions[0], sessions[1], ...sessions.slice(3)]
            : change === "prepend" ? [newSession, ...sessions]
            : change === "append" ? [...sessions, newSession]
            : change === "remove" ? sessions.slice(1)
            : change === "empty" ? []
            : sessions.map((session) => ({ ...session, activeTurn: null }));
          const after = surface().props;
          listState.props.data = after.data;
          listState.indexByKey.clear();
          after.data.forEach((row, index) => { listState.indexByKey.set(after.keyExtractor(row), index); listState.positions[index] = index * after.estimatedItemSize; });
          restore?.();
          assert.deepEqual(adjustments, [], `${platform}/${change} at ${scroll}: Chats updates must not scroll the filter header or change the user's offset`);
        }
      }
    }
  }
  if (tab === "(spaces)/spaces") {
    const list = surface();
    assert.notEqual(list.props.ListEmptyComponent.type, "LoadingRows", "returning to a loaded empty Spaces list must not flash skeletons");
    spaceList.overview = null;
    assert.equal(surface().props.ListEmptyComponent.type, "LoadingRows", "the first Spaces load still has a placeholder");
    assert.equal(refresh().props.refreshing, false, "the first Spaces load is not a pull gesture");
  }
}

// Independent settings reads retain successful sections and only retry the failed resource.
{
  const runner = createScreenHooks();
  let ports = Promise.withResolvers();
  let portReads = 0;
  let memberReads = 0;
  const client = {
    space: () => ({
      env: { list: async () => ({ env: [{ name: "MODE", value: "test" }] }) },
      getConfig: async () => ({ config: { sandbox: { spec: "boost" } } }),
      sandbox: { ports: () => { portReads++; return ports.promise; } },
      members: { list: async () => { memberReads++; return { items: [{ userId: "member" }] }; } },
      invitations: { list: async () => ({ items: [] }) }, mods: { list: async () => ({ items: [] }) },
    }),
    billing: { getFeatureEntitlement: async () => ({ enabled: true }) },
    cronJobs: { list: async () => ({ jobs: [] }) },
  };
  const useSettings = loadChromeComponent("../src/data/use-space-settings.ts", "useSpaceSettings", { ...formScope, ...runner.hooks, RESOURCE_KEYS: resourceKeys });
  const render = () => runner.render(() => useSettings(client, "space"));
  render(); await flushSync();
  assert.equal(render().resources.members.loaded, true, "a slow port read does not delay members");
  assert.equal(render().resources.ports.loading, true);
  ports.reject(new Error("Ports unavailable")); await flushSync();
  assert.equal(render().resources.ports.error, "Ports unavailable");
  assert.equal(render().resources.ports.loaded, false, "a failed first read is not an empty success");
  assert.equal(render().members.length, 1);
  ports = Promise.withResolvers();
  const retry = render().loadResource("ports");
  assert.equal(render().resources.ports.error, null);
  ports.resolve({ endpoints: { app: { port: 3000 } } }); await retry;
  assert.equal(render().ports.app.port, 3000);
  assert.equal(portReads, 2); assert.equal(memberReads, 1, "retry does not reload unrelated sections");
  const older = Promise.withResolvers(); ports = older;
  const first = render().loadResource("ports");
  ports = Promise.withResolvers();
  const second = render().loadResource("ports");
  ports.resolve({ endpoints: { app: { port: 4000 } } }); await second;
  older.resolve({ endpoints: { app: { port: 2000 } } }); await first;
  assert.equal(render().ports.app.port, 4000, "a late read cannot overwrite a newer retry");
  ports = Promise.withResolvers();
  const abandoned = render().loadResource("ports"); runner.unmount();
  ports.resolve({ endpoints: { app: { port: 5000 } } }); await abandoned;
  assert.equal(render().ports.app.port, 4000, "unmount invalidates pending reads");
}

// Navigation-level file protection shares the toolbar's editing/confirmation behavior.
{
  const runner = createScreenHooks();
  let guard;
  const alerts = [];
  let write = Promise.withResolvers();
  const file = { kind: "text", encoding: "utf-8", content: "original", size: 8, mtimeMs: 1 };
  const client = { space: () => ({ files: { read: async () => file, write: () => write.promise } }) };
  const renderFile = loadChromeComponent("../app/space/[spaceId]/file.tsx", "FileScreen", {
    ...formScope, ...runner.hooks,
    useRouter: () => ({ back() {} }), useLocalSearchParams: () => ({ spaceId: "space", path: "notes.txt" }),
    firstParam: (value) => value ?? "", useApp: () => ({ client }), useToast: () => () => {},
    usePreventRemove: (enabled, callback) => { guard = { enabled, callback }; },
    Alert: { alert: (...args) => alerts.push(args) }, detectCodeLanguage: () => "text", isEditableTextFile, isFileConflictError, classifySaveConflict,
    MAX_EDITABLE_CODE_BYTES: 512 * 1024, CodeBlock: "CodeBlock", CodeEditor: "CodeEditor", SaveBanner: "SaveBanner", FileError: "FileError", Loader: "Loader", LoadingState: "LoadingState", ListEdgeLoader: "ListEdgeLoader",
  });
  const render = () => chromeNodes(runner.render(renderFile));
  const actions = () => chromeNodes(render().find((node) => node.type === "TopBar").props.actions);
  render(); await flushSync(); render();
  assert.equal(guard.enabled, false, "read-only files do not block navigation");
  actions().find((node) => node.props.label === "file.edit").props.onPress(); render();
  assert.equal(guard.enabled, true);
  guard.callback({ data: { action: { type: "GO_BACK" } } });
  assert.equal(render().some((node) => node.type === "CodeEditor"), false, "the first system back exits clean editing");
  actions().find((node) => node.props.label === "file.edit").props.onPress();
  render().find((node) => node.type === "CodeEditor").props.onChangeText("unsaved"); render();
  guard.callback({ data: { action: { type: "GO_BACK" } } });
  assert.equal(alerts.at(-1)[0], "file.discard.title");
  assert.equal(render().find((node) => node.type === "CodeEditor").props.value, "unsaved", "canceling removal keeps edits");
  actions().find((node) => node.props.label === "file.save").props.onPress(); render();
  const alertCount = alerts.length;
  guard.callback({ data: { action: { type: "GO_BACK" } } });
  assert.equal(alerts.length, alertCount, "saving blocks removal without offering to discard an in-flight write");
  write.reject(new Error("offline")); await flushSync();
  assert.equal(render().find((node) => node.type === "CodeEditor").props.value, "unsaved");
  write = Promise.withResolvers();
  actions().find((node) => node.props.label === "file.save").props.onPress();
  write.resolve({ size: 7, mtimeMs: 2 }); await flushSync(); render();
  assert.equal(guard.enabled, false, "a successful save releases navigation protection");
  actions().find((node) => node.props.label === "file.edit").props.onPress();
  render().find((node) => node.type === "CodeEditor").props.onChangeText("discard me"); render();
  guard.callback({ data: { action: { type: "GO_BACK" } } });
  alerts.at(-1)[2].find((button) => button.style === "destructive").onPress(); render();
  assert.equal(guard.enabled, false, "confirmed discard returns to the file preview");
  runner.unmount();
}

// A failed profile mutation leaves the real form and Save action available, without reloading.
{
  const runner = createScreenHooks();
  let fail = true;
  let reads = 0;
  const writes = [];
  const profile = { displayName: "Old name", username: "old" };
  const client = { user: {
    getMe: async () => { reads++; return { profile, uuid: "user" }; },
    updateProfile: async (input) => { writes.push(input); if (fail) throw new Error("offline"); return { profile: input }; },
  } };
  const getClaims = async () => ({});
  const showNotice = () => {};
  const renderProfile = loadChromeComponent("../src/components/SettingsScreen.tsx", "ProfileSection", {
    ...formScope, ...runner.hooks, useProfileSession: () => ({ getClaims }),
  });
  const render = () => chromeNodes(runner.render(() => renderProfile({ client, onNotice: showNotice })));
  render(); await flushSync();
  render().find((node) => node.props.placeholder === "settings.profile.displayNamePlaceholder").props.onChangeText("New name");
  render().find((node) => node.type === "PrimaryButton").props.onPress(); await flushSync();
  assert.equal(render().some((node) => node.type === "InlineError"), false, "save errors cannot replace the form with a reload action");
  assert.equal(render().find((node) => node.props.placeholder === "settings.profile.displayNamePlaceholder").props.value, "New name");
  assert.ok(render().some((node) => node.props.accessibilityRole === "alert" && node.props.children.includes("offline")));
  fail = false;
  render().find((node) => node.type === "PrimaryButton").props.onPress(); await flushSync();
  assert.deepEqual(writes.map((input) => input.displayName), ["New name", "New name"]);
  assert.equal(reads, 1, "retry saves the draft rather than fetching the old profile");
  runner.unmount();
}

// Range changes must isolate data, errors, and loading state from older requests.
{
  const runner = createScreenHooks();
  const requests = [];
  const client = { user: { getActivity: ({ days }) => { const pending = Promise.withResolvers(); requests.push({ days, ...pending }); return pending.promise; } } };
  const renderActivity = loadChromeComponent("../src/components/SettingsScreen.tsx", "ActivitySection", { ...formScope, ...runner.hooks, formatNumber: String });
  const render = () => chromeNodes(runner.render(() => renderActivity({ client })));
  const data = (tokens) => ({ summary: { totalTokens: tokens }, rankings: { llmModels: [] } });
  render(); await flushSync();
  render().filter((node) => node.type === "Pressable")[0].props.onPress(); render(); await flushSync();
  assert.deepEqual(requests.map((request) => request.days), [30, 7]);
  requests[1].resolve(data(7)); await flushSync();
  requests[0].resolve(data(30)); await flushSync();
  assert.equal(render().find((node) => node.type === "Metric").props.value, "7");
  render().filter((node) => node.type === "Pressable")[2].props.onPress(); render(); await flushSync();
  render().filter((node) => node.type === "Pressable")[0].props.onPress(); render(); await flushSync();
  requests[2].reject(new Error("old range failed")); await flushSync();
  assert.ok(render().some((node) => node.type === "LoadingBlock"), "a superseded request cannot stop the current spinner");
  requests[3].resolve(data(77)); await flushSync();
  assert.equal(render().find((node) => node.type === "Metric").props.value, "77");
  assert.equal(render().some((node) => node.type === "InlineError"), false);
  runner.unmount();
}

// Returning from Work editing reloads authoritative metadata, retaining content if refresh fails.
{
  const runner = createScreenHooks();
  let focus;
  const requests = [];
  const client = { apps: { get: () => { const pending = Promise.withResolvers(); requests.push(pending); return pending.promise; } } };
  const renderWork = loadChromeComponent("../app/work/[appId].tsx", "WorkScreen", {
    ...formScope, ...runner.hooks, useFocusEffect: (callback) => { focus = callback; },
    useRouter: () => ({}), useLocalSearchParams: () => ({ appId: "work" }), useApp: () => ({ client }), AppHostWebView: "AppHostWebView", LoadingState: "LoadingState",
  });
  const render = () => chromeNodes(runner.render(renderWork));
  const detail = (title) => ({ app: { id: "work", meta: { title } }, space: { name: "Space" }, content: { url: "https://example.com/work" } });
  render(); let blur = focus();
  requests[0].resolve(detail("Old title")); await flushSync(); render();
  blur(); blur = focus();
  requests[1].resolve(detail("Saved title")); await flushSync();
  assert.equal(render().find((node) => node.type === "TopBar").props.title, "Saved title");
  blur(); blur = focus();
  requests[2].reject(new Error("offline")); await flushSync();
  assert.ok(render().some((node) => node.type === "AppHostWebView"), "refresh errors do not hide cached Work content");
  render().find((node) => node.type === "DataError").props.onRetry();
  requests[3].resolve(detail("Retried title")); await flushSync();
  assert.equal(render().some((node) => node.type === "DataError"), false);
  assert.equal(render().find((node) => node.type === "TopBar").props.title, "Retried title");
  blur(); runner.unmount();
}

// The real refresh entry point must bootstrap discovery after an uncached Chat failed to open.
{
  const source = ts.createSourceFile("context.tsx", readFileSync(new URL("../src/data/context.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function findRefresh(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "refreshSession") callback = node.initializer.getText(source);
    ts.forEachChild(node, findRefresh);
  }
  findRefresh(source); assert.ok(callback);
  let loads = 0;
  const scope = {
    useCallback: (fn) => fn, client: {}, dispatch: () => {}, userKey: "user",
    stateRef: { current: { sessionViews: {}, sessions: [] } },
    sessionLoadRef: { current: async (id) => { assert.equal(id, "uncached"); loads++; } },
  };
  const refresh = new Function(...Object.keys(scope), ts.transpileModule(`return (${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(scope));
  await refresh("uncached");
  assert.equal(loads, 1, "Retry must start the complete load, not return without a request");
  scope.stateRef.current.sessionViews.uncached = { session: { id: "uncached", spaceId: "space" }, space: null };
  await refresh("uncached");
  assert.equal(loads, 2, "a cached summary still needs the missing Space context and subscription setup");
}

// Subscription loading/failure is not "no subscription", and the card opens the matching history.
{
  const runner = createScreenHooks();
  const routes = [];
  let retries = 0;
  const subscriptions = { data: null, loading: true, error: null, load: async () => { retries++; } };
  const renderActivity = loadChromeComponent("../app/(tabs)/(activity)/activity.tsx", "ActivityScreen", {
    ...formScope, ...runner.hooks,
    useRouter: () => ({ push: (route) => routes.push(route) }), useScrollToTop: () => {}, useFloatingTabBarInset: () => 80,
    useEdgeChrome: () => ({ headerHeight: 100 }), useApp: () => ({ connectionState: "open" }),
    useActivity: () => ({ credits: { data: null, error: null }, activity: { data: null, error: null }, refresh: async () => {} }),
    useBillingHistory: () => subscriptions,
    EdgeHeader: "EdgeHeader", AccountAvatar: "AccountAvatar", RefreshControl: "RefreshControl", ConnectionBanner: "ConnectionBanner", PressableScale: "PressableScale", ActivityHeatmapSkeleton: "ActivityHeatmapSkeleton", SettingsGroup: "SettingsGroup", SettingsRow: "SettingsRow",
  });
  const render = () => chromeNodes(runner.render(renderActivity));
  const subscriptionRow = () => render().find((node) => node.type === "SettingsRow" && node.props.title === "activity.subscription.title");
  const empty = () => subscriptionRow().props.detail === "activity.subscription.none";
  assert.equal(empty(), false);
  subscriptions.loading = false; subscriptions.error = "offline";
  assert.equal(empty(), false, "an unsuccessful first read cannot become an empty subscription");
  render().find((node) => node.type === "DataError").props.onRetry();
  assert.equal(retries, 1);
  subscriptions.error = null; subscriptions.data = { kind: "subscriptions", list: { items: [] } };
  assert.equal(empty(), true, "only a resolved empty response displays no subscription");
  subscriptions.data.list.items = [{ status: "active", productName: "Current plan" }]; subscriptions.error = "refresh failed";
  assert.equal(subscriptionRow().props.detail, "Current plan", "refresh failure retains the last known subscription");
  subscriptionRow().props.onPress();
  assert.deepEqual(routes[0], { pathname: "/settings/billing-history", params: { kind: "subscriptions" } });
  const route = loadChromeComponent("../app/settings/billing-history.tsx", "BillingHistoryRoute", { ...chromeScope, useLocalSearchParams: () => routes[0].params, BillingHistoryScreen: "BillingHistoryScreen" });
  assert.equal(route().props.kind, "subscriptions");
}

// New Chat preserves cached spaces, separates initial loading/error/empty, and offers a next step.
{
  const runner = createScreenHooks();
  const state = { spaces: [], sessions: [], booting: true, refreshing: false, spacesError: null, error: null };
  const visits = [];
  let retries = 0;
  let destination;
  const renderNewChat = loadChromeComponent("../app/new-chat.tsx", "NewChatScreen", {
    ...formScope, ...runner.hooks, EmptyState: "EmptyState", SearchField: "SearchField", FlatList: "FlatList",
    useLocalSearchParams: () => ({}), useRouter: () => ({ dismissTo: (path) => { destination = path; } }),
    useApp: () => ({ state, refreshHome: async () => { retries++; }, spaceList: { visits } }), displaySpaceName: (space) => space.name,
    selectSpaceList, normalizeSearchQuery, useSafeAreaInsets: () => ({ bottom: 0 }),
  });
  const render = () => {
    const nodes = chromeNodes(runner.render(renderNewChat));
    const list = nodes.find((node) => node.type === "FlatList");
    return list.props.data.length === 0 ? [...nodes, ...chromeNodes(list.props.ListEmptyComponent)] : nodes;
  };
  assert.ok(render().some((node) => node.type === "LoadingFlatRows"));
  assert.equal(render().some((node) => node.type === "SearchField"), false, "no search field before there is anything to search");
  state.booting = false; state.spacesError = "offline";
  assert.equal(render().some((node) => node.type === "EmptyState"), false);
  render().find((node) => node.type === "DataError").props.onRetry(); assert.equal(retries, 1);
  state.spaces = [{ id: "space", name: "Cached Space" }];
  const list = render().find((node) => node.type === "FlatList");
  assert.deepEqual(list.props.data.map((space) => space.name), ["Cached Space"], "cached choices stay usable during a refresh failure");
  assert.ok(render().some((node) => node.type === "SearchField"));

  // Recently used Spaces come first, and the query filters the full list.
  const now = Date.now();
  state.spaces = [{ id: "stale", name: "Stale Space" }, { id: "fresh", name: "Fresh Space" }];
  visits.push({ spaceId: "fresh", timestamp: now - 60_000 });
  assert.deepEqual(render().find((node) => node.type === "FlatList").props.data.map((space) => space.id), ["fresh", "stale"], "the picker leads with recently used Spaces");
  const field = render().find((node) => node.type === "SearchField");
  field.props.onChangeText("stale");
  assert.deepEqual(render().find((node) => node.type === "FlatList").props.data.map((space) => space.id), ["stale"], "the query filters Spaces by name or description");
  field.props.onChangeText("missing");
  assert.ok(render().some((node) => node.type === "EmptyState"), "an unmatched query offers an empty state instead of a blank list");
  field.props.onChangeText("");

  state.spaces = []; state.spacesError = null;
  render().find((node) => node.type === "EmptyState").props.action.onPress();
  assert.equal(destination, "/(tabs)/spaces");
}

// Tap targets remain usable with large text, and empty-state actions have visible labels.
{
  const chip = loadChromeComponent("../src/components/FilterChip.tsx", "FilterChip", formScope)({ label: "Long filter label", selected: false, onPress() {} });
  assert.ok(classes(chip).has("min-h-12") && classes(chip).has("min-w-12"), "chips keep a 48pt touch target");
  assert.equal([...classes(chip)].some((name) => /^h-/.test(name)), false, "fixed height cannot clip enlarged text");
  let pressed = 0;
  const empty = loadChromeComponent("../src/ui.tsx", "EmptyState", formScope)({ icon: "search", title: "No results", action: { icon: "x", label: "Clear filters", onPress: () => { pressed++; } } });
  const action = chromeNodes(empty).find((node) => node.type === "PrimaryButton");
  assert.equal(action.props.label, "Clear filters", "action text must be visible, not only an accessibility label");
  action.props.onPress(); assert.equal(pressed, 1);
}

// Filters are compact capsules inside full-sized touch targets; theme colors come from tokens.
{
  const renderChip = loadChromeComponent("../src/components/FilterChip.tsx", "FilterChip", formScope);
  for (const selected of [false, true]) {
    let taps = 0;
    const chip = renderChip({ label: "Completed", selected, onPress: () => { taps++; } });
    assert.equal(chip.props.accessibilityState.selected, selected);
    assert.equal([...classes(chip)].some((name) => name.startsWith("bg-")), false, "the touch target must not become the visible surface");
    const surface = classes(chip.props.children[0]({ pressed: false }));
    assert.ok(surface.has("min-h-9"));
    assert.equal([...surface].some((name) => /^h-/.test(name)), false, "the label must still grow with larger text");
    assert.ok(surface.has("rounded-full"), "filters must remain fully rounded, not rounded rectangles");
    assert.ok(surface.has("overflow-hidden"), "clip the capsule surface to its rounded bounds");
    assert.equal([...surface].some((name) => name.startsWith("border")), false);
    assert.equal(surface.has("bg-accent"), selected, "the selected filter is the filled accent capsule");
    assert.ok(classes(chip.props.children[0]({ pressed: true })).has(selected ? "bg-accent-pressed" : "bg-surface-pressed"));
    chip.props.onPress();
    assert.equal(taps, 1);
  }
}

// The bubble clock and read receipt share one row; a wrapping row pushed the receipt outside a short bubble.
{
  const renderMeta = loadChromeComponent("../src/components/MessageContent.tsx", "BubbleMeta", { ...formScope, useAppTheme: () => ({ colors: { userBubbleMeta: "meta", textFaint: "faint" } }) });
  for (const local of [false, true]) {
    const row = renderMeta({ clock: "00:40", local, t: (key) => key });
    assert.equal(row.props.style?.flexWrap, undefined, "the meta row never wraps");
    assert.ok(classes(row).has("flex-row") && classes(row).has("shrink-0") && !classes(row).has("flex-wrap"), "clock and receipt stay on one row the bubble must fit");
  }
}

// Check the actual light/dark bubble tokens, including alpha-composited timestamps.
{
  const rgb = (hex) => hex.slice(1).match(/../g).map((value) => parseInt(value, 16));
  const luminance = (color) => color.map((value) => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const ratio = (left, right) => (Math.max(luminance(left), luminance(right)) + .05) / (Math.min(luminance(left), luminance(right)) + .05);
  for (const name of ["lightTheme", "darkTheme"]) {
    const { colors } = loadChromeComponent("../src/theme.ts", name, themeTokenScope);
    const background = rgb(colors.userBubble);
    for (const key of ["userBubbleText", "userBubbleLink", "userBubbleMeta"]) {
      const color = colors[key];
      const [r, g, b, alpha] = color.startsWith("rgba") ? color.match(/[\d.]+/g).map(Number) : [...rgb(color), 1];
      const foreground = [r, g, b].map((value, index) => value * alpha + background[index] * (1 - alpha));
      assert.ok(ratio(foreground, background) >= 4.5, `${name}.${key} must meet 4.5:1 contrast for small text`);
    }
  }
}

// Real ChatPanel refresh callbacks: server-created label filters and memberships update while open.
{
  let cursor = 0;
  const slots = [];
  const effects = [];
  const jobs = new Map();
  let remoteLabels = [];
  let remoteMembers = [];
  let labelsFetches = 0;
  const client = { space: () => ({ labels: {
    list: async () => { labelsFetches++; return { labels: remoteLabels }; },
    listItems: async () => ({ items: remoteMembers.map((resourceRef) => ({ resourceRef })) }),
  } }) };
  const renderPanel = loadChromeComponent("../src/components/SpacePanels.tsx", "ChatPanel", {
    ...chromeScope,
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef: (current) => { const index = cursor++; if (!(index in slots)) slots[index] = { current }; return slots[index]; },
    useCallback: (callback) => callback, useMemo: (factory) => factory(),
    useEffect: (callback, deps) => {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
    useSyncScope: (key, run, interval, enabled = true) => { if (enabled) jobs.set(key, { run, interval }); },
    useApp: () => ({ state: { sessionForks: {} }, sync: { invalidate() {}, invalidatePrefix() {} }, prefetchSession() {}, refreshSessionStatuses: async () => {}, rememberSessionForks() {} }),
    useRemoteSearch: () => ({ query: "", sessions: [], loading: false }),
    buildSessionForkTree, fetchSessionLabels, fetchLabelSessionIds, formatLabelRef, toUserSessionLabels, sessionSourceGroup, normalizeSearchQuery,
    mergePanelSessions: (current, incoming) => [...current, ...incoming],
    Avatar: "Avatar", PrimaryButton: "PrimaryButton", SearchField: "SearchField", ScrollView: "ScrollView", LegendList: "LegendList", SessionLabelSheet: "SessionLabelSheet", Loader: "Loader", LoadingState: "LoadingState", ListEdgeLoader: "ListEdgeLoader",
  });
  const props = { spaceId: "space", spaceName: "Space", sessions: [runningFixture], client, onChipsTouchChange() {}, onClose() {}, onNewChat() {}, onOpenSession() {} };
  const render = () => { cursor = 0; const nodes = chromeNodes(renderPanel(props)); while (effects.length) effects.shift()(); return nodes; };
  render();
  const labelsJob = jobs.get("space:space:labels");
  assert.equal(labelsJob.interval, 15000, "label definitions participate in foreground polling");
  await labelsJob.run();
  remoteLabels = [{ id: "web-label", name: "Created on web", source: "user", systemKey: null }];
  render();
  await jobs.get("space:space:labels").run();
  const chip = render().find((node) => node.type === "FilterChip" && node.props.label === "Created on web");
  assert.ok(chip, "new remote filters appear without closing the panel or pulling to refresh");
  assert.equal(labelsFetches, 2);
  chip.props.onPress();
  render();
  assert.equal(jobs.get("space:space:label-members:Created on web").interval, 15000);
  await jobs.get("space:space:label-members:Created on web").run();
  assert.equal(render().find((node) => node.type === "LegendList").props.data.length, 0);
  remoteMembers = [runningFixture.id];
  await jobs.get("space:space:label-members:Created on web").run();
  assert.equal(render().find((node) => node.type === "LegendList").props.data[0].session.id, runningFixture.id, "label assignments made on the web update the current filtered list");
  const change = spaceRealtimeChange({ type: "label.assignments.updated", spaceId: "space", payload: {} });
  assert.ok(change.exact.includes("space:space:labels"));
  assert.ok(change.prefixes.includes("space:space:label-members:"));
}

for (const success of ["#238552", "#62c994"]) {
  let selected = null;
  const renderHeatmap = loadChromeComponent("../src/components/TokenHeatmap.tsx", "TokenHeatmap", {
    ...chromeScope,
    useState: () => [selected, (value) => { selected = value; }],
    useAppTheme: () => ({ colors: { success, text: "text", textMuted: "muted", surfaceRaised: "empty" }, spacing: { xs: 4, sm: 8, lg: 16 } }),
  });
  const grid = renderHeatmap({ days: activityDays.slice(0, -2) });
  const cells = chromeNodes(grid).filter((node) => node.type === "Pressable");
  assert.equal(cells.length, 91);
  assert.equal(cells.filter((cell) => cell.props.disabled).length, 2, "future days are blank and disabled");
  assert.equal(cells[0].props.style.aspectRatio, 1, "heatmap cells stay square");
  cells[0].props.onPress();
  assert.equal(selected, activityDays[0].date);
  assert.equal(chromeNodes(renderHeatmap({ days: activityDays })).find((node) => node.type === "Pressable").props.accessibilityState.selected, true);
}
for (const background of ["#f7f7f5", "#0f1114", "#000000", "#12345680"]) {
  const backEvents = [];
  const renderTopBar = loadChromeComponent("../src/ui.tsx", "TopBar", { ...chromeScope, BarButtonContext: { Provider: "BarButtonContext.Provider" }, useAppTheme: () => ({ colors: { background } }), recordDebugEvent: (name) => backEvents.push(name) });
  let backCount = 0;
  const header = renderTopBar({ title: "A long inline title", subtitle: "Space / file.ts", onBack: () => backCount++, actions: { type: "actions" } });
  const headerClasses = classes(header);
  assert.ok(headerClasses.has("bg-background"), "an opaque header paints the screen background token");
  const transparentHeader = renderTopBar({ title: "Chats", transparent: true });
  assert.equal([...classes(transparentHeader)].some((name) => name.startsWith("bg-")), false, "a transparent header paints nothing");
  const renderScrim = loadChromeComponent("../src/ui/EdgeChrome.tsx", "EdgeScrim", { ...chromeScope, LinearGradient: "LinearGradient", SCRIM_CURVES: { top: [{ at: 0, alpha: 1 }, { at: 0.5, alpha: 0.5 }, { at: 1, alpha: 0 }], bottom: [{ at: 0, alpha: 1 }, { at: 0.6, alpha: 0.5 }, { at: 1, alpha: 0 }] }, useAppTheme: () => ({ colors: { background } }) });
  for (const edge of ["top", "bottom"]) {
    const root = renderScrim({ edge, solid: edge === "top" ? 24 : 0 });
    const scrim = chromeNodes(root).find((node) => node.type === "LinearGradient");
    assert.equal(scrim.props.colors[0], colorWithOpacity(background, 1));
    assert.equal(scrim.props.colors.at(-1), colorWithOpacity(background, 0));
    assert.equal(scrim.props.colors.length, scrim.props.locations.length);
    assert.ok(scrim.props.colors.every((color) => /^#[\da-f]{6}(?:[\da-f]{2})?$/.test(color)), "custom alpha colors must not become invalid ten-digit gradient colors");
    assert.equal(root.props.pointerEvents, "none", "the fade never intercepts scrolling or button presses");
    assert.equal(chromeNodes(root).some((node) => node.props?.style?.height === 24), edge === "top", "the status bar stays opaque");
    assert.equal(scrim.props.start.y, edge === "top" ? 0 : 1);
    assert.equal(scrim.props.end.y, edge === "top" ? 1 : 0);
  }
  assert.equal(header.props.style.minHeight, 56);
  assert.equal(header.props.style.maxHeight, undefined, "large text must be able to increase header height");
  assert.equal([...headerClasses].some((name) => /^(max-h-|h-|border)/.test(name)), false, "no fixed height or bottom border");
  const headerNodes = chromeNodes(header);
  assert.equal(headerNodes.find((node) => node.props?.accessibilityRole === "header").props.numberOfLines, 1);
  const backButton = headerNodes.find((node) => node.type === "IconButton");
  backButton.props.onPressIn();
  backButton.props.onPressOut();
  backButton.props.onTouchCancel();
  backButton.props.onPress();
  assert.equal(backCount, 1);
  assert.deepEqual(backEvents, ["navigation.back.press_in", "navigation.back.press_out", "navigation.back.touch_cancel", "navigation.back.dispatch"]);
  assert.ok(headerNodes.some((node) => node.type === "actions"));
  const searchHeader = renderTopBar({ title: "Chats", children: { type: "search-input" } });
  assert.ok(chromeNodes(searchHeader).some((node) => node.type === "search-input"));
  assert.ok(!chromeNodes(searchHeader).some((node) => node.props?.accessibilityRole === "header"), "search replaces the title instead of crowding it");
}
const scrimCurve = loadChromeComponent("../src/ui/EdgeChrome.tsx", "scrimCurve", { SCRIM_STEPS: 10 });
for (const hold of [0, 0.2]) {
  const curve = scrimCurve(hold);
  assert.deepEqual(curve[0], { at: 0, alpha: 1 }, "the fade starts opaque, so it meets the solid status bar without a line");
  assert.deepEqual(curve.at(-1), { at: 1, alpha: 0 });
  assert.ok(curve.every((point, index) => index === 0 || (point.at > curve[index - 1].at && point.alpha <= curve[index - 1].alpha)), "stops are distinct and never brighten");
}
for (const topInset of [24, 103, 160]) {
  const offset = chatListViewOffset(0.15, 8, topInset);
  assert.equal(offset, 8 + Math.max(0, Math.round(topInset * 0.85)), "a jumped-to turn lands below the overlaid chrome");
  assert.equal(chatListDistances(0, 1400 + topInset, 800).distanceToOldest, 0, "the oldest edge is the top of a chronological list");
  assert.equal(chatListDistances(1400 + topInset - 800, 1400 + topInset, 800).distanceToLatest, 0, "the newest edge is the bottom of a chronological list");
}
assert.equal(isChatRowVisible(0, 80, 103, 500), false, "a row behind the header is not read");
assert.equal(isChatRowVisible(610, 80, 103, 500), false, "a row behind the composer is not read");
assert.equal(isChatRowVisible(200, 80, 103, 500), true);
assert.equal(isChatRowVisible(588, 80, 103, 500), false, "less than 20 percent visible is not read");
assert.equal(isChatRowVisible(587, 80, 103, 500), true);
assert.equal(isChatRowVisible(-500, 4000, 103, 500), true, "a long message filling the readable viewport is visible");
assert.equal(isChatRowVisible(200, 0, 103, 500), false);
assert.equal(isChatRowVisible(200, 80, 103, 0), false);

const visibleRowEvents = [];
let viewportHeight = 800;
let rowTop = 680;
const measureRequests = [];
const visibilityCleanups = [];
const renderVisibleRows = loadChromeComponent("../src/components/use-chat-visible-rows.ts", "useChatVisibleRows", {
  useRef: (current) => ({ current }), useCallback: (callback) => callback,
  useEffect: (effect) => { visibilityCleanups.push(effect()); }, isChatRowVisible,
});
const visibleRows = renderVisibleRows({
  viewportRef: { current: { measureInWindow: (callback) => callback(0, 0, 390, viewportHeight) } },
  topInset: 103, bottomInset: 150,
  onVisible: ({ viewableItems }) => visibleRowEvents.push(viewableItems.map((item) => item.key)),
});
visibleRows.trackRow("row", { measureInWindow: (callback) => measureRequests.push(() => callback(0, rowTop, 390, 80)) });
visibleRows.onViewableItemsChanged({ viewableItems: [{ key: "row", isViewable: true, index: 0 }] });
measureRequests.shift()();
assert.deepEqual(visibleRowEvents.at(-1), [], "native measurements exclude a row covered by the composer");
rowTop = 540;
visibleRows.measureVisibleRows();
measureRequests.shift()();
assert.deepEqual(visibleRowEvents.at(-1), ["row"], "scrolling into the readable region updates visibility without a new FlatList candidate event");
viewportHeight = 600;
visibleRows.measureVisibleRows();
measureRequests.shift()();
assert.deepEqual(visibleRowEvents.at(-1), [], "keyboard resize updates the readable viewport");
const previousVisibilityEvents = visibleRowEvents.length;
visibleRows.measureVisibleRows();
visibleRows.onViewableItemsChanged({ viewableItems: [] });
measureRequests.shift()();
assert.equal(visibleRowEvents.length, previousVisibilityEvents + 1, "stale measurements cannot restore outdated read candidates");
visibleRows.onViewableItemsChanged({ viewableItems: [{ key: "row", isViewable: true, index: 0 }] });
visibilityCleanups.forEach((cleanup) => cleanup());
measureRequests.shift()();
assert.equal(visibleRowEvents.length, previousVisibilityEvents + 1, "unmount cancels pending visibility callbacks");

const chatMenuInput = { anchor: { x: 338, y: 53, width: 44, height: 44 }, viewport: { x: 0, y: 47, width: 390, height: 763 }, bottomInset: 34 };
const chatMenuLayout = getAnchoredMenuLayout(chatMenuInput);
assert.deepEqual(chatMenuLayout, { left: 202, top: 54, width: 180, maxHeight: 667 });
assert.equal(getAnchoredMenuLayout({ ...chatMenuInput, contentWidth: 140 }).width, 180, "short menus retain the minimum width");
assert.equal(getAnchoredMenuLayout({ ...chatMenuInput, contentWidth: 230 }).width, 230, "menus expand to their content width");
assert.equal(getAnchoredMenuLayout({ ...chatMenuInput, contentWidth: 400 }).width, 280, "long menus respect the maximum width");
assert.equal(getAnchoredMenuLayout({ ...chatMenuInput, contentWidth: 230, viewport: { ...chatMenuInput.viewport, width: 160 } }).width, 144, "narrow screens take precedence over the minimum width");
assert.equal(chatMenuLayout.left + chatMenuLayout.width, chatMenuInput.anchor.x + chatMenuInput.anchor.width, "menu aligns to the trigger's right edge");
assert.equal(chatMenuLayout.top + chatMenuInput.viewport.y, chatMenuInput.anchor.y + chatMenuInput.anchor.height + 4, "menu opens below the trigger, not from the bottom");
assert.deepEqual(getAnchoredMenuLayout({ ...chatMenuInput, anchor: { ...chatMenuInput.anchor, x: 358, y: 83 }, viewport: { ...chatMenuInput.viewport, x: 20, y: 77 } }), chatMenuLayout, "screen-local coordinates account for safe areas and window offsets");
for (const width of [240, 320, 390, 844]) {
  for (const height of [180, 260, 763]) {
    const layout = getAnchoredMenuLayout({ anchor: { x: width - 52, y: 6, width: 44, height: 44 }, viewport: { x: 0, y: 0, width, height }, bottomInset: 0 });
    assert.ok(layout.left >= 8);
    assert.ok(layout.left + layout.width <= width - 8);
    assert.ok(layout.top + layout.maxHeight <= height - 8);
    assert.ok(layout.maxHeight > 0, "landscape/keyboard-constrained menus must retain scrollable space");
  }
}
const chatMenuEvents = [];
let menuBackHandler;
let menuBackRemoved = false;
let menuFocused = true;
const menuCleanups = [];
const renderChatMenu = loadChromeComponent("../src/components/AnchoredActionMenu.tsx", "AnchoredActionMenu", {
  ...chromeScope,
  ScrollView: "ScrollView",
  PopoverSurface: "PopoverSurface",
  GlassBackground: "GlassBackground",
  useGlassMaterial: () => "solid",
  RADIUS,
  useRef: () => ({ current: null }),
  useState: () => [chatMenuLayout, () => undefined],
  useCallback: (callback) => callback,
  useLayoutEffect: () => undefined,
  useEffect: (effect) => { menuCleanups.push(effect()); },
  useSafeAreaInsets: () => ({ bottom: 34 }),
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  useIsFocused: () => menuFocused,
  BackHandler: { addEventListener: (name, callback) => { assert.equal(name, "hardwareBackPress"); menuBackHandler = callback; return { remove: () => { menuBackRemoved = true; } }; } },
  getAnchoredMenuLayout,
});
const chatMenuProps = {
  anchorRef: { current: null }, title: "Current chat", testID: "chat-actions-menu", onClose: () => chatMenuEvents.push("close"),
  actions: [
    { icon: "share", title: "Share", onPress: () => chatMenuEvents.push("share") },
    { icon: "tag", title: "Labels", disabled: true, onPress: () => chatMenuEvents.push("labels") },
  ],
};
const menuNodes = chromeNodes(renderChatMenu(chatMenuProps));
const menuItems = menuNodes.filter((node) => node.props?.accessibilityRole === "menuitem");
assert.deepEqual(menuNodes.filter((node) => node.type === "Text").flatMap((node) => node.props.children), ["Share", "Labels"], "action menus show only action names, not a duplicate chat or space title");
assert.equal(menuNodes.find((node) => node.props?.accessibilityRole === "menu").props.accessibilityLabel, "Current chat", "the menu retains its screen-reader context");
assert.equal(menuNodes.find((node) => node.props?.accessibilityRole === "menu").props.testID, "chat-actions-menu");
assert.equal(menuItems.length, 2);
assert.equal(menuItems[1].props.disabled, true);
assert.equal(menuItems[1].props.accessibilityState.disabled, true);
menuItems[0].props.onPress();
assert.deepEqual(chatMenuEvents.splice(0), ["close", "share"], "close the menu before executing Share or opening another surface");
menuNodes.find((node) => node.props?.accessibilityRole === "button").props.onPress();
assert.deepEqual(chatMenuEvents.splice(0), ["close"]);
menuNodes.find((node) => node.props?.accessibilityRole === "menu").props.onAccessibilityEscape();
assert.deepEqual(chatMenuEvents.splice(0), ["close"]);
assert.equal(menuBackHandler(), true);
assert.deepEqual(chatMenuEvents.splice(0), ["close"], "Android back dismisses the menu without navigating away");
assert.equal(menuNodes.find((node) => node.type === "ScrollView").props.keyboardShouldPersistTaps, "always");
assert.ok(!menuNodes.some((node) => node.type === "Modal"), "opening a native share sheet must not compete with another Modal");
menuCleanups[0]();
assert.equal(menuBackRemoved, true);
menuFocused = false;
renderChatMenu(chatMenuProps);
assert.deepEqual(chatMenuEvents.splice(0), ["close"], "leaving the chat must dismiss its menu");

// Read the actual Space menu declaration so the migration cannot silently drop an operation.
const spaceMenuSource = ts.createSourceFile("space.tsx", readFileSync(new URL("../app/space/[spaceId]/index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let spaceMenuElement;
function findSpaceMenu(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(spaceMenuSource) === "AnchoredActionMenu") spaceMenuElement = node;
  ts.forEachChild(node, findSpaceMenu);
}
findSpaceMenu(spaceMenuSource);
assert.ok(spaceMenuElement);
// The menu takes a named list (the iOS system menu shares it), so follow the name to its declaration.
const spaceMenuActionsName = spaceMenuElement.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(spaceMenuSource) === "actions").initializer.expression.getText(spaceMenuSource);
let spaceMenuActions;
function findSpaceMenuActions(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(spaceMenuSource) === spaceMenuActionsName) spaceMenuActions = node.initializer.getText(spaceMenuSource);
  ts.forEachChild(node, findSpaceMenuActions);
}
findSpaceMenuActions(spaceMenuSource);
assert.ok(spaceMenuActions, "the Space menu's actions are declared in the screen");
const buildSpaceActions = new Function("space", "pinning", "t", "setActivePanel", "togglePin", "router", "checkpointing", "createCheckpoint", ts.transpileModule(`return (${spaceMenuActions});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
for (const isPinned of [false, true]) {
  for (const pinning of [false, true]) {
    const events = [];
    const actions = buildSpaceActions({ id: "space-123", isPinned }, pinning, (key) => key, (panel) => events.push(panel), () => events.push("togglePin"), { push: (route) => events.push(route) }, false, () => events.push("checkpoint"));
    assert.deepEqual(actions.map((action) => action.icon), ["messages", "square-pen", isPinned ? "pin-off" : "pin", "folder-open", "bookmark"]);
    assert.equal(actions[2].title, isPinned ? "space.unpin" : "space.pin");
    assert.equal(actions[2].disabled, pinning);
    menuFocused = true;
    const spaceMenu = renderChatMenu({ anchorRef: { current: null }, title: "Space", testID: "space-actions-menu", onClose: () => events.push("close"), actions });
    assert.equal(chromeNodes(spaceMenu).find((node) => node.props?.accessibilityRole === "menu").props.testID, "space-actions-menu");
    const items = chromeNodes(spaceMenu).filter((node) => node.props?.accessibilityRole === "menuitem");
    items[0].props.onPress();
    assert.deepEqual(events.splice(0), ["close", "chat"]);
    items[1].props.onPress();
    assert.deepEqual(events.splice(0), ["close", { pathname: "/space/[spaceId]/edit", params: { spaceId: "space-123" } }]);
    if (!pinning) {
      items[2].props.onPress();
      assert.deepEqual(events.splice(0), ["close", "togglePin"]);
    } else assert.equal(items[2].props.disabled, true);
    items[3].props.onPress();
    assert.deepEqual(events.splice(0), ["close", { pathname: "/space/[spaceId]/files", params: { spaceId: "space-123" } }]);
  }
}

// Spaces uses the capsule for the create sheet's Cloud / This device choice.
for (const [path, labels, chips] of [
  ["../app/(tabs)/(spaces)/spaces.tsx", ["Recent", "All", "Pinned"], 2],
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source, /import \{ FilterChip \} from "@\/src\/components\/FilterChip"/);
  assert.equal((source.match(/<FilterChip\s/g) ?? []).length, chips, "all filters must use the shared capsule");
  const theme = loadChromeComponent("../src/theme.ts", "darkTheme", themeTokenScope);
  const renderChip = loadChromeComponent("../src/components/FilterChip.tsx", "FilterChip", { ...chromeScope, useAppTheme: () => theme });
  for (const label of labels) {
    for (const selected of [false, true]) {
      let pressed = false;
      const chip = renderChip({ label, selected, icon: label === "Pinned" ? "pin" : undefined, onPress: () => { pressed = true; } });
      assert.equal(chip.props.accessibilityRole, "tab");
      assert.equal(chip.props.accessibilityState.selected, selected);
      assert.equal(chip.props.accessibilityLabel, label);
      const content = chip.props.children[0]({ pressed: false });
      assert.deepEqual(chromeNodes(content).filter((node) => node.type === "Text").flatMap((node) => node.props.children), [label], "filter names must be visible without long-pressing");
      if (label === "Pinned") assert.ok(chromeNodes(content).some((node) => node.type === "AppIcon" && node.props.name === "pin"));
      chip.props.onPress();
      assert.equal(pressed, true);
    }
  }
}
// This device lists the Spaces it serves, including one no longer loaded, and leads to creating one.
{
  const screen = createScreenHooks();
  const pushes = [];
  let instances = [
    { spaceId: "space-a", root: "/storage/emulated/0/Notes", label: "Internal storage/Notes", state: "ready", error: null },
    { spaceId: "space-gone", root: "/storage/emulated/0/Old", label: "Internal storage/Old", state: "stopped", error: null },
  ];
  const state = { booting: false, spaces: [{ id: "space-a", name: "Field notes", description: null, isPinned: false }, { id: "space-b", name: "Cloud", isPinned: false }], sessions: [], sessionViews: {} };
  const renderSpaces = loadChromeComponent("../app/(tabs)/(spaces)/spaces.tsx", "SpacesScreen", {
    ...chromeScope, ...screen.hooks,
    useFocusEffect: () => {}, useSyncScope: () => {}, useScrollToTop: () => {}, useFloatingTabBarInset: () => 80,
    useRouter: () => ({ push: (route) => pushes.push(route) }),
    useEdgeChrome: () => ({ headerHeight: 0, onHeaderLayout: () => {} }), EdgeHeader: "EdgeHeader",
    useApp: () => ({ state, spaceList: { loading: false, overview: { spaces: [] }, visits: [], refresh: async () => {} }, userUuid: "user", client: {}, refreshHome: async () => {} }),
    useAppTheme: () => ({ colors: {}, spacing: {} }),
    useRemoteSearch: (_client, _query, options) => ({ query: "", spaces: [], enabled: options.enabled }), useSpaceSessionCounts: () => ({}),
    useToast: () => () => {},
    useDeviceRuntimeInstances: () => instances, deviceRuntimeSupported: true, startDeviceRuntime: async () => null,
    useDeviceFolderBrowser: () => ({ listing: null, loading: false, failure: null }), DeviceFolderBrowser: "DeviceFolderBrowser", DeviceSpaceRow: "DeviceSpaceRow",
    isDeviceRuntimeRunning, deviceFolderName, deviceRuntimeRefusalKey, normalizeSearchQuery, displaySpaceName: (space) => space.name,
    selectSpaceList: ({ spaces }) => spaces, personalSpaceActivity: () => new Map(), SPACE_SEARCH_TYPES: ["space"],
    Screen: "Screen", LegendList: "LegendList", AccountAvatar: "AccountAvatar", DataError: "DataError", LoadingRows: "LoadingRows", Field: "Field", FIELD_INPUT_CLASS: "",
    EmptyState: "EmptyState", ExpandableSearchBar: "ExpandableSearchBar", Loader: "Loader", LoadingState: "LoadingState", ListEdgeLoader: "ListEdgeLoader",
    AdaptiveSheet: "AdaptiveSheet", PrimaryButton: "PrimaryButton", FilterChip: "FilterChip", SpaceRow: "SpaceRow", SpaceSearchRow: "SpaceSearchRow",
    nativeMenus: false, NativeMenuButton: "NativeMenuButton", AnchoredActionMenu: "AnchoredActionMenu",
  });
  const render = () => chromeNodes(screen.render(() => renderSpaces()));
  const list = () => render().find((node) => node.type === "LegendList");
  chromeNodes(render().find((node) => node.type === "ExpandableSearchBar").props.filters).find((node) => node.type === "Pressable").props.onPress();
  const deviceAction = () => render().find((node) => node.type === "AnchoredActionMenu").props.actions.find((action) => action.title === "deviceRuntime.thisDevice");
  deviceAction().onPress();
  assert.equal(deviceAction().checked, true);
  assert.deepEqual(list().props.data.map((item) => [item.kind, item.instance.spaceId, item.space?.name ?? null]), [["device", "space-a", "Field notes"], ["device", "space-gone", null]], "only served Spaces are listed; an unloaded one stays manageable");
  const row = chromeNodes(list().props.renderItem({ item: list().props.data[0] }))[0];
  assert.equal(row.type, "DeviceSpaceRow");
  row.props.onPress();
  assert.deepEqual(pushes.splice(0), [{ pathname: "/space/[spaceId]", params: { spaceId: "space-a" } }]);
  render().find((node) => node.type === "ExpandableSearchBar").props.onQueryChange("old");
  assert.deepEqual(list().props.data.map((item) => item.instance.spaceId), ["space-gone"], "a query also matches the folder");
  render().find((node) => node.type === "ExpandableSearchBar").props.onQueryChange("");
  instances = [];
  const empty = list().props.ListEmptyComponent;
  assert.equal(empty.props.title, "spaces.empty.device.title");
  empty.props.action.onPress();
  const sheet = render().find((node) => node.type === "AdaptiveSheet");
  assert.equal(sheet.props.visible, true);
  assert.ok(chromeNodes(sheet).some((node) => node.type === "FilterChip" && node.props.icon === "smartphone" && node.props.selected), "creating from the empty state starts on this device");
  screen.unmount();
}
const fadeAnimation = { duration: () => fadeAnimation };
const renderConnectionBanner = loadChromeComponent("../src/ui.tsx", "ConnectionBanner", { ...chromeScope, Animated: { View: "Animated.View" }, FadeIn: fadeAnimation, FadeOut: fadeAnimation, motion: { fade: { duration: 150 } } });
assert.equal(renderConnectionBanner({ visible: false }), null, "routine connection states must not show a banner");
{
  const nodes = chromeNodes(renderConnectionBanner({ visible: true }));
  assert.ok(classes(nodes[0]).has("absolute"), "the banner overlays content instead of resizing the header");
  assert.ok(nodes.some((node) => node.type === "AppIcon" && node.props.name === "cloud-off"));
  assert.deepEqual(nodes.filter((node) => node.type === "Text").flatMap((node) => node.props.children), ["ui.banner.unavailable"], "actual connection failures remain visible");
}
let searchExpanded;
let searchQuery = "";
let createdChats = 0;
let keyboardDismissals = 0;
let searchFocuses = 0;
const searchInputRef = { current: { focus: () => searchFocuses++ } };
const exposedSearchRef = { current: null };
const searchEffects = [];
const renderSearchBar = loadChromeComponent("../src/ui/ExpandableSearchBar.tsx", "ExpandableSearchBar", {
  ...chromeScope,
  useState: (initial) => { searchExpanded ??= initial; return [searchExpanded, (value) => { searchExpanded = value; }]; },
  useRef: () => searchInputRef,
  useEffect: (effect) => { searchEffects.push(effect); },
  Keyboard: { dismiss: () => keyboardDismissals++ },
});
const searchProps = () => ({ title: "Chats", query: searchQuery, onQueryChange: (query) => { searchQuery = query; }, queryRef: exposedSearchRef, onCreate: () => createdChats++, createLabel: "New chat" });
const searchAction = (tree, name) => chromeNodes(tree.props.actions).find((node) => node.props?.name === name);
let searchTree = renderSearchBar(searchProps());
assert.equal(chromeNodes(searchTree).some((node) => node.type === "TextInput"), false);
searchAction(searchTree, "plus").props.onPress();
assert.equal(createdChats, 1);
searchAction(searchTree, "search").props.onPress();
searchTree = renderSearchBar(searchProps());
const searchInput = chromeNodes(searchTree).find((node) => node.type === "TextInput");
assert.equal(searchInput.props.autoFocus, true);
assert.equal(searchTree.props.actions, undefined, "empty search has no redundant clear/create controls");
const releaseSearchRef = searchEffects.at(-1)();
assert.equal(exposedSearchRef.current, searchInputRef.current);
searchInput.props.onChangeText("project");
searchTree = renderSearchBar(searchProps());
assert.equal(chromeNodes(searchTree).find((node) => node.type === "TextInput").props.value, "project");
searchAction(searchTree, "x").props.onPress();
assert.equal(searchQuery, "");
assert.equal(searchFocuses, 1);
assert.equal(searchExpanded, true, "clearing search retains the editing mode");
searchInput.props.onChangeText("another query");
searchTree.props.onBack();
assert.equal(searchQuery, "");
assert.equal(searchExpanded, false);
assert.equal(keyboardDismissals, 1);
releaseSearchRef();
assert.equal(exposedSearchRef.current, null);
assert.ok(searchAction(renderSearchBar(searchProps()), "plus"), "closing search restores creation");

const scrollTrace = new ChatScrollTrace();
scrollTrace.record("ignored", "test");
assert.equal(scrollTrace.snapshot().entries.length, 0);
assert.throws(() => scrollTrace.resume(), /Start a recording/);
const debugTraceEvents = [];
setDebugTraceSink((name, fields) => debugTraceEvents.push({ name, fields }));
scrollTrace.start({ platform: "android" });
assert.equal(debugTraceEvents[0].name, "chat.scroll.recording.start");
assert.equal(debugTraceEvents[0].fields.source, "recorder");
assert.equal(scrollTrace.alias("session", "private-session-id"), "session-1");
assert.equal(scrollTrace.alias("session", "private-session-id"), "session-1");
assert.equal(scrollTrace.alias("message", "private-message-id"), "message-1");
for (let index = 0; index < 4010; index++) scrollTrace.record("list.scroll", "test", { y: index });
let traceSnapshot = scrollTrace.snapshot();
assert.equal(traceSnapshot.entries.length, 4000);
assert.equal(traceSnapshot.dropped, 11);
assert.equal(traceSnapshot.entries[0].sequence, 12);
assert.equal(traceSnapshot.entries.at(-1).fields.y, 4009);
assert.ok(traceSnapshot.entries.every((entry, index, entries) => index === 0 || entry.elapsedMs >= entries[index - 1].elapsedMs));
scrollTrace.pause();
const pausedSequence = scrollTrace.snapshot().entries.at(-1).sequence;
scrollTrace.record("ignored", "test");
assert.equal(scrollTrace.snapshot().entries.at(-1).sequence, pausedSequence);
scrollTrace.resume();
assert.equal(scrollTrace.snapshot().entries.at(-1).event, "recording.resume");
const exportedTrace = scrollTrace.export();
assert.equal(exportedTrace.includes("private-session-id"), false);
assert.equal(exportedTrace.includes("private-message-id"), false);
const exportedLines = exportedTrace.split("\n").map((line) => JSON.parse(line));
assert.equal(exportedLines.length, 4001);
assert.equal(exportedLines[0].metadata.platform, "android");
assert.equal(exportedLines[1].sequence, 14);
scrollTrace.reset();
setDebugTraceSink(null);
traceSnapshot = scrollTrace.snapshot();
assert.equal(traceSnapshot.entries.length, 0);
assert.equal(traceSnapshot.recording, false);
assert.equal(traceSnapshot.startedAt, null);
assert.equal(scrollTrace.export().includes("android"), false);
scrollTrace.start({ platform: "ios" });
assert.equal(scrollTrace.alias("session", "different-account"), "session-1");
assert.equal(scrollTrace.snapshot().entries[0].sequence, 1);

const bubbleMeta = { width: 48, height: 16 };
const shortBubble = { width: 40, height: 23, lines: [{ x: 0, y: 0, width: 30, height: 23 }] };
assert.deepEqual(getBubbleMetaLayout(null, bubbleMeta, 280), { minWidth: 0, marginTop: 2, inline: false });
assert.equal(getBubbleMetaLayout(shortBubble, null, 280).inline, false);
const shortLayout = getBubbleMetaLayout(shortBubble, bubbleMeta, 280);
assert.equal(shortLayout.minWidth, 86, "short text may grow to accommodate timestamp and status");
assert.equal(shortLayout.inline, false, "wait for actual expanded width before overlapping the footer row");
assert.deepEqual(getBubbleMetaLayout({ ...shortBubble, width: 86 }, bubbleMeta, 280), { minWidth: 86, marginTop: -14, inline: true });
assert.equal(getBubbleMetaLayout({ ...shortBubble, width: 85.5 }, bubbleMeta, 280).inline, false, "fractional overlap must wrap");
const multiBubble = { width: 260, height: 69, lines: [{ x: 0, y: 0, width: 258, height: 23 }, { x: 0, y: 23, width: 255, height: 23 }, { x: 0, y: 46, width: 60, height: 23 }] };
assert.deepEqual(getBubbleMetaLayout(multiBubble, bubbleMeta, 280), { minWidth: 0, marginTop: -14, inline: true });
assert.equal(getBubbleMetaLayout({ ...multiBubble, lines: [...multiBubble.lines.slice(0, 2), { x: 0, y: 46, width: 250, height: 23 }] }, bubbleMeta, 280).inline, false);
assert.equal(getBubbleMetaLayout({ ...shortBubble, width: 280, lines: [{ x: 230, y: 0, width: 50, height: 23 }] }, bubbleMeta, 280).inline, false, "right-aligned/RTL text cannot be covered by right-aligned metadata");
assert.equal(getBubbleMetaLayout(shortBubble, { width: 290, height: 48 }, 280).minWidth, 280);
assert.equal(getBubbleMetaLayout(shortBubble, { width: 0, height: 0 }, 280).inline, false);
assert.equal(getBubbleMetaLayout({ width: 200, height: 0, lines: [] }, bubbleMeta, 280).inline, false);
// A native text-layout callback must not throw on a missing payload: an uncaught throw there
// is fatal on the new architecture, and an empty measurement keeps the footer in its own row.
assert.deepEqual(bubbleTextLines(undefined), [], "a Text without a lines payload measures as no lines");
assert.deepEqual(bubbleTextLines(null), []);
assert.deepEqual(bubbleTextLines([{ x: 1, y: 2, width: 3, height: 4, ascender: 9 }]), [{ x: 1, y: 2, width: 3, height: 4 }], "only the geometry is kept");
assert.equal(getBubbleMetaLayout({ width: 200, height: 0, lines: bubbleTextLines(null) }, bubbleMeta, 280).inline, false);
// A paginated gallery cannot derive a NaN page from a missing width, and a rubber-band
// offset cannot point past the loaded pages.
assert.equal(imageViewerPageIndex(0, 402, 3), 0);
assert.equal(imageViewerPageIndex(805, 402, 3), 2, "the last page keeps its own offset");
assert.equal(imageViewerPageIndex(5000, 402, 3), 2, "a rubber-band offset stays on the last page");
assert.equal(imageViewerPageIndex(NaN, 402, 3), null, "a missing offset leaves the page alone");
assert.equal(imageViewerPageIndex(402, 0, 3), null, "a page width is required before deriving the page");
assert.equal(imageViewerPageIndex(402, 402, 0), null);
for (const viewport of [240, 320, 360, 390, 768]) {
  assert.ok(getBubbleMaxWidth(viewport) <= viewport - 24);
  for (const scale of [1, 1.3, 2]) {
    for (const lastWidth of [0, 30, 100, 180, 250]) {
      const text = { width: getBubbleMaxWidth(viewport) - 24, height: 46 * scale, lines: [{ x: 0, y: 0, width: 100, height: 23 * scale }, { x: 0, y: 23 * scale, width: lastWidth, height: 23 * scale }] };
      const meta = { width: 48 * scale, height: 16 * scale };
      const result = getBubbleMetaLayout(text, meta, text.width);
      assert.equal(result.minWidth, 0, "multi-line text never changes width for the timestamp");
      if (result.inline) {
        assert.ok(lastWidth + BUBBLE_META_GAP + meta.width <= text.width);
        assert.ok(text.height + result.marginTop >= text.lines[1].y, "tall metadata cannot overlap previous lines");
      } else assert.ok(result.marginTop >= 0);
    }
  }
}

// Execute the real JSX composition to catch a dropped footer between the bubble layers.
const bubbleSource = ts.createSourceFile("MessageContent.tsx", readFileSync(new URL("../src/components/MessageContent.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bubbleFunctionNames = new Set(["enrichedMarkdownStyle", "TextBlock", "Block", "MessageContent"]);
const bubbleFunctions = bubbleSource.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) && bubbleFunctionNames.has(statement.name?.text)
).map((statement) => statement.getText(bubbleSource).replace(/^export /, ""));
assert.equal(bubbleFunctions.length, 4);
const bubbleScope = {
  React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: "Fragment" },
  memo: (component) => component,
  useMemo: (factory) => factory(),
  useState: (factory) => [factory()],
  useContext: () => 240,
  useAppTheme: () => ({ mode: "light", colors: { text: "#1d2024", textMuted: "muted", accentBorder: "border", accent: "accent", border: "border", surfaceRaised: "raised" } }),
  typography: { chatBody: { fontSize: 15, lineHeight: 23 }, caption: { fontSize: 12, lineHeight: 17 }, code: { fontSize: 12, lineHeight: 19 } },
  scaleFontSize: (size) => size,
  colorWithOpacity,
  Platform: { OS: "android" },
  EnrichedMarkdownText: "EnrichedMarkdownText",
  useOpenMessageLink: () => () => {},
  useRevealedStreamText: (text) => text,
  BubbleContext: null,
  BubbleContentWidth: null,
  View: "View", Text: "Text", BubbleText: "BubbleText",
  ImageGallery: "ImageGallery", ToolCall: "ToolCall", SystemNoteRow: "SystemNoteRow",
  imageUri: (block) => block.source?.type === "url" ? block.source.url : null,
};
const bubbleModule = new Function(...Object.keys(bubbleScope), ts.transpileModule(`${bubbleFunctions.join("\n")}\nreturn { MessageContent, enrichedMarkdownStyle };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText)(...Object.values(bubbleScope));
const bubbleRender = bubbleModule.MessageContent;
const markdownTheme = { mode: "dark", colors: { text: "#f7f8fa", textMuted: "muted", textSecondary: "secondary", borderStrong: "border-strong", accentBorder: "accent-border", accent: "accent", border: "border", surfaceRaised: "raised", userBubbleCodeBackground: "user-code" } };
const userInlineCode = bubbleModule.enrichedMarkdownStyle(markdownTheme, "#fff6f0", "user-link", true).code;
assert.equal(userInlineCode.color, "#fff6f0", "inline code on a user bubble keeps the bubble foreground");
assert.equal(userInlineCode.backgroundColor, "user-code", "inline code on a user bubble uses its theme surface");
const assistantInlineCode = bubbleModule.enrichedMarkdownStyle(markdownTheme, "body-text", "link", false).code;
assert.equal(assistantInlineCode.color, "#f7f8fa");
assert.equal(assistantInlineCode.backgroundColor, colorWithOpacity("#f7f8fa", 0.1), "inline code is a faint wash of the text, since the renderer paints it to the full line height");
assert.equal(assistantInlineCode.borderColor, "transparent");
const assistantList = bubbleModule.enrichedMarkdownStyle(markdownTheme, "body-text", "link", false).list;
assert.ok(assistantList.marginLeft < 8 && assistantList.gapWidth <= 8, "list markers hang inside the bubble's padding, not at a document indent");
function footerPlacements(node, footer, found = []) {
  if (Array.isArray(node)) { node.forEach((child) => footerPlacements(child, footer, found)); return found; }
  if (!node || typeof node !== "object") return found;
  if (typeof node.type === "function") return footerPlacements(node.type(node.props), footer, found);
  if (node === footer || node.props?.footer === footer) found.push(node.type);
  footerPlacements(node.props?.children, footer, found);
  return found;
}
const footerMarker = { type: "timestamp", props: {} };
for (const text of ["你好", "First paragraph.\n\nLast paragraph.", "## Heading", "> Quote", "- First\n- Last", "**Bold** and `code`.", "---", "https://example.com/a.mp4", "![image](https://example.com/image)", "```ts\nconst x = 1;\n```", "| A | B |\n| --- | --- |\n| 1 | 2 |"]) {
  for (const active of [false, true]) {
    assert.deepEqual(footerPlacements(bubbleRender({ content: [{ type: "text", text }], active, footer: footerMarker }), footerMarker), ["timestamp"], `native markdown keeps the clock on a sibling row: ${text}`);
  }
}
const streamedFooterSample = "你好，逐字增长。\n\n## Heading\n\n- First\n- Last\n\nDone.";
for (let length = 1; length <= streamedFooterSample.length; length++) {
  const content = [{ type: "thinking", thinking: "Earlier thought." }, { type: "text", text: streamedFooterSample.slice(0, length) }];
  assert.deepEqual(footerPlacements(bubbleRender({ content, active: true, footer: footerMarker }), footerMarker), ["timestamp"], `append ${length} must not remeasure inline metadata`);
}
const bubbleImage = { type: "image", source: { type: "url", url: "fixture://image" } };
assert.deepEqual(footerPlacements(bubbleRender({ content: [bubbleImage], footer: footerMarker }), footerMarker), ["timestamp"]);
assert.deepEqual(footerPlacements(bubbleRender({ content: [bubbleImage, { type: "text", text: "Caption" }], footer: footerMarker }), footerMarker), ["timestamp"]);
assert.deepEqual(footerPlacements(bubbleRender({ content: [{ type: "text", text: "Text" }, { type: "text", text: "  " }], footer: footerMarker }), footerMarker), ["timestamp"]);
assert.deepEqual(footerPlacements(bubbleRender({ content: [{ type: "tool_use", id: "tool", name: "read", input: {} }, { type: "tool_result", tool_use_id: "tool", content: "result" }], footer: footerMarker }), footerMarker), ["timestamp"]);
assert.deepEqual(footerPlacements(bubbleRender({ content: [{ type: "text", text: "No footer" }] }), footerMarker), []);

// A reply has no bubble; its actions, Turn, model, usage, and time share one line under it.
{
  const replyT = (key, values) => key === "message.tokens.cached" ? `${values.count} cached` : key;
  const mc = "../src/components/MessageContent.tsx";
  const formatTokenCount = loadChromeComponent(mc, "formatTokenCount", {});
  assert.deepEqual([245_200, 12_345, 2_100, 1_234_567].map(formatTokenCount), ["245K", "12.3K", "2.1K", "1.2M"], "past three digits the decimal is noise");
  const replyDetailParts = loadChromeComponent(mc, "replyDetailParts", { turnSequenceForMessage, formatTokenCount, DETAIL_SEPARATOR: " · ", requestedThinkingLevel: (meta) => meta?.requestedThinkingLevel ?? null, formatThinkingLevel: (level) => level });
  const estimateTextWidth = loadChromeComponent(mc, "estimateTextWidth", {});
  const fitReplyDetails = loadChromeComponent(mc, "fitReplyDetails", { estimateTextWidth, DETAIL_SEPARATOR: " · " });
  // The reported line: #2 · deepseek-flash with 245.2K in (245.0K cached) and 2.1K out, 246pt left for it on a 375pt phone.
  const reported = { model: "deepseek-flash", usage: { input: 200, cacheRead: 245_000, output: 2_100 }, meta: { turnId: "turn", turnSequence: 2 } };
  const { identity, parts } = replyDetailParts(reported, replyT);
  assert.deepEqual([identity, parts], ["#2 · deepseek-flash", ["↑245K", "↓2.1K", "245K cached"]]);
  assert.equal(fitReplyDetails(identity, parts, 246, 11), "#2 · deepseek-flash · ↑245K · ↓2.1K", "parts that do not fit drop whole, from the least important, never cut mid-word");
  assert.equal(fitReplyDetails(identity, parts, 400, 11), "#2 · deepseek-flash · ↑245K · ↓2.1K · 245K cached");
  assert.equal(fitReplyDetails(identity, parts, 100, 11), identity, "the Turn and model always show");
  assert.ok(estimateTextWidth("#2 · deepseek-flash · ↑245.2K 245.0K cached", 11) >= 245, "the estimate covers the 245pt the reported line measured on device");
  const reply = { model: "claude-sonnet", usage: { input: 1200, cacheRead: 8000, output: 1500 }, meta: { turnId: "turn", turnSequence: 12, requestedThinkingLevel: "high" } };
  const ReplyMeta = loadChromeComponent(mc, "ReplyMeta", {
    ...chromeScope, replyDetailParts, fitReplyDetails, estimateTextWidth, formatTokenCount, turnSequenceForMessage, DETAIL_SEPARATOR: " · ", REPLY_META_HEIGHT: 44, Loader: "Loader",
    requestedThinkingLevel: (meta) => meta?.requestedThinkingLevel ?? null, formatThinkingLevel: (level) => level,
    getReplyContentWidth: (width) => width - 32, typography: { micro: { fontSize: 11 } }, useWindowDimensions: () => ({ fontScale: 1 }),
    useAppTheme: () => ({ colors: { textFaint: "faint" } }), useTranslation: () => ({ t: replyT }), useState: (value) => [value, () => {}], useEffect: () => {},
  });
  const line = ReplyMeta({ message: { ...reply, usage: null }, clock: "14:32", copyText: "answer", availableWidth: 390, onCopy: () => {}, onFork: () => {}, forkDisabled: false, forking: false });
  const buttons = chromeNodes(line).filter((node) => node.type === "Pressable" && classes(node).has("size-8"));
  assert.deepEqual([line.props.style.minHeight, buttons.length], [44, 2], "copy and fork share the reply's one line");
  for (const button of buttons) assert.ok(classes(button).has("size-8") && button.props.hitSlop === 6, "32pt buttons reach 44pt touch targets inside their 44pt line, since hitSlop never extends past a parent");
  const detailsText = chromeNodes(line).find((node) => node.type === "Text" && classes(node).has("flex-1"));
  assert.deepEqual([detailsText.props.numberOfLines, detailsText.props.selectable], [1, undefined], "the details stay on one line; selectable text on Android ignores the line limit and wraps out of the row");
  const narrow = ReplyMeta({ message: reported, clock: "12:09", copyText: "answer", availableWidth: 375, onCopy: () => {}, onFork: () => {}, forkDisabled: false, forking: false });
  const reveal = chromeNodes(narrow).find((node) => node.type === "Pressable" && node.props.accessibilityState?.expanded === false);
  assert.ok(reveal && classes(reveal).has("self-stretch"), "dropped parts are a full-height tap away");
  assert.equal(reveal.props.accessibilityLabel, "#2 · deepseek-flash · ↑245K · ↓2.1K · 245K cached", "screen readers always get every part");
  assert.equal(chromeNodes(reveal).find((node) => node.type === "Text").props.children.join(""), "#2 · deepseek-flash · ↑245K · ↓2.1K");
  const StreamCard = loadChromeComponent("../src/components/MessageContent.tsx", "StreamCard", {
    ...chromeScope, REPLY_INSET_X: 16, REPLY_META_HEIGHT: 44, getReplyContentWidth: (width) => width - 32, formatMessageClock: () => "14:32",
    useWindowDimensions: () => ({ width: 390 }), useTranslation: () => ({ t: replyT }), hasRenderableContent: (content) => content.length > 0,
    BubbleContentWidth: { Provider: "BubbleContentWidthProvider" }, MessageContent: "MessageContent", LiveDot: "LiveDot", TypingIndicator: "TypingIndicator", answerBlocks, thinkingBlocks,
  });
  for (const [content, status] of [[[{ type: "text", text: "partial" }], "streaming"], [[], "pending"], [[], "failed"]]) {
    const card = StreamCard({ content, status });
    assert.equal(chromeNodes(card).find((node) => node.props?.style?.height !== undefined)?.props.style.height, 44, `the ${status} reply's status line matches the finished reply's line, so the swap at the end of a Turn moves nothing`);
  }
  // Only the answer is the reply; the thinking belongs to the Turn's steps, live and finished alike.
  const thought = { type: "thinking", thinking: "Weighing options" };
  const answer = { type: "text", text: "Done." };
  const thinkingOnly = chromeNodes(StreamCard({ content: [thought], status: "streaming" }));
  assert.deepEqual([thinkingOnly.some((node) => node.type === "MessageContent"), thinkingOnly.some((node) => node.type === "Text" && node.props.children.join("") === "message.stream.thinking")], [false, true], "while only thinking streams, the status line says so instead of showing it");
  assert.deepEqual(chromeNodes(StreamCard({ content: [thought, answer], status: "streaming" })).find((node) => node.type === "MessageContent").props.content, [answer]);
  const MessageBubble = loadChromeComponent("../src/components/MessageContent.tsx", "MessageBubble", {
    ...chromeScope, memo: (component) => component, useMemo: (factory) => factory(), useSyncExternalStore: () => false, useTraceTouches: () => ({}),
    chatScrollTrace: { subscribe: () => () => {}, isRecording: () => false }, useAppTheme: () => ({ mode: "dark", colors: { assistantBubbleText: "text" } }), useTranslation: () => ({ t: replyT }),
    useWindowDimensions: () => ({ width: 390 }), compactionFromMessage: () => null, hasRenderableMessage: () => true, hasRenderableContent: (content) => content.some((block) => block.type !== "shell_command"), formatMessageClock: () => "14:32",
    getReplyContentWidth: (width) => width - 32, REPLY_INSET_X: 16, answerBlocks, thinkingBlocks, typography: { chatBody: { fontSize: 17 } },
    contentText: (content) => content.map((block) => block.text ?? block.thinking).join("\n\n"), messageText: (message) => message.text ?? "",
    BubbleContext: { Provider: "BubbleContext" }, BubbleTraceMessage: { Provider: "BubbleTraceMessage" }, BubbleContentWidth: { Provider: "BubbleContentWidth" },
    MessageContent: "MessageContent", TextBlock: "TextBlock", ReplyMeta: "ReplyMeta",
  });
  const finished = chromeNodes(MessageBubble({ message: { id: "reply", role: "assistant", text: null, content: [thought, answer], meta: {} }, onCopy: () => {} }));
  assert.deepEqual([finished.find((node) => node.type === "MessageContent").props.content, finished.find((node) => node.type === "ReplyMeta").props.copyText], [[answer], "Done."], "a finished reply shows and copies only its answer");
  const thoughtOnly = chromeNodes(MessageBubble({ message: { id: "reply", role: "assistant", text: "Weighing options", content: [thought], meta: {} }, onCopy: () => {} }));
  assert.deepEqual([thoughtOnly.some((node) => node.type === "TextBlock" || node.type === "MessageContent"), thoughtOnly.find((node) => node.type === "ReplyMeta").props.copyText], [false, ""], "a history row's text derived from the thinking does not bring it back");
  assert.equal(chromeNodes(MessageBubble({ message: { id: "reply", role: "assistant", text: "$ ls", content: [{ type: "shell_command", command: "ls" }], meta: {} } })).find((node) => node.type === "TextBlock")?.props.value, "$ ls", "a reply that did not think keeps its text fallback");
  const TurnProcess = loadChromeComponent("../src/components/TurnProcess.tsx", "TurnProcess", {
    ...chromeScope, useTranslation: () => ({ t: replyT }), useState: (value) => [value, () => {}], useEffect: () => {}, useMemo: (factory) => factory(),
    thinkingBlocks, ProcessDisclosure: "ProcessDisclosure", MessageContent: "MessageContent", Loader: "Loader",
  });
  const thoughtTurn = { id: "turn", sessionId: "session", intermediateIndex: null, intermediateSummary: null, durationMs: 12_000, assistantContent: [thought, answer] };
  const capsule = TurnProcess({ turn: thoughtTurn, client: null, spaceId: "space" });
  assert.deepEqual([capsule?.type, capsule?.props.label, chromeNodes(capsule).find((node) => node.type === "MessageContent").props.content], ["ProcessDisclosure", "turn.thinking · 12s", [thought]], "a Turn that only thought still folds its thinking into a capsule");
  assert.equal(TurnProcess({ turn: { ...thoughtTurn, assistantContent: [answer] }, client: null, spaceId: "space" }), null, "no steps and no thinking, no capsule");
}

// Configuration guard, not a native gesture test: the timeline is chronological (no inversion).
const focusPolicySource = ts.createSourceFile("chat.tsx", readFileSync(new URL("../app/chat/[sessionId].tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let timelineElement;
function findTimelineElement(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(focusPolicySource) === "LegendList" && node.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(focusPolicySource) === "data" && ts.isJsxExpression(prop.initializer) && prop.initializer.expression?.getText(focusPolicySource) === "messages")) timelineElement = node;
  ts.forEachChild(node, findTimelineElement);
}
findTimelineElement(focusPolicySource);
assert.ok(timelineElement, "the chat timeline renders messages chronologically through LegendList");
const timelineProp = (name) => timelineElement.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(focusPolicySource) === name);
assert.ok(focusPolicySource.text.includes("timelineReady"), "the timeline waits for a tail before mounting so initialScrollAtEnd still applies");
assert.ok(focusPolicySource.text.includes("reserveComposer: true"), "the first paint reserves composer height so the tail does not jump");
assert.ok(timelineProp("alignItemsAtEnd"), "short timelines stick to the bottom");
assert.equal(timelineProp("inverted"), undefined, "the timeline must not be inverted");
assert.equal(timelineProp("experimental_hideItemsUntilMeasured"), undefined, "hiding rows until measured makes the timeline jitter on open");
const initialScrollAtEndProp = timelineProp("initialScrollAtEnd");
assert.ok(initialScrollAtEndProp && ts.isJsxExpression(initialScrollAtEndProp.initializer), "the timeline must start at the tail");
assert.equal(initialScrollAtEndProp.initializer.expression?.getText(focusPolicySource), "!hasInitialTurnTarget || listGeneration !== mountGeneration", "deep links own the first scroll; a fresh newest window lands at the tail");
const listKeyProp = timelineProp("key");
assert.equal(listKeyProp?.initializer.expression?.getText(focusPolicySource), "listGeneration", "the newest page replacing the loaded turns mounts a fresh list that places itself like an open");
const itemTypeProp = timelineProp("getItemType");
assert.ok(itemTypeProp && ts.isJsxExpression(itemTypeProp.initializer), "user and assistant rows need separate size averages");
assert.equal(itemTypeProp.initializer.expression?.getText(focusPolicySource), "getMessageItemType");
const onLoadProp = timelineProp("onLoad");
assert.ok(onLoadProp && ts.isJsxExpression(onLoadProp.initializer), "the live card attaches after the history rows are measured");
assert.equal(onLoadProp.initializer.expression?.getText(focusPolicySource), "handleListLoad");
const maintainThresholdProp = timelineProp("maintainScrollAtEndThreshold");
assert.ok(maintainThresholdProp && ts.isJsxExpression(maintainThresholdProp.initializer), "following must keep pinning through a burst larger than Legend's 10% default");
assert.equal(maintainThresholdProp.initializer.expression?.getText(focusPolicySource), "CHAT_FOLLOW_TAIL_MAINTAIN_THRESHOLD");
const focusScrollProp = timelineProp("scrollsChildToFocus");
assert.ok(focusScrollProp && ts.isJsxExpression(focusScrollProp.initializer), "timeline must explicitly disable native focus scrolling");
assert.equal(focusScrollProp.initializer.expression.kind, ts.SyntaxKind.FalseKeyword);

const scrollDebugSource = ts.createSourceFile("chat-scroll.tsx", readFileSync(new URL("../app/debug/chat-scroll.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let scrollFixtureFunction;
function findScrollFixture(node) {
  if (ts.isFunctionExpression(node) && node.name?.text === "ScrollFixture") scrollFixtureFunction = node.getText(scrollDebugSource);
  ts.forEachChild(node, findScrollFixture);
}
findScrollFixture(scrollDebugSource);
assert.ok(scrollFixtureFunction);
let fixtureState;
const scrollFixtureScope = {
  React: bubbleScope.React,
  useRef: (current) => ({ current }),
  useCallback: (callback) => callback,
  useChatScrollTrace: (_source, getState) => { fixtureState = getState; return { recording: false, log: () => {} }; },
  useTraceTouches: () => ({}),
  FlatList: "FlatList", MessageBubble: "MessageBubble",
};
const renderScrollFixture = new Function(...Object.keys(scrollFixtureScope), ts.transpileModule(`return (${scrollFixtureFunction});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText)(...Object.values(scrollFixtureScope));
for (const enabled of [true, false]) {
  const element = renderScrollFixture({ inverted: true, scrollsChildToFocus: enabled, message: { id: "fixture", sequence: 1 } });
  assert.equal(element.props.scrollsChildToFocus, enabled, "focus toggle reaches the native list prop");
  assert.equal(fixtureState().scrollsChildToFocus, enabled, "fixture trace snapshots record the native focus-scroll setting");
  assert.equal(element.props.inverted, true);
  assert.equal(element.props.scrollEventThrottle, 100);
}

const forkCalls = [];
const forkClient = {
  space: (spaceId) => ({
    session: (sessionId) => ({
      turn: (turnId) => ({
        fork: async () => {
          forkCalls.push({ spaceId, sessionId, turnId });
          return { session: { id: "forked-session" }, fork: {} };
        },
      }),
    }),
  }),
};
const forkedSession = await forkSessionTurn(forkClient, "space-1", "session-1", { id: "child-turn", sourceTurnId: "source-turn" });
assert.equal(forkedSession.session.id, "forked-session");
assert.deepEqual(forkCalls, [{ spaceId: "space-1", sessionId: "session-1", turnId: "source-turn" }]);
await assert.rejects(() => forkSessionTurn(forkClient, "", "session-1", { id: "turn-1", sourceTurnId: null }), /Cannot fork/);

const inherited = (sequence, source = "parent") => ({ id: `t${sequence}`, sequence, sourceSessionId: source, sourceTurnId: `src${sequence}` });
const own = (sequence) => ({ id: `t${sequence}`, sequence, sourceSessionId: "child" });
assert.deepEqual(forkPoint([inherited(1), inherited(2), own(3)], "child", true), { sequence: 2, sessionId: "parent", turnId: "src2" }, "the fork point sits after the inherited prefix");
assert.deepEqual(forkPoint([inherited(1), inherited(2)], "child", false), { sequence: 2, sessionId: "parent", turnId: "src2" }, "a fresh fork ends at its anchor");
assert.equal(forkPoint([inherited(1), inherited(2)], "child", true), null, "an unloaded newer page may still be inherited");

const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
const chat = (id, minutes) => ({ id, lastMessageAt: at(minutes), updatedAt: at(minutes) });
const edge = (childSessionId, parentSessionId, extra = {}) => ({ childSessionId, parentSessionId, ...extra });
const forks = mergeSessionForks({}, [edge("fork-a", "parent"), edge("fork-b", "parent"), edge("nested", "fork-a"), edge("orphan", "unlisted"), edge("hidden", null)]);
const tree = buildSessionForkTree([chat("recent", 50), chat("nested", 40), chat("parent", 30), chat("fork-b", 20), chat("orphan", 10), chat("fork-a", 5), chat("hidden", 1)], forks);
assert.deepEqual(tree.map((row) => [row.session.id, row.tree.depth]), [["recent", 0], ["parent", 0], ["fork-a", 1], ["nested", 2], ["fork-b", 1], ["orphan", 0], ["hidden", 0]], "forks nest under their listed parent, ordered by latest activity in each branch");
assert.deepEqual(tree.slice(2, 5).map((row) => [row.tree.rails, row.tree.last, row.tree.hasChildren]), [[[], false, true], [[true], true, false], [[], true, false]], "a nested fork keeps its ancestor's rail while a later sibling follows");
const deepForks = mergeSessionForks({}, ["d1", "d2", "d3", "d4"].map((id, index) => edge(id, index ? `d${index}` : "root")));
assert.deepEqual(buildSessionForkTree([chat("root", 9), chat("d1", 8), chat("d2", 7), chat("d3", 6), chat("d4", 5)], deepForks, { expanded: new Set(["root"]) }).map((row) => row.tree?.depth), [0, 1, 2, 3, 3, undefined], "forks past three levels flatten into the third on a phone");
const wideForks = mergeSessionForks({}, ["w1", "w2", "w3", "w4", "w5"].map((id) => edge(id, "root")));
const wideChats = [chat("root", 1), chat("w1", 50), chat("w2", 40), chat("w3", 30), chat("w4", 20), chat("w5", 10)];
const collapsed = buildSessionForkTree(wideChats, wideForks, { keep: (session) => session.id === "w5" });
assert.deepEqual(collapsed.map((entry) => entry.type === "toggle" ? `toggle:${entry.hidden}` : entry.session.id), ["root", "w1", "w2", "w5", "toggle:2"], "a busy fork group shows its latest and running forks, then a toggle");
assert.equal(collapsed[3].tree.lastInGroup, false, "the toggle closes the group's card");
assert.deepEqual(buildSessionForkTree(wideChats, wideForks, { expanded: new Set(["root"]) }).map((entry) => entry.type === "toggle" ? `toggle:${entry.expanded}` : entry.session.id), ["root", "w1", "w2", "w3", "w4", "w5", "toggle:true"], "an expanded group lists every fork and can fold back");
assert.equal(buildSessionForkTree(wideChats.slice(0, 4), wideForks).some((entry) => entry.type === "toggle"), false, "hiding a single fork is not worth a toggle");
const liveFork = { childSessionId: "fresh", parentSessionId: "fork-a", depth: 2, anchorSequence: 4 };
assert.deepEqual(spaceRealtimeChange({ type: "session.created", spaceId: "space", sessionId: "fresh", payload: { session: { id: "fresh", spaceId: "space" }, fork: liveFork } }).fork, { spaceId: "space", ...liveFork }, "realtime creation events carry the fork lineage");
assert.equal(spaceRealtimeChange({ type: "session.created", spaceId: "space", sessionId: "fresh", payload: { session: { id: "fresh", spaceId: "space" }, fork: { ...liveFork, childSessionId: "other" } } }).fork, undefined, "a lineage for another Chat is ignored");
const seeded = realtimeSessionFork(forks, "space", liveFork, "Fork A");
assert.equal(seeded.parentSessionId, "fork-a");
assert.equal(seeded.parentTitle, "Fork A");
assert.equal(realtimeSessionFork(forks, "space", { ...liveFork, childSessionId: "fork-b" }, null), null, "a known edge is never replaced by a partial realtime one");

// Schedules: cron reading, DST-safe next runs in the schedule's own zone, and summaries.
assert.equal(parseCron("0 9 * * *") !== null, true);
assert.equal(parseCron("0 9 * *"), null, "four fields are not a schedule");
assert.equal(parseCron("61 * * * *"), null, "out-of-range minutes are rejected");
const fromUtc = Date.UTC(2026, 9, 24, 0, 30);
assert.deepEqual(nextCronRuns("0 9 * * *", "Asia/Shanghai", 2, fromUtc).map((date) => date.toISOString()), ["2026-10-24T01:00:00.000Z", "2026-10-25T01:00:00.000Z"]);
assert.deepEqual(nextCronRuns("30 1 * * 0", "UTC", 1, fromUtc).map((date) => date.toISOString()), ["2026-10-25T01:30:00.000Z"], "Sunday is weekday 0");
assert.deepEqual(nextCronRuns("0 0 31 2 *", "UTC", 1, fromUtc), [], "an impossible date ends the search instead of looping");
assert.deepEqual(summarizeCron("0 9 * * 1-5"), { kind: "preset", id: "weekdays", time: "09:00" });
assert.deepEqual(summarizeCron("*/15 * * * *"), { kind: "minutes", every: 15 });
assert.deepEqual(summarizeCron("0 9 1 * *"), { kind: "custom" });

// Space wallet and startup report readers.
assert.equal(formatWalletUsd(1.23456, "en", 4), "$1.2346");
assert.equal(walletProductBalanceUsd({ display: { creditBenefits: [], creditsAmount: 500_000_000 }, pricing: { amountUsd: 9 } }), 5, "credits convert at 1e-8 USD");
assert.deepEqual(appendWalletActivity([{ id: "a" }], { items: [{ id: "a" }, { id: "b" }], hasMore: false }).map((item) => item.id), ["a", "b"]);
assert.equal(sandboxSetupStatus(null), "unavailable");
assert.equal(sandboxSetupStatus({ ran: true, exitCode: 2 }), "failed", "reports without a status fall back to the exit code");
assert.equal(sandboxSetupInfo({ setup: { ran: "yes" } }), null, "a malformed report reads as none");
assert.equal(sandboxSetupLogPaths(".cohub/logs/setup/1/").stderr, ".cohub/logs/setup/1/stderr.log");
assert.ok(SETUP_STATUS.running.label);

// App host relay: only the App's own origin speaks, and untrusted targets never reach the router.
const appOrigin = "https://works.cohub.run";
const relayed = (message) => JSON.stringify({ cohubHost: 1, message });
assert.deepEqual(readAppHostMessage(relayed({ type: "cohub.app.context", requestId: "r1" }), `${appOrigin}/w/demo`, appOrigin), { type: "cohub.app.context", requestId: "r1" });
assert.equal(readAppHostMessage(relayed({ type: "cohub.app.token", requestId: "r2" }), "https://evil.example/w", appOrigin), null, "another origin cannot ask for tokens");
assert.equal(readAppHostMessage(JSON.stringify({ type: "cohub.app.token" }), `${appOrigin}/`, appOrigin), null, "only the relay envelope is accepted");
assert.ok(appHostScript(appOrigin).includes(JSON.stringify(appOrigin)), "the relay installs only on the App's origin");
assert.equal(appRuntimeSignal({ protocol: "cohub.app.runtime", version: 1, type: "ready" }), "ready");
assert.deepEqual(appDevicesRequest({ type: "cohub.app.devices.request", requestId: "d", devices: "microphone, camera, keyboard" }), { requestId: "d", devices: ["camera", "microphone"] });
const space = "00000000-0000-4000-8000-000000000001";
const nav = (target, extra = {}) => appNavigationRequest({ protocol: "cohub.app.navigation", version: 1, type: "open", requestId: "n", target, ...extra })?.route ?? null;
assert.deepEqual(nav({ kind: "file", spaceId: space, path: "docs/a.md" }), { pathname: "/space/[spaceId]/file", params: { spaceId: space, path: "docs/a.md" } });
assert.equal(nav({ kind: "file", spaceId: space, path: "../secrets" }), null, "paths cannot climb out of the workspace");
assert.equal(nav({ kind: "session", spaceId: "not-a-uuid", sessionId: space }), null);
assert.equal(nav({ kind: "app", ref: space }, { call: { method: "x" } }), null, "method calls on other Apps are unsupported");

// Work management helpers.
assert.equal(withCohubBar({ presentation: { hideCohubBar: true } }, false), null, "clearing the only presentation flag drops the empty meta");
assert.deepEqual(withCohubBar({ title: "A" }, true), { title: "A", presentation: { hideCohubBar: true } });
assert.equal(promotionUrl("https://cohub.live/u/s/w/app?x=1", { id: "p1", parameters: { utm_source: "ig" } }), "https://cohub.live/u/s/w/app?x=1&cohub_campaign=p1&utm_source=ig");
const views = dailyViews({ daily: [{ date: "2026-10-24", views: 3 }] }, 3, Date.UTC(2026, 9, 24, 12));
assert.deepEqual(views.map((day) => day.views), [0, 0, 3]);

// Media previews.
assert.equal(modelFormat("models/robot.GLB"), "glb");
assert.equal(modelFormat("download?id=1", "model/stl"), "stl");
assert.equal(modelFormat("scene.usdz"), null);
assert.equal(imageThumbnailUrl("data:image/png;base64,AAAA", 100, 3), "data:image/png;base64,AAAA", "inline images are never rewritten");
assert.equal(mergeSessionForks(forks, [edge("fork-a", "parent")]), forks, "an unchanged read keeps the edge map identity");

const relatedId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [callerSpace, callerChat, callerTurn, reviewChat, otherSpace, docsChat] = [1, 2, 3, 4, 5, 6].map(relatedId);
assert.deepEqual(sentFrom({ sessionId: reviewChat, meta: { origin: { kind: "prompt", spaceId: callerSpace, sessionId: callerChat, turnId: callerTurn } } }), { spaceId: callerSpace, sessionId: callerChat, turnId: callerTurn }, "prompted Turns link back to the caller Turn");
assert.equal(sentFrom({ sessionId: callerChat, meta: { origin: { kind: "prompt", spaceId: callerSpace, sessionId: callerChat, turnId: callerTurn } } }), null, "self follow-ups are already in the timeline");
assert.deepEqual(sentSessions({ sessionId: callerChat, meta: { messagesSent: [
  { sessionId: reviewChat, turnId: relatedId(11), kind: "prompt" },
  { spaceId: otherSpace, sessionId: docsChat, turnId: relatedId(12), kind: "prompt" },
  { sessionId: reviewChat, turnId: relatedId(13), kind: "prompt" },
  { sessionId: callerChat, turnId: relatedId(14), kind: "prompt" },
] } }, callerSpace), [
  { spaceId: callerSpace, sessionId: reviewChat, turnId: relatedId(13), count: 2 },
  { spaceId: otherSpace, sessionId: docsChat, turnId: relatedId(12), count: 1 },
], "fan-out folds repeat prompts onto the latest child Turn and skips self follow-ups");

const relatedGets = [];
const relatedStore = createRelatedSessionStore({ space: (spaceId) => ({ session: (sessionId) => ({ get: async () => {
  relatedGets.push(sessionId);
  if (sessionId === "denied") throw Object.assign(new Error("Forbidden"), { status: 403 });
  if (sessionId === "offline") throw new Error("Network request failed");
  return { space: { id: spaceId }, session: { id: sessionId, title: "Review" } };
} }) }) });
for (const sessionId of ["ok", "ok", "denied", "offline"]) relatedStore.request({ spaceId: callerSpace, sessionId });
await flushSync();
assert.deepEqual(relatedGets, ["ok", "denied", "offline"], "related Chat lookups dedupe in-flight requests");
assert.equal(relatedStore.get({ sessionId: "ok" }).session.title, "Review");
assert.equal(relatedStore.get({ sessionId: "denied" }).status, "unavailable", "403 renders as an unavailable Chat, not a link");
assert.equal(relatedStore.get({ sessionId: "offline" }).status, "unknown");
relatedStore.request({ spaceId: callerSpace, sessionId: "offline" });
relatedStore.request({ spaceId: callerSpace, sessionId: "denied" });
await flushSync();
assert.deepEqual(relatedGets.slice(3), ["offline"], "transient failures retry; access denials stay settled");

const measurements = new MessageMeasurements();
const measuredRows = [{ id: "a", revision: "1" }, { id: "b", revision: "1" }];
measurements.configure("360:1:light", measuredRows);
measurements.measure(measuredRows[0], 200);
assert.equal(measurements.estimateOffset(measuredRows, 2, 80), 280);
const revisedRows = [{ id: "a", revision: "2" }, measuredRows[1]];
assert.equal(measurements.estimateOffset(revisedRows, 2, 80), 160);
measurements.configure("720:1:light", measuredRows);
assert.equal(measurements.estimateOffset(measuredRows, 2, 80), 160);
measurements.measure(measuredRows[0], 200);
measurements.configure("720:1:light", []);
assert.equal(measurements.estimateOffset(measuredRows, 1, 80), 80);
assert.throws(() => measurements.measure(measuredRows[0], NaN), /positive and finite/);
// A stale row closure must not reach measure(): an uncaught throw inside a native event
// handler is fatal on the new architecture and freezes the screen until restart.
assert.equal(rowHeightMeasurement(measuredRows, 5, measuredRows[0].id, 200), null, "an out-of-range closure index is skipped, not thrown");
assert.equal(rowHeightMeasurement(measuredRows, 0, "recycled", 200), null, "a recycled row whose id no longer matches the entry is skipped");
assert.equal(rowHeightMeasurement(measuredRows, 0, measuredRows[0].id, 0), null, "recycled zero-height layouts are skipped");
assert.equal(rowHeightMeasurement(measuredRows, 0, measuredRows[0].id, Number.NaN), null, "unsized NaN layouts are skipped");
assert.equal(rowHeightMeasurement(measuredRows, -1, measuredRows[0].id, 200), null);
assert.deepEqual(rowHeightMeasurement(measuredRows, 1, measuredRows[1].id, 120), { message: measuredRows[1], height: 120 }, "valid measurements still record");

mock.timers.enable({ apis: ["setTimeout"] });
try {
  const published = [];
  const batch = createStreamBatch((value) => published.push(value));
  batch.push("first");
  batch.push("latest");
  mock.timers.tick(31);
  assert.deepEqual(published, []);
  mock.timers.tick(1);
  assert.deepEqual(published, ["latest"]);
  batch.push("before lifecycle");
  batch.flush();
  assert.deepEqual(published, ["latest", "before lifecycle"]);
  batch.push("stale after completion");
  batch.cancel();
  mock.timers.tick(100);
  assert.deepEqual(published, ["latest", "before lifecycle"]);
} finally {
  mock.timers.reset();
}

mock.timers.enable({ apis: ["setTimeout", "Date"] });
const revealed = new StreamRevealController();
const revealedValues = [];
revealed.subscribe(() => revealedValues.push(revealed.getDisplayed()));
try {
  // First content is authoritative and shows whole instead of animating from empty.
  revealed.setTarget("你好");
  assert.deepEqual(revealedValues, ["你好"]);
  // A ZWJ emoji arrives as one grapheme; a multi-grapheme append paces in commits.
  revealed.setTarget("你好👩🏽‍💻");
  mock.timers.tick(50);
  assert.equal(revealed.getDisplayed(), "你好👩🏽‍💻");
  revealed.setTarget("你好👩🏽‍💻abcdefghij");
  const beforePacing = revealedValues.length;
  mock.timers.tick(50);
  assert.ok(revealedValues.length > beforePacing, "appends commit over multiple frames");
  mock.timers.tick(50);
  assert.ok(revealedValues.length > beforePacing + 1, "a long append takes more than one commit");
  for (const value of revealedValues) assert.ok(revealed.getDisplayed().startsWith(value), `revealed value is a prefix: ${value}`);
  mock.timers.tick(600);
  assert.equal(revealed.getDisplayed(), "你好👩🏽‍💻abcdefghij");
  // Never split a grapheme across commits.
  for (const value of revealedValues) assert.ok(!value.endsWith("\u200d") && !/[\u{1F3FB}-\u{1F3FF}]$/u.test(value), `commit splits a grapheme: ${value}`);
  // An append that extends the trailing grapheme completes that unit first.
  revealed.setTarget("a");
  revealed.setTarget("a\u{1F3FD}");
  mock.timers.tick(600);
  assert.equal(revealed.getDisplayed(), "a\u{1F3FD}");
  // A correction is authoritative; it must not replay the obsolete suffix.
  revealed.setTarget("corrected");
  assert.equal(revealed.getDisplayed(), "corrected");
  // Completion drains immediately.
  revealed.setTarget("corrected answer");
  revealed.flush();
  assert.equal(revealed.getDisplayed(), "corrected answer");
  mock.timers.tick(500);
  assert.equal(revealedValues.at(-1), "corrected answer");
} finally {
  revealed.stop();
  mock.timers.reset();
}
for (const streaming of [true, false]) {
  const updates = [];
  const layoutEffects = [];
  const revealText = loadChromeComponent("../src/components/useRevealedStreamText.ts", "useRevealedStreamText", {
    StreamRevealController,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, (value) => updates.push(value)],
    useLayoutEffect: (effect) => layoutEffects.push(effect),
  });
  const firstFrame = revealText("你好", streaming);
  for (const effect of layoutEffects) effect();
  assert.deepEqual([firstFrame, updates], ["你好", []], `mounting ${streaming ? "streaming" : "finished"} text shows whole and schedules no update; a re-render per mounted block kept list fills synchronous until React's nested-update limit ended the runtime`);
}

const finalReply = { id: "final", role: "assistant", sequence: 2, meta: { turnId: "turn-1" }, text: "Final reply" };
const intermediateReply = { id: "step", role: "assistant", sequence: 1, meta: { turnId: "turn-1", messageKind: "assistant_intermediate" }, text: "Working" };
assert.deepEqual(mergeDisplayMessages([finalReply], [intermediateReply]), [finalReply]);
assert.deepEqual(mergeDisplayMessages([], [intermediateReply, finalReply]), [finalReply]);
const optimisticUser = { id: "local-1", role: "user", sequence: 1, meta: { optimistic: true, clientMessageId: "c1", turnSequence: 1 }, text: "hi" };
const confirmedUser = { id: "t1:user", role: "user", sequence: 1, meta: { turnId: "t1", turnSequence: 1, clientMessageId: "c1" }, text: "hi" };
assert.deepEqual(mergeDisplayMessages([confirmedUser], [optimisticUser]).map((message) => message.id), ["t1:user"]);
assert.equal(nextTurnSequence([{ sequence: 4 }], [{ meta: { turnSequence: 4 } }]), 5);
assert.equal(withTurnSequences([{ id: "u", role: "user", sequence: 19, meta: { turnId: "t10" }, text: "hi" }], [{ id: "t10", sequence: 10 }])[0]?.meta?.turnSequence, 10);
assert.equal(mergeDisplayMessages(
  [{ id: "t10:user", role: "user", sequence: 19, meta: { turnId: "t10", turnSequence: 10 }, text: "hi" }],
  [{ id: "live-user", role: "user", sequence: 19, meta: { turnId: "t10", clientMessageId: "c1" }, text: "hi" }],
)[0]?.meta?.turnSequence, 10);
// Persisted message sequences and turn-projected sequences are independent counters.
const orderingTurn = { id: "ordering-turn", sessionId: "s1", sequence: 10, status: "running", userText: "Question", userContent: [], assistantContent: [], meta: { optimistic: true } };
assert.equal(messagesFromTurns([orderingTurn])[0]?.meta?.optimistic, undefined, "confirmed turn projection never keeps the sending state");
assert.deepEqual(
  messagesFromTurns([{ ...orderingTurn, status: "completed", assistantText: "Answer", createdAt: "2026-10-21T12:59:28Z", updatedAt: "2026-10-21T13:02:41Z", completedAt: "2026-10-21T13:02:40Z" }]).map((message) => message.createdAt),
  ["2026-10-21T12:59:28Z", "2026-10-21T13:02:40Z"],
  "assistant reply clock shows turn completion, not send time",
);
for (const sequence of [2, 12, 80]) {
  const persistedFinal = { id: "persisted-final", sessionId: "s1", role: "assistant", sequence, text: "Answer", content: [], meta: { turnId: orderingTurn.id, messageKind: "assistant_final" } };
  for (const finalized of [false, true]) {
    const turns = [{ ...orderingTurn, ...(finalized ? { status: "completed", assistantText: "Answer" } : {}) }];
    for (const meta of [persistedFinal.meta, { ...persistedFinal.meta, turnSequence: 10 }]) {
      const display = withTurnSequences(mergeDisplayMessages(messagesFromTurns(turns), [{ ...persistedFinal, meta }]), turns);
      assert.deepEqual(display.map((message) => message.role), ["user", "assistant"], "a committed final reply stays after its question before and after turn finalization");
      assert.deepEqual(display.map((message) => message.sequence), [19, 20]);
      assert.equal(display.filter((message) => message.role === "assistant").length, 1);
      assert.equal(shouldShowLiveStream({ status: "streaming", turnId: orderingTurn.id }, display), false);
    }
  }
  assert.equal(persistedFinal.sequence, sequence, "display projection does not mutate the SDK record");
}
const turnWithoutImage = { id: "t1", sessionId: "s1", sequence: 1, userContent: [{ type: "text", text: "photo" }], userText: "photo" };
const imageContent = [{ type: "image", source: { type: "url", url: "file://shot.jpg" } }];
assert.equal(withFallbackUserContent(turnWithoutImage, imageContent, "photo").userContent, imageContent);
assert.equal(withFallbackUserContent({ ...turnWithoutImage, userContent: imageContent }, [{ type: "text", text: "photo" }], "photo").userContent, imageContent);
assert.equal(chatThreadPlaceholder({ messageCount: 0, historyLoaded: false }), "opening");
assert.equal(chatThreadPlaceholder({ messageCount: 0, historyLoaded: false, error: "Unable to open Chat" }), null);
assert.equal(chatThreadPlaceholder({ messageCount: 0, historyLoaded: true }), "empty");
assert.equal(chatThreadPlaceholder({ messageCount: 2, historyLoaded: false }), null);

// Compaction ("context") turns project to a message whose text is the summary,
// not an empty assistant reply; the notice reads its stats from the turn meta.
const compactTurn = {
  id: "compact-turn",
  sessionId: "s1",
  sequence: 3,
  status: "completed",
  intent: "compact",
  userContent: [],
  userText: null,
  assistantContent: [{ type: "system_note", note_type: "compacted", text: "Earlier context summary" }],
  assistantText: null,
  provider: "deepseek",
  model: "deepseek-flash",
  stopReason: null,
  errorMessage: null,
  finalUsage: { input: 372_700, output: 1_200, cacheRead: 372_000 },
  totalUsage: null,
  meta: { compaction: { summarizedMessageCount: 12, tokensBefore: 372_700, estimatedTokensAfter: 44_000 } },
  userUuid: null,
  authorProfile: null,
  startedAt: null,
  completedAt: null,
  durationMs: 8_200,
  createdAt: "2026-09-10T09:12:00.000Z",
};
const compactMessages = messagesFromTurns([compactTurn]);
assert.equal(compactMessages.length, 1, "Compaction turns must project to exactly one message");
assert.equal(compactMessages[0]?.text, "Earlier context summary");
const compactInfo = compactionFromMessage(compactMessages[0]);
assert.equal(compactInfo?.summary, "Earlier context summary");
assert.equal(compactInfo?.meta.summarizedMessageCount, 12);
assert.deepEqual(compactionStats(compactInfo?.meta ?? {}), { summarizedMessageCount: 12, tokensBefore: 372_700, tokensAfter: 44_000 });
assert.equal(compactionFromMessage({ content: [{ type: "text", text: "hello" }], meta: {} }), null, "Regular messages are not compaction");
assert.equal(compactionFromMessage({ content: [], meta: { messageKind: "compacted" } })?.summary, "", "Compacted system messages still render a notice");
assert.equal(chatThreadPlaceholder({ messageCount: 0, historyLoaded: false, hasLiveActivity: true }), null);
assert.equal(liveStreamStatusFromPatch("idle"), null);
assert.equal(liveStreamStatusFromPatch("completed"), null);
assert.equal(liveStreamStatusFromPatch("pending"), "pending");
assert.equal(liveStreamStatusFromPatch("streaming"), "streaming");
assert.equal(hasFinalAssistantForTurn([finalReply], "turn-1"), true);
assert.equal(hasFinalAssistantForTurn([intermediateReply], "turn-1"), false);
const liveStream = { status: "streaming", contentBlocks: [{ type: "thinking", thinking: "working" }], intermediateMessages: [], turnId: "turn-1", messageId: null, runtimePhase: null, runtimeProvider: null, runtimeModel: null };
assert.equal(shouldShowLiveStream(liveStream, [finalReply]), false);
assert.equal(shouldShowLiveStream(liveStream, []), true);
assert.equal(shouldShowLiveStream({ ...liveStream, status: "pending" }, [finalReply]), false);

// Stream overlay vs. authoritative tail after a reconnect/foreground gap.
const runningTail = [{ id: "turn-2", sequence: 2, status: "running" }];
const finishedTail = [{ id: "turn-2", sequence: 2, status: "completed" }];
const twoTurns = [{ id: "turn-1", sequence: 1, status: "completed" }, { id: "turn-2", sequence: 2, status: "completed" }];
assert.equal(streamRecoveryFromTail({ stream: { turnId: "turn-2" }, tail: finishedTail[0], turns: finishedTail, messages: [] }), "clear");
assert.equal(streamRecoveryFromTail({ stream: { turnId: "turn-1" }, tail: twoTurns[1], turns: twoTurns, messages: [] }), "clear");
assert.equal(streamRecoveryFromTail({ stream: { turnId: null }, tail: finishedTail[0], turns: finishedTail, messages: [] }), "clear");
assert.equal(streamRecoveryFromTail({ stream: { turnId: "turn-2" }, tail: runningTail[0], turns: runningTail, messages: [] }), null);
assert.equal(streamRecoveryFromTail({ stream: null, tail: runningTail[0], turns: runningTail, messages: [] }), "pending");
assert.equal(streamRecoveryFromTail({ stream: null, tail: runningTail[0], turns: runningTail, messages: [{ ...finalReply, meta: { turnId: "turn-2" } }] }), null);
assert.equal(streamRecoveryFromTail({ stream: null, tail: null, turns: [], messages: [] }), null);
// An overlay already tracking a turn newer than the fetched tail must survive.
assert.equal(streamRecoveryFromTail({ stream: { turnId: "turn-3" }, tail: twoTurns[1], turns: twoTurns, messages: [] }), null);

const runningTurn = { id: "t9", sequence: 9, status: "running", updatedAt: "2026-09-01T00:00:00.000Z" };
const completedTurn = { ...runningTurn, status: "completed", updatedAt: "2026-09-01T00:01:00.000Z" };
assert.equal(latestTurn([{ sequence: 3, status: "completed" }, runningTurn, { sequence: 4, status: "failed" }]), runningTurn);
assert.equal(latestTurn([runningTurn, { ...completedTurn, sequence: 10 }])?.status, "completed");
assert.equal(latestTurn([]), null);
assert.equal(getSessionStatus(runningTurn.status), "running");
assert.equal(getSessionStatus("queued"), "running");
assert.equal(getSessionStatus("abort_requested"), "running");
assert.equal(sessionListStatus({ activeTurn: { id: "older-active" } }, completedTurn, {}), "running", "an older active execution can outlive the latest completed turn");
assert.equal(sessionListStatus({ activeTurn: { id: "older-active" } }, completedTurn, { "older-active": { ...completedTurn, id: "older-active" } }), "completed", "a stale activeTurn snapshot cannot resurrect a known terminal turn");
assert.equal(sessionListStatus({ activeTurn: null }, undefined, {}), "idle", "no active turn does not imply completion");
for (const status of ["in_progress", "pending", "needs_input", "waiting", "completed", "failed", "interrupted", "merged", "cancelled", null, undefined]) {
  assert.notEqual(getSessionStatus(status), "running");
}
assert.equal(reconcileLatestTurn(completedTurn, runningTurn), completedTurn);
assert.equal(reconcileLatestTurn(completedTurn, { ...runningTurn, updatedAt: completedTurn.updatedAt }), completedTurn);
assert.equal(reconcileLatestTurn(completedTurn, { ...runningTurn, sequence: 8, updatedAt: "2026-09-02T00:00:00.000Z" }), completedTurn);
assert.equal(reconcileLatestTurn(completedTurn, { ...runningTurn, sequence: 10 })?.status, "running");
assert.equal(reconcileLatestTurn(undefined, null), null);
assert.equal(reconcileLatestTurn(completedTurn, null), completedTurn);
assert.deepEqual(reconcileTurnStatusPatch(runningTurn, { id: "t9", status: "completed", updatedAt: completedTurn.updatedAt }), completedTurn);
assert.equal(reconcileTurnStatusPatch(completedTurn, { id: "t8", status: "running" }), completedTurn);
assert.deepEqual(reconcileTurnStatusPatch(null, runningTurn), runningTurn);

mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T12:00:00.000Z") });
try {
  const recentStatusCalls = [];
  const recentStatusResults = [];
  const recentStatusClient = { space: () => ({ session: (id) => ({ turns: { listPaginated: async () => {
    recentStatusCalls.push(id);
    return { turns: [runningTurn] };
  } } }) }) };
  const sessions = [
    { id: "recent", spaceId: "space1", createdAt: "2026-01-01T00:00:00.000Z", lastMessageAt: "2026-09-08T11:59:00.000Z" },
    { id: "boundary", spaceId: "space1", lastMessageAt: "2026-09-08T11:30:00.000Z" },
    { id: "old", spaceId: "space1", status: "running", lastMessageAt: "2026-09-08T11:29:59.999Z", updatedAt: "2026-09-08T11:59:00.000Z" },
    { id: "no-messages", spaceId: "space1", lastMessageAt: null },
  ];
  await loadSessionLatestTurns(recentStatusClient, sessions, (id) => recentStatusResults.push(id));
  assert.deepEqual(recentStatusCalls, ["recent", "boundary"]);
  assert.deepEqual(recentStatusResults, ["recent", "boundary"]);
  recentStatusCalls.length = 0;
  await loadSessionLatestTurns(recentStatusClient, [sessions[2]], () => assert.fail("Old sessions must not publish a status"));
  assert.deepEqual(recentStatusCalls, []);
  await assert.rejects(loadSessionLatestTurns(recentStatusClient, [{ id: "invalid", spaceId: "space1", lastMessageAt: "not-a-date" }], () => assert.fail("Invalid activity dates must not publish a status")), /Invalid lastMessageAt for Chat invalid/);
  assert.deepEqual(recentStatusCalls, []);
  await loadSessionLatestTurns(recentStatusClient, sessions, () => undefined, 60);
  assert.deepEqual(recentStatusCalls, ["recent", "boundary", "old"], "a wider setting queries older message activity");
  recentStatusCalls.length = 0;
  await loadSessionLatestTurns(recentStatusClient, sessions, () => undefined, 5);
  assert.deepEqual(recentStatusCalls, ["recent"], "a shorter setting narrows status requests");
  recentStatusCalls.length = 0;
  mock.timers.tick(31 * 60 * 1000);
  await loadSessionLatestTurns(recentStatusClient, sessions, () => assert.fail("The recent window must advance on every refresh"));
  assert.deepEqual(recentStatusCalls, []);
} finally {
  mock.timers.reset();
}

assert.equal(DEFAULT_SESSION_FILTER_MINUTES, 30);
assert.equal(parseSessionFilterMinutes(" 45 "), 45);
assert.equal(parseSessionFilterMinutes("1"), 1);
assert.equal(parseSessionFilterMinutes("1440"), 1440);
for (const invalid of ["", "0", "-1", "1.5", "1441", "1e2", "30minutes", "Infinity"]) {
  assert.throws(() => parseSessionFilterMinutes(invalid), /whole number of minutes/);
}
const filterNow = Date.parse("2026-09-10T12:00:00.000Z");
const filterCutoff = sessionFilterCutoff(30, filterNow);
const recentBoundary = { lastMessageAt: "2026-09-10T11:30:00.000Z" };
const oldBoundary = { lastMessageAt: "2026-09-10T11:29:59.999Z" };
assert.equal(isSessionInFilterWindow(recentBoundary, filterCutoff), true);
assert.equal(isSessionInFilterWindow(oldBoundary, filterCutoff), false);
assert.equal(isSessionInFilterWindow({ lastMessageAt: null }, filterCutoff), false);
assert.equal(isSessionInFilterWindow(oldBoundary, sessionFilterCutoff(60, filterNow)), true);
assert.equal(isSessionInFilterWindow(recentBoundary, sessionFilterCutoff(30, filterNow + 1)), false, "entries expire as time advances");
const recentPaging = { hasMore: true, cursor: "next-page", boundary: recentBoundary, cutoff: filterCutoff };
assert.equal(hasMoreRecentSessions(recentPaging), true);
assert.equal(hasMoreRecentSessions({ ...recentPaging, boundary: oldBoundary }), false, "an old page stops filtered pagination even if older history remains");
assert.equal(hasMoreRecentSessions({ ...recentPaging, cursor: null }), false, "no unserviceable loading indicator without a cursor");
assert.equal(hasMoreRecentSessions({ ...recentPaging, hasMore: false }), false);
assert.equal(hasMoreRecentSessions({ ...recentPaging, boundary: { lastMessageAt: null } }), false, "null activity rows are last in server order");
assert.equal(hasMoreRecentSessions({ ...recentPaging, boundary: null }), true, "an empty permission-filtered page may still have recent results beyond it");
const recentPage = sessionPageState({ sessions: [recentBoundary], pageInfo: { hasMore: true, nextCursor: "recent-cursor" } });
const emptyVisiblePage = sessionPageState({ sessions: [], pageInfo: { hasMore: true, nextCursor: "gap-cursor" } }, recentPage.cursor, recentPage.boundary);
assert.deepEqual(emptyVisiblePage, { hasMore: true, cursor: "gap-cursor", boundary: recentBoundary });
const oldPage = sessionPageState({ sessions: [oldBoundary], pageInfo: { hasMore: true, nextCursor: "old-cursor" } }, emptyVisiblePage.cursor, emptyVisiblePage.boundary);
assert.equal(hasMoreRecentSessions({ ...oldPage, cutoff: filterCutoff }), false, "recent, permission-gap, old-page traversal terminates");
assert.equal(oldPage.hasMore, true, "All still has access to older pages");
assert.throws(() => sessionPageState({ sessions: [], pageInfo: { hasMore: true, nextCursor: null } }), /pagination did not advance/);
assert.throws(() => sessionPageState({ sessions: [], pageInfo: { hasMore: true, nextCursor: "same" } }, "same"), /pagination did not advance/);
assert.throws(() => sessionPageState({ sessions: [{ id: "broken", lastMessageAt: "not-a-date" }] }), /Invalid lastMessageAt/);
assert.deepEqual(sessionPageState({ sessions: [], pageInfo: { hasMore: false, nextCursor: null } }), { hasMore: false, cursor: null, boundary: null });

// Exercise the provider's real pagination callback with React's child-before-parent passive effect order.
const contextSource = ts.createSourceFile("context.tsx", readFileSync(new URL("../src/data/context.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let paginationCallback;
let refreshChatsCallback;
let stateSyncHook;
let timeoutSource;
const sessionCallbacks = {};
function inspectPagination(node) {
  if (ts.isVariableDeclaration(node) && ["openSession", "closeSession", "loadSession", "releaseSession", "sendMessage", "refreshSession", "loadLatestWindow"].includes(node.name.getText(contextSource))) {
    const callback = node.initializer;
    if (ts.isCallExpression(callback) && callback.expression.getText(contextSource) === "useCallback") sessionCallbacks[node.name.getText(contextSource)] = callback.arguments[0].getText(contextSource);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(contextSource) === "loadMoreSessions") paginationCallback = node.initializer.arguments[0].getText(contextSource);
  if (ts.isVariableDeclaration(node) && node.name.getText(contextSource) === "refreshChats") refreshChatsCallback = node.initializer.arguments[0].getText(contextSource);
  if (ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(contextSource)) && node.arguments[0]?.getText(contextSource).includes("stateRef.current = state;")) stateSyncHook = node.expression.getText(contextSource);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "withTimeout") timeoutSource = node.getText(contextSource);
  ts.forEachChild(node, inspectPagination);
}
inspectPagination(contextSource);
assert.ok(paginationCallback && stateSyncHook && timeoutSource);
const listReducerSource = contextSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "reducer");
const latestStatusSource = contextSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "updateLatestTurn");
const reducerHelperSources = ["preferNewerSession", "mergeSessionItem", "placeRunningSession"].map((name) => contextSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name).getText(contextSource)).join("\n");
const reduceListSync = new Function("sortByRecent", "reconcileSessionHead", "reconcileLatestTurn", "reconcileTurnStatusPatch", "emptyRunningSessions", "isActiveTurnStatus", "sessionListStatus", "sessionSourceFilterOf", "mergeSessionForks", ts.transpileModule(`${latestStatusSource.getText(contextSource)}\n${reducerHelperSources}\n${listReducerSource.getText(contextSource)}\nreturn reducer;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
  (rows) => [...rows].sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt)), reconcileSessionHead, reconcileLatestTurn, reconcileTurnStatusPatch, emptyRunningSessions, (status) => ["queued", "running", "abort_requested"].includes(status), sessionListStatus, sessionSourceFilterOf, mergeSessionForks,
);
const listSyncState = {
  sessions: syncRows, sessionsPagesLoaded: 2, sessionsHasMore: true, sessionsCursor: "tail-cursor", sessionsPageBoundary: { lastMessageAt: syncRows.at(-1).lastMessageAt },
  sessionsLoadingMore: false, sessionViews: { chat: { messages: ["optimistic"], oldestCursor: 20, newestCursor: 50 } }, sessionLatestTurns: {}, sessionTurnStatuses: {}, runningSessions: {}, realtimeError: null, sessionStatusRequests: 0,
};
const refreshedList = reduceListSync(listSyncState, { type: "sessions-head-success", sessions: [newHeadRow, ...syncRows.slice(0, 59)], hasMore: true, cursor: "new-head-cursor", boundary: { lastMessageAt: syncRows[58].lastMessageAt }, requestStartedAt: 300000 });
assert.equal(refreshedList.sessionsCursor, "tail-cursor");
assert.equal(refreshedList.sessionsPageBoundary, listSyncState.sessionsPageBoundary);
assert.equal(refreshedList.sessions.length, 121);
assert.equal(refreshedList.sessionViews, listSyncState.sessionViews, "list polling never replaces an open Chat history window or optimistic messages");
const completeHead = reduceListSync(listSyncState, { type: "sessions-head-success", sessions: syncRows.slice(0, 5), hasMore: false, cursor: null, boundary: { lastMessageAt: syncRows[4].lastMessageAt }, requestStartedAt: 300000 });
const lateTail = reduceListSync(completeHead, { type: "sessions-more-success", sessions: syncRows.slice(60), hasMore: false, cursor: null, boundary: listSyncState.sessionsPageBoundary });
assert.equal(lateTail.sessions, completeHead.sessions, "an old in-flight tail cannot restore rows removed by a complete head snapshot");
const backgroundStatusStart = reduceListSync(listSyncState, { type: "session-status-start", silent: true });
assert.equal(backgroundStatusStart.sessionStatusRequests, 0, "automatic status probes do not flash empty-list skeletons");
assert.equal(reduceListSync(backgroundStatusStart, { type: "session-status-end", silent: true }).sessionStatusRequests, 0);
const newerOutcome = reduceListSync(listSyncState, { type: "session-latest-turn", sessionId: "chat", turn: { ...completedTurn, sequence: 10 } });
const olderOutcome = reduceListSync(newerOutcome, { type: "session-latest-turn", sessionId: "chat", turn: { ...completedTurn, id: "older", sequence: 9 } });
assert.equal(olderOutcome.sessionLatestTurns.chat.sequence, 10);
assert.equal(olderOutcome.sessionTurnStatuses.older.status, "completed", "older active-turn reconciliation records its terminal state without replacing the latest outcome");
const partialRunningState = reduceListSync(listSyncState, { type: "running-success", source: "all", sessions: [runningFixture], changedSessionIds: [], complete: false });
assert.equal(partialRunningState.runningSessions.all.loading, true);
assert.equal(partialRunningState.runningSessions.all.loaded, false, "a first page must not claim account-wide coverage");
assert.deepEqual(partialRunningState.runningSessions.all.sessions, [runningFixture]);
const cancelledPartial = reduceListSync(partialRunningState, { type: "running-end", source: "all" });
assert.deepEqual(cancelledPartial.runningSessions.all.sessions, [runningFixture]);
assert.equal(cancelledPartial.runningSessions.all.loading, false);
const idleRunningPage = reduceListSync(partialRunningState, { type: "running-success", source: "all", sessions: [{ ...runningFixture, activeTurn: null }], changedSessionIds: [], complete: false });
assert.equal(idleRunningPage.runningSessions.all.sessions.length, 0, "a scanned idle row removes only that row from a partial snapshot");
const partialError = reduceListSync(partialRunningState, { type: "running-end", source: "all", error: "older page failed" });
assert.equal(partialError.runningSessions.all.loaded, false);
assert.equal(partialError.runningSessions.all.sessions.length, 1, "a failed historical page retains already discovered running rows");
const discoveredState = reduceListSync(listSyncState, { type: "running-success", source: "all", sessions: [runningFixture], changedSessionIds: [] });
assert.equal(discoveredState.sessions, listSyncState.sessions, "discovery must not contaminate the ordinary paginated list");
assert.equal(discoveredState.sessionsCursor, "tail-cursor");
const finalEventState = reduceListSync(discoveredState, { type: "session-realtime-turn", sessionId: runningFixture.id, turn: { ...completedTurn, id: "active" } });
const lateScanState = reduceListSync(finalEventState, { type: "running-success", source: "all", sessions: [runningFixture], changedSessionIds: [runningFixture.id] });
assert.equal(sessionListStatus(lateScanState.runningSessions.all.sessions[0], lateScanState.sessionLatestTurns[runningFixture.id], lateScanState.sessionTurnStatuses), "completed", "an old scan cannot resurrect a turn finalized by realtime");
const failedScanState = reduceListSync(discoveredState, { type: "running-end", source: "all", error: "discovery failed" });
assert.equal(failedScanState.runningSessions.all.sessions, discoveredState.runningSessions.all.sessions);
assert.equal(failedScanState.runningSessions.all.error, "discovery failed");
const unrelatedEvent = reduceListSync(discoveredState, { type: "session-realtime-turn", sessionId: "other-user-chat", turn: runningTurn });
assert.deepEqual(unrelatedEvent.runningSessions.all.sessions, discoveredState.runningSessions.all.sessions, "Space room membership alone does not admit a Chat into the user inbox");
assert.equal(unrelatedEvent.runningSessions, discoveredState.runningSessions, "an unknown Chat leaves Running untouched until it is read");
const settledEventState = reduceListSync(discoveredState, { type: "session-realtime-turn", sessionId: runningFixture.id, turn: { id: "active", sequence: 9, status: "completed", updatedAt: completedTurn.updatedAt } });
assert.deepEqual(settledEventState.runningSessions.all.sessions, [], "a settled Turn removes its Chat from Running without waiting for a scan");
const sourceBuckets = { ...listSyncState, runningSessions: { all: { ...emptyRunningSessions, loaded: true }, web: { ...emptyRunningSessions, loaded: true }, other: { ...emptyRunningSessions, loaded: true } } };
const cliChat = { ...runningFixture, id: "cli-chat", source: "cli", activeTurn: null };
const foundState = reduceListSync(sourceBuckets, { type: "running-session-found", session: { ...cliChat, activeTurn: { id: "cli-turn", sequence: 1, status: "running" } } });
assert.deepEqual([foundState.runningSessions.all.sessions.map((item) => item.id), foundState.runningSessions.other.sessions.map((item) => item.id), foundState.runningSessions.web.sessions.length], [["cli-chat"], ["cli-chat"], 0], "a Chat read after a live Turn joins All and its own source bucket");
assert.equal(reduceListSync(sourceBuckets, { type: "running-session-found", session: cliChat }).runningSessions, sourceBuckets.runningSessions, "an idle Chat read does not join Running");
const listedWebChat = { ...syncRows[0], source: null, activeTurn: null };
const liveListedState = reduceListSync({ ...sourceBuckets, sessions: [listedWebChat] }, { type: "session-realtime-turn", sessionId: listedWebChat.id, turn: { id: "web-turn", sequence: 2, status: "running", updatedAt: "2026-10-12T00:00:00Z" } });
assert.deepEqual([liveListedState.runningSessions.all.sessions.length, liveListedState.runningSessions.web.sessions.length, liveListedState.runningSessions.other.sessions.length], [1, 1, 0], "a loaded legacy web Chat joins the web bucket live");
const followupState = reduceListSync(reduceListSync(liveListedState, { type: "session-realtime-turn", sessionId: listedWebChat.id, turn: { id: "web-followup", sequence: 3, status: "queued", updatedAt: "2026-10-12T00:00:01Z" } }), { type: "session-realtime-turn", sessionId: listedWebChat.id, turn: { id: "web-turn", sequence: 2, status: "completed", updatedAt: "2026-10-12T00:00:02Z" } });
assert.equal(followupState.runningSessions.all.sessions.length, 1, "a queued follow-up keeps the Chat in Running after the earlier Turn settles");
const noScanBucket = reduceListSync({ ...listSyncState, sessions: [listedWebChat] }, { type: "session-realtime-turn", sessionId: listedWebChat.id, turn: { id: "web-turn", sequence: 2, status: "running", updatedAt: "2026-10-12T00:00:00Z" } });
assert.deepEqual([noScanBucket.runningSessions.all.loaded, noScanBucket.runningSessions.web], [false, undefined], "live rows never claim scan coverage or create unscanned source buckets");
assert.deepEqual(["web", "web_app", "Web App", null, "", "channel:web", "cli", "feishu:group", "channel_discord", "custom"].map(sessionSourceFilterOf), ["web", "web", "web", "web", "web", "web", "other", "other", "other", "other"], "source buckets mirror the server source keys");
const pageTimeout = new Function("HOME_REQUEST_TIMEOUT_MS", "translate", `${ts.transpileModule(timeoutSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return withTimeout;`)(15000, (_key, values) => `Timed out: ${values.label}`);
function paginationHarness(listSessions) {
  const stateRef = { current: { sessionsLoadingMore: true, sessionsHasMore: true, sessionsCursor: "old-page", refreshing: false, sessionsPageBoundary: recentBoundary } };
  const calls = [];
  const actions = [];
  const requestRef = { current: null };
  const generationRef = { current: 1 };
  const client = { user: { listSessions: (options) => { calls.push(options.cursor); return listSessions(options); } } };
  const load = new Function("stateRef", "client", "sessionsMoreRequestRef", "homeRefreshGenerationRef", "dispatch", "withTimeout", "sessionPageState", "refreshSessionStatuses", "saveSessions", "userKey", "errorMessage", "translate", `return ${paginationCallback}`)(stateRef, client, requestRef, generationRef, (action) => actions.push(action), pageTimeout, sessionPageState, () => {}, async () => {}, "test-user", (error) => error.message, (key) => key);
  return { load, calls, actions, requestRef, generationRef, stateRef };
}
// Provider effects can be cleaned up and restarted without recreating useState controllers.
const syncEffects = [];
let spaceRealtimeEffect;
function inspectSyncEffects(node) {
  if (ts.isCallExpression(node) && node.expression.getText(contextSource) === "useEffect" && node.arguments[1]?.getText(contextSource) === "[sync]") syncEffects.push(node.arguments[0].getText(contextSource));
  if (ts.isCallExpression(node) && node.expression.getText(contextSource) === "useEffect" && node.arguments[1]?.getText(contextSource) === "[spaceRealtime]") spaceRealtimeEffect = node.arguments[0].getText(contextSource);
  ts.forEachChild(node, inspectSyncEffects);
}
inspectSyncEffects(contextSource);
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
try {
  const sync = createSyncScheduler({ active: true, random: () => 0.5 });
  const scope = {
    sync, NativeAppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
    runningDiscoveryControllers: { current: new Set() }, subscriptions: { current: new Map() }, resyncCoordinatorRef: { current: { request: () => {} } },
  };
  const effects = syncEffects.map((effect) => new Function(...Object.keys(scope), `return (${effect});`)(...Object.values(scope)));
  for (const cleanup of effects.map((effect) => effect())) cleanup?.();
  const cleanups = effects.map((effect) => effect());
  let reads = 0;
  const stop = sync.watch("chats", { intervalMs: () => 15000, run: async () => { reads++; } });
  mock.timers.tick(250);
  await flushSync();
  mock.timers.tick(15000);
  await flushSync();
  assert.equal(reads, 2, "effect cleanup/restart must not permanently disable the account scheduler");
  stop();
  for (const cleanup of cleanups) cleanup?.();
  sync.dispose();

  let events = 0;
  let listener;
  let subscribed = 0;
  const spaceRealtime = createSpaceRealtime({
    subscribe: (_id, callback) => { listener = callback; subscribed++; return () => { subscribed--; }; },
    event: () => { events++; }, error: () => {},
  });
  const restartEffect = new Function("spaceRealtime", "NativeAppState", `return (${spaceRealtimeEffect});`)(spaceRealtime, scope.NativeAppState);
  restartEffect()();
  const stopEffect = restartEffect();
  const stopRoom = spaceRealtime.watch(["visible-space"]);
  assert.equal(subscribed, 1, "restarting provider effects must restore Space subscriptions");
  listener({ type: "session.created", spaceId: "visible-space" });
  assert.equal(events, 1);
  stopRoom();
  stopEffect();
  assert.equal(subscribed, 0, "unmount releases native room listeners");
} finally { mock.timers.reset(); }

// Exercise the actual provider callback through its scheduler, not just isolated timers.
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
try {
  for (const statusFailure of ["forbidden", "slow"]) {
    let reads = 0;
    const actions = [];
    const slowStatus = Promise.withResolvers();
    const scope = {
      homeRefreshRequestRef: { current: null }, chatsRefreshRequestRef: { current: null }, homeRefreshGenerationRef: { current: 0 },
      client: { user: { listSessions: async () => ({ sessions: [{ ...syncRows[0], id: `web-created-${++reads}` }], pageInfo: { hasMore: false, nextCursor: null } }) } },
      withTimeout: pageTimeout, sessionPageState, dispatch: (action) => actions.push(action), saveSessions: async () => {}, userKey: "test",
      errorMessage: (error) => error.message, translate: (key) => key,
      refreshSessionStatuses: async (_sessions, options) => {
        if (statusFailure === "slow") return slowStatus.promise;
        if (options.throwOnError) throw new Error("one Chat status is forbidden", { cause: { status: 403 } });
      },
    };
    const refresh = new Function(...Object.keys(scope), ts.transpileModule(`return (${refreshChatsCallback});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(scope));
    const scheduler = createSyncScheduler({ active: true, random: () => 0.5 });
    scheduler.watch("chats", { run: refresh, intervalMs: () => 15000 });
    mock.timers.tick(250);
    await flushSync();
    mock.timers.tick(15000);
    await flushSync();
    assert.equal(reads, 2, `${statusFailure}: status enrichment must not stop discovery of new web Chats`);
    assert.equal(actions.filter((action) => action.type === "sessions-head-success").at(-1).sessions[0].id, "web-created-2");
    assert.ok(!actions.some((action) => action.type === "sessions-head-error"), "status errors do not become list errors");
    scheduler.dispose();
    slowStatus.resolve();
    await flushSync();
  }
} finally { mock.timers.reset(); }

const handoff = paginationHarness(async () => ({ sessions: [], pageInfo: { hasMore: false, nextCursor: null } }));
const nextPageState = { ...handoff.stateRef.current, sessionsLoadingMore: false, sessionsCursor: "next-page" };
if (stateSyncHook === "useLayoutEffect") handoff.stateRef.current = nextPageState;
await handoff.load();
if (stateSyncHook === "useEffect") handoff.stateRef.current = nextPageState;
assert.deepEqual(handoff.calls, ["next-page"], "a completed page must request the next page instead of leaving a spinner with no active request");
assert.equal(handoff.actions.at(-1).type, "sessions-more-success");
assert.equal(handoff.requestRef.current, null);

mock.timers.enable({ apis: ["setTimeout"] });
try {
  const stalledPage = paginationHarness(() => new Promise(() => {}));
  stalledPage.stateRef.current = nextPageState;
  const pendingPage = stalledPage.load();
  mock.timers.tick(15000);
  await pendingPage;
  assert.equal(stalledPage.actions.at(-1).type, "sessions-more-error");
  assert.match(stalledPage.actions.at(-1).message, /Timed out/);
  assert.equal(stalledPage.requestRef.current, null, "timeouts release the pagination request for retry");
} finally {
  mock.timers.reset();
}
let resolveStalePage;
const stalePage = paginationHarness(() => new Promise((resolve) => { resolveStalePage = resolve; }));
stalePage.stateRef.current = nextPageState;
const pendingStalePage = stalePage.load();
stalePage.generationRef.current += 1;
resolveStalePage({ sessions: [oldBoundary], pageInfo: { hasMore: false, nextCursor: null } });
await pendingStalePage;
assert.deepEqual(stalePage.actions.map((action) => action.type), ["sessions-more-start"], "an old page cannot replace a newly refreshed list or cursor");

// Space first paint must not wait for optional pin metadata or the slowest resource endpoint.
const spaceScreenSource = ts.createSourceFile("space.tsx", readFileSync(new URL("../app/space/[spaceId]/index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const spaceCallbacks = {};
function inspectSpaceCallbacks(node) {
  if (ts.isVariableDeclaration(node) && ["loadSpace", "loadResources"].includes(node.name.getText(spaceScreenSource))) {
    spaceCallbacks[node.name.getText(spaceScreenSource)] = node.initializer.arguments[0].getText(spaceScreenSource);
  }
  ts.forEachChild(node, inspectSpaceCallbacks);
}
inspectSpaceCallbacks(spaceScreenSource);
const compileSpaceCallback = (name, scope) => new Function(...Object.keys(scope), ts.transpileModule(`return (${spaceCallbacks[name]});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(scope));
const slowPin = Promise.withResolvers();
const paintedSpaces = [];
const loadSpaceImmediately = compileSpaceCallback("loadSpace", {
  client: { spaces: { get: async () => ({ id: "space", name: "Fast Space" }) } }, spaceId: "space",
  spaceRefreshInFlightRef: { current: null }, spaceRefreshAtRef: { current: null }, cachedSpaceRef: { current: null }, SPACE_REFRESH_INTERVAL_MS: 60_000,
  spaceRefreshTokenRef: { current: 0 }, setSpaceLoading() {}, setSpaceError() {}, refreshSpacePin: () => slowPin.promise,
  setLoadedSpace: (space) => paintedSpaces.push(space), upsertSpace() {}, t: (key) => key, console,
});
const pendingSpacePaint = loadSpaceImmediately();
await flushSync();
assert.equal(paintedSpaces.length, 1, "Space shell paints when its detail request resolves, without waiting for pin metadata");
let cachedSpaceGets = 0;
const loadCachedSpace = compileSpaceCallback("loadSpace", {
  client: { spaces: { get: async () => { cachedSpaceGets++; return { id: "space" }; } } }, spaceId: "space",
  spaceRefreshInFlightRef: { current: null }, spaceRefreshAtRef: { current: null }, cachedSpaceRef: { current: { id: "space", name: "Cached", isPinned: true } }, SPACE_REFRESH_INTERVAL_MS: 60_000,
  spaceRefreshTokenRef: { current: 0 }, setSpaceLoading() {}, setSpaceError() {}, refreshSpacePin: async () => false,
  setLoadedSpace() {}, upsertSpace() {}, t: (key) => key, console,
});
await loadCachedSpace();
assert.equal(cachedSpaceGets, 0, "a cached Space does not block its first render on a duplicate metadata request");
slowPin.resolve(false);
await pendingSpacePaint;
const slowApps = Promise.withResolvers();
const resourcePaints = [];
const loadResourcesProgressively = compileSpaceCallback("loadResources", {
  client: {
    space: () => ({ checkpoints: { list: async () => ({ checkpoints: [{ id: "save" }] }) } }),
    apps: { listBySpace: () => slowApps.promise }, tasks: { list: async () => ({ runs: [{ id: "task" }] }) },
  },
  spaceId: "space", resourcesInFlightRef: { current: false }, resourcesRefreshAtRef: { current: 0 }, SPACE_REFRESH_INTERVAL_MS: 60_000,
  resourcesRequestRef: { current: 0 }, tasksRequestRef: { current: 0 }, allResourcesLoading: { checkpoints: true, apps: true, tasks: true },
  setResourceLoading() {}, setResources: (update) => resourcePaints.push(update({ checkpoints: [], apps: [], tasks: [] })), setResourceFailures() {}, setTaskCursor() {},
  mergeTaskRuns: (current, incoming) => [...current, ...incoming],
});
const pendingResourcePaint = loadResourcesProgressively();
await flushSync();
assert.ok(resourcePaints.some((resource) => resource.checkpoints.length === 1), "Saves render before a slower Works request settles");
assert.ok(resourcePaints.some((resource) => resource.tasks.length === 1), "Tasks render before a slower Works request settles");
slowApps.resolve({ apps: [] });
await pendingResourcePaint;

// Reopening hydrated history must not read and replace it with the older disk cache.
const reopenActions = [];
let reopenCacheReads = 0;
let reopenRefreshes = 0;
let reopenAttachments = 0;
const reopenView = { historyLoaded: true, messages: [{ id: "live" }], session: { id: "session", spaceId: "space" }, space: { id: "space" } };
const reopenScope = {
  client: { space: () => ({ session: () => ({ turns: { listPaginated: async () => ({ turns: [], hasMore: false }) } }) }) },
  openTokens: { current: new Map() },
  stateRef: { current: { sessions: [reopenView.session], spaces: [reopenView.space], sessionViews: { session: reopenView } } },
  dispatch: (action) => reopenActions.push(action),
  loadMessages: async () => { reopenCacheReads += 1; return []; },
  userKey: "test-user",
  recordSpaceVisit: () => {},
  attachSessionRealtime: () => { reopenAttachments += 1; },
  refreshSession: async (_id, options) => { assert.equal(options.silent, true); assert.equal(options.catchUp, true, "a warm open shows the catch-up state while the tail reconciles"); reopenRefreshes += 1; },
  messagesFromTurns: () => [],
  isLiveMessage: () => false,
  mergeDisplayMessages: (messages) => messages,
  loadTurnIndex: async () => {},
  saveMessages: async () => {},
  markChatEntry: () => {},
  startChatEntry: () => {},
  translate: (key) => key,
  withTimeout: pageTimeout,
};
const reopenSource = sessionCallbacks.loadSession ?? sessionCallbacks.openSession;
const reopen = new Function(...Object.keys(reopenScope), ts.transpileModule(`return (${reopenSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(reopenScope));
await reopen("session");
assert.equal(reopenCacheReads, 0, "warm opens must not rehydrate the entire SQLite history");
assert.equal(reopenActions.some((action) => action.type === "session-start"), false, "warm opens keep historyLoaded and pagination available");
assert.equal(reopenAttachments, 1, "after subscription release, warm opens still recover the authoritative stream");
assert.equal(reopenRefreshes, 1, "memory reuse still reconciles the server tail");

// The loaded turns stay one contiguous window: a gap would never be paged in by either cursor.
const turnRange = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => ({ id: `turn-${from + index}`, sessionId: "session", sequence: from + index, status: "completed", userText: `ask ${from + index}`, userContent: [], assistantText: null, assistantContent: null, meta: null }));
const windowSequences = (window) => window.turns.map((turn) => turn.sequence);
const windowOf = (from, to, hasMoreOlder, hasMoreNewer) => ({ turns: turnRange(from, to), hasMoreOlder, hasMoreNewer });
{
  const overlapping = mergeTurnWindows(windowOf(1, 40, false, false), windowOf(21, 50, true, false));
  assert.deepEqual([windowSequences(overlapping).length, overlapping.hasMoreOlder], [50, false], "a head the loaded turns reach keeps the older pages");
  assert.equal(mergeTurnWindows(windowOf(1, 30, false, false), windowOf(51, 80, true, false)), null, "windows with turns missing between them never join");
  const detached = windowOf(1, 25, true, true);
  assert.deepEqual([26, 27, 0].map((sequence) => turnFitsWindow(detached, sequence)), [true, false, true], "only Turns inside or next to a detached window join it");
  const live = [{ id: "in", meta: { turnSequence: 25 } }, { id: "past", meta: { turnSequence: 101 } }, { id: "unknown", meta: {} }];
  assert.deepEqual(messagesInWindow(live, detached).map((message) => message.id), ["in"], "a detached window shows only its own Turns, not records from the running tail");
}
async function refreshWith(view, head) {
  const actions = [];
  const refreshScope = {
    client: { space: () => ({ session: () => ({ turns: { listPaginated: async () => ({ session: view.session, turns: head.turns, hasMore: head.hasMoreOlder }) } }) }) },
    stateRef: { current: { sessionViews: { session: view } } },
    sessionLoadRef: { current: async () => {} },
    openTokens: { current: new Map() },
    paginationRequestsRef: { current: new Map() },
    markChatEntry: () => {},
    dispatch: (action) => actions.push(action),
    withTimeout: pageTimeout,
    mergeTurnWindows, mergeDisplayMessages, messagesFromTurns,
    isLiveMessage: () => false,
    saveMessages: async () => {},
    userKey: "test-user",
    translate: (key) => key,
  };
  const refresh = new Function(...Object.keys(refreshScope), ts.transpileModule(`return (${sessionCallbacks.refreshSession});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(refreshScope));
  await refresh("session", { silent: true, catchUp: true });
  return actions.find((action) => action.type === "session-refresh-end");
}
{
  const loadedView = (window) => ({ ...window, messages: [], session: { id: "session", spaceId: "space" }, space: { id: "space" } });
  const outrun = await refreshWith(loadedView(windowOf(1, 30, false, false)), windowOf(51, 80, true, false));
  assert.deepEqual([outrun.turns[0].sequence, outrun.turns.length, outrun.hasMoreOlder, outrun.hasMoreNewer], [51, 30, true, false], "a head that outran the loaded tail replaces it instead of leaving a gap");
  const pagedAway = await refreshWith(loadedView(windowOf(1, 25, false, true)), windowOf(71, 100, true, false));
  assert.deepEqual([pagedAway.turns.at(-1).sequence, pagedAway.hasMoreNewer], [25, true], "a reader paged away from the tail keeps their window");
  const paged = await refreshWith(loadedView(windowOf(1, 40, false, false)), windowOf(21, 50, true, false));
  assert.deepEqual([paged.turns.length, paged.hasMoreOlder], [50, false], "the tail refresh keeps pages loaded above it");
}
{
  const actions = [];
  const requests = [];
  const view = { ...windowOf(1, 25, false, true), session: { id: "session", spaceId: "space" } };
  const latestScope = {
    stateRef: { current: { sessions: [], sessionViews: { session: view } } },
    clientRef: { current: { space: () => ({ session: () => ({ turns: { listPaginated: async (options) => (requests.push(options), { session: view.session, turns: turnRange(71, 100), hasMore: true }) } }) }) } },
    openTokens: { current: new Map() }, withTimeout: pageTimeout, mergeTurnWindows, messagesFromTurns,
    dispatch: (action) => actions.push(action), saveMessages: async () => {}, userKey: "test-user", translate: (key) => key,
  };
  const loadLatest = new Function(...Object.keys(latestScope), ts.transpileModule(`return (${sessionCallbacks.loadLatestWindow});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(latestScope));
  const landed = await loadLatest("session");
  assert.deepEqual([requests, landed.replaced, landed.turns[0].sequence, actions[0].newest, actions[0].hasMoreNewer], [[{ limit: 30 }], true, 71, true, false], "jumping to latest from an old Turn is one request for the newest page, not a walk through every page between");
  latestScope.stateRef.current.sessionViews.session = { ...windowOf(71, 100, true, false), session: view.session };
  assert.deepEqual([(await loadLatest("session")).replaced, requests.length], [false, 1], "a window at the tail needs no request");
}

// A cold open must fail visibly instead of waiting forever on a stalled history request.
mock.timers.enable({ apis: ["setTimeout"] });
try {
  const coldActions = [];
  const coldScope = {
    client: { space: () => ({ session: () => ({ turns: { listPaginated: () => new Promise(() => {}) } }) }) },
    openTokens: { current: new Map() },
    stateRef: { current: { sessions: [{ id: "session", spaceId: "space" }], spaces: [{ id: "space" }], sessionViews: { session: { messages: [], session: { id: "session", spaceId: "space" }, space: { id: "space" } } } } },
    dispatch: (action) => coldActions.push(action),
    loadMessages: async () => [],
    userKey: "test-user",
    recordSpaceVisit: () => {},
    attachSessionRealtime: () => {},
    refreshSession: async () => {},
    messagesFromTurns: () => [],
    isLiveMessage: () => false,
    mergeDisplayMessages: (messages) => messages,
    loadTurnIndex: async () => {},
    saveMessages: async () => {},
    markChatEntry: () => {},
    startChatEntry: () => {},
    translate: (key) => key,
    withTimeout: pageTimeout,
    displaySpaceName: (space) => space.name,
  };
  const cold = new Function(...Object.keys(coldScope), ts.transpileModule(`return (${reopenSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(coldScope));
  const pendingCold = cold("session");
  await flushSync();
  mock.timers.tick(15000);
  await pendingCold;
  assert.equal(coldActions.at(-1).type, "session-error", "a stalled cold history request must fail instead of hanging the Chat");
  assert.match(coldActions.at(-1).message, /Timed out/);
} finally {
  mock.timers.reset();
}

const preferenceSource = ts.transpileModule(readFileSync(new URL("../src/data/session-filter-preference.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function loadPreferenceModule(storage) {
  const exports = {};
  new Function("require", "exports", preferenceSource)((name) => {
    if (name === "@react-native-async-storage/async-storage") return storage;
    if (name === "react") return {};
    throw new Error(`Unexpected preference dependency: ${name}`);
  }, exports);
  return exports;
}
let storedSource = null;
const sourceStorage = { getItem: async () => storedSource, setItem: async (_key, value) => { storedSource = value; } };
const sourcePreference = loadPreferenceModule(sourceStorage);
assert.equal(await sourcePreference.loadSessionSourcePreference(), "all", "missing source preference defaults to all");
assert.equal(sourcePreference.parseSessionSourceFilter("web"), "web");
assert.equal(sourcePreference.parseSessionSourceFilter("nonsense"), "all");
await sourcePreference.saveSessionSourcePreference("other");
assert.equal(storedSource, "other");
assert.equal(await sourcePreference.loadSessionSourcePreference(), "other");
assert.equal(await loadPreferenceModule(sourceStorage).loadSessionSourcePreference(), "other", "a new module instance restores the saved source");
let finishSourceRead;
const concurrentSource = loadPreferenceModule({ ...sourceStorage, getItem: () => new Promise((resolve) => { finishSourceRead = resolve; }), setItem: async () => {} });
const pendingSourceRead = concurrentSource.loadSessionSourcePreference();
await concurrentSource.saveSessionSourcePreference("web");
finishSourceRead("other");
assert.equal(await pendingSourceRead, "web", "a late stored snapshot cannot overwrite a user source save");

const statusCalls = [];
const statusResults = new Map();
const recentSession = { spaceId: "space1", lastMessageAt: new Date().toISOString() };
const statusClient = { space: (spaceId) => ({ session: (sessionId) => ({ turns: { listPaginated: async (options) => {
  statusCalls.push({ spaceId, sessionId, options });
  return { turns: sessionId === "empty" ? [] : [runningTurn] };
} } }) }) };
await loadSessionLatestTurns(statusClient, [{ ...recentSession, id: "s1", status: "idle" }, { ...recentSession, id: "empty", status: "running" }], (id, turn) => statusResults.set(id, turn));
assert.equal(statusResults.get("s1")?.status, "running");
assert.equal(statusResults.get("empty"), null);
assert.deepEqual(statusCalls[0], { spaceId: "space1", sessionId: "s1", options: { limit: 1, direction: "older" } });

let inFlightStatuses = 0;
let maxInFlightStatuses = 0;
let completedStatuses = 0;
await loadSessionLatestTurns({ space: () => ({ session: () => ({ turns: { listPaginated: async () => {
  inFlightStatuses += 1;
  maxInFlightStatuses = Math.max(maxInFlightStatuses, inFlightStatuses);
  await new Promise((resolve) => setTimeout(resolve, 0));
  inFlightStatuses -= 1;
  return { turns: [runningTurn] };
} } }) }) }, Array.from({ length: 15 }, (_, id) => ({ ...recentSession, id: String(id) })), () => { completedStatuses += 1; });
assert.equal(maxInFlightStatuses, 2);
assert.equal(completedStatuses, 15);

let sharedRequests = 0;
let sharedRunning = 0;
let sharedPeak = 0;
const sharedStatusClient = { space: () => ({ session: () => ({ turns: { listPaginated: async () => {
  sharedRequests++;
  sharedRunning++;
  sharedPeak = Math.max(sharedPeak, sharedRunning);
  await new Promise((resolve) => setTimeout(resolve, 0));
  sharedRunning--;
  return { turns: [runningTurn] };
} } }) }) };
const sharedSessions = Array.from({ length: 4 }, (_, id) => ({ ...recentSession, id: `shared-${id}` }));
await Promise.all([
  loadSessionLatestTurns(sharedStatusClient, sharedSessions, () => {}),
  loadSessionLatestTurns(sharedStatusClient, sharedSessions.slice(0, 2), () => {}),
]);
assert.equal(sharedRequests, 4, "overlapping screen/status refreshes share per-session requests");
assert.equal(sharedPeak, 2, "the status concurrency limit is shared across batches");
await loadSessionLatestTurns(sharedStatusClient, sharedSessions, () => {}, 30, { cached: true });
assert.equal(sharedRequests, 4, "unchanged outcomes are reused during automatic list polling");
await loadSessionLatestTurns(sharedStatusClient, sharedSessions, () => {}, 30, { shouldContinue: () => false });
assert.equal(sharedRequests, 4, "account disposal/background stops the remaining status batch");
for (let round = 0; round < 3; round++) {
  await Promise.all([
    loadSessionLatestTurns(sharedStatusClient, sharedSessions, () => {}),
    loadSessionLatestTurns(sharedStatusClient, sharedSessions.slice(2), () => {}),
  ]);
}
assert.equal(sharedPeak, 2, "repeated waiter handoffs retain the shared concurrency limit");

const oldActiveReads = [];
const oldActiveSession = { id: "old-chat", spaceId: "space", lastMessageAt: "2020-01-01T00:00:00Z", activeTurn: { id: "old-turn" } };
const oldActiveClient = { space: () => ({ session: () => ({ turns: {
  get: async (id) => { oldActiveReads.push(id); return { turn: { ...completedTurn, id } }; },
  listPaginated: () => assert.fail("An old known execution must be checked by turn ID"),
} }) }) };
await loadSessionLatestTurns(oldActiveClient, [oldActiveSession], () => {}, 30, { activeOnly: true });
assert.deepEqual(oldActiveReads, ["old-turn"], "active executions outside the recency window remain tracked");
await loadSessionLatestTurns(oldActiveClient, [oldActiveSession], () => {}, 30, {
  activeOnly: true,
  knownTurns: { "old-chat": { ...runningTurn, id: "new-turn" } },
  turnStatuses: { "old-turn": { ...completedTurn, id: "old-turn" } },
});
assert.deepEqual(oldActiveReads, ["old-turn", "new-turn"], "a stale active snapshot must not prevent checking the newer running turn");

const activeTasks = Array.from({ length: 105 }, (_, id) => ({ id: `task-${id}`, status: "running", createdAt: new Date(id * 1000).toISOString(), updatedAt: new Date(id * 1000).toISOString() }));
const taskBatches = [];
const nextTasks = await refreshTaskRuns({ tasks: {
  list: async () => ({ runs: [{ ...activeTasks[0], status: "completed", updatedAt: new Date(200000).toISOString() }] }),
  getMany: async (ids) => { taskBatches.push(ids); return { runs: ids.map((id) => ({ ...activeTasks.find((task) => task.id === id), status: "completed", updatedAt: new Date(200000).toISOString() })) }; },
} }, "space", activeTasks);
assert.deepEqual(taskBatches.map((batch) => batch.length), [100, 4]);
assert.equal(new Set(nextTasks.map((task) => task.id)).size, 105, "known active tasks outside the first page are not dropped");
const mergedTasks = mergeTaskRuns(activeTasks, nextTasks);
assert.ok(mergedTasks.every((task) => task.status === "completed"));
assert.equal(mergeTaskRuns(mergedTasks, activeTasks)[0].status, "completed", "late task pages cannot undo a newer status");
const failedStatusResults = [];
await assert.rejects(loadSessionLatestTurns({ space: () => ({ session: (id) => ({ turns: { listPaginated: async () => {
  if (id === "failed") throw new Error("Network unavailable");
  return { turns: [runningTurn] };
} } }) }) }, [{ ...recentSession, id: "failed", status: "running" }, { ...recentSession, id: "ok" }], (id) => failedStatusResults.push(id)), /Could not refresh 1 Chat status/);
assert.deepEqual(failedStatusResults, ["ok"]);

let resolveOldStatus;
let reconciledStatus = runningTurn;
const staleStatusRequest = loadSessionLatestTurns({ space: () => ({ session: () => ({ turns: { listPaginated: () => new Promise((resolve) => { resolveOldStatus = resolve; }) } }) }) }, [{ ...recentSession, id: "s1" }], (_id, turn) => { reconciledStatus = reconcileLatestTurn(reconciledStatus, turn); });
reconciledStatus = reconcileTurnStatusPatch(reconciledStatus, completedTurn);
resolveOldStatus({ turns: [runningTurn] });
await staleStatusRequest;
assert.equal(reconciledStatus.status, "completed");
mock.timers.enable({ apis: ["setTimeout"] });
try {
  const timedOutStatuses = loadSessionLatestTurns({ space: () => ({ session: () => ({ turns: { listPaginated: () => new Promise(() => {}) } }) }) }, [{ ...recentSession, id: "s1" }], () => assert.fail("A timeout must not publish a status"));
  const rejection = assert.rejects(timedOutStatuses, /Could not refresh 1 Chat status/);
  mock.timers.tick(15_000);
  await rejection;
} finally {
  mock.timers.reset();
}
assert.equal(isTransportRecovery("reconnecting", "open"), true);
assert.equal(isTransportRecovery("closed", "open"), true);
assert.equal(isTransportRecovery("error", "open"), true);
assert.equal(isTransportRecovery("idle", "open"), false);
assert.equal(isTransportRecovery("connecting", "open"), false);
assert.equal(isTransportRecovery("open", "open"), false);
assert.equal(isTransportRecovery("open", "reconnecting"), false);
// A recoverable realtime error keeps the socket open: never show it as an outage.
assert.equal(connectionDisplayState({ state: "error", recoverable: true }), null);
assert.equal(connectionDisplayState({ state: "error", recoverable: false }), "error");
assert.equal(connectionDisplayState({ state: "closed", willReconnect: true }), "reconnecting");
assert.equal(connectionDisplayState({ state: "closed", willReconnect: false }), "closed");
assert.equal(connectionDisplayState({ state: "open" }), "open");
assert.equal(connectionDisplayState({ state: "connecting" }), "connecting");
assert.equal(connectionDisplayState({ state: "reconnecting" }), "reconnecting");

mock.timers.enable({ apis: ["setTimeout"] });
try {
  // A pong-timeout close on a dead link must reach the SDK without waiting for the peer.
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = FakeSocket.OPEN;
    onclose = null;
    close() { this.readyState = FakeSocket.CLOSING; }
  }
  const Socket = withSettledClose(FakeSocket, 3_000);
  const closes = [];
  const dead = new Socket();
  dead.onclose = (event) => closes.push(event.code);
  dead.close(4002, "pong timeout");
  mock.timers.tick(2_999);
  assert.deepEqual(closes, []);
  mock.timers.tick(1);
  assert.deepEqual(closes, [4002]);
  const healthy = new Socket();
  healthy.onclose = (event) => closes.push(event.code);
  healthy.close(4002, "pong timeout");
  healthy.readyState = FakeSocket.CLOSED;
  mock.timers.tick(3_000);
  assert.deepEqual(closes, [4002], "a native close settles the socket itself");
} finally {
  mock.timers.reset();
}

mock.timers.enable({ apis: ["setTimeout"] });
try {
  let reconnects = 0;
  let active = true;
  const unavailable = [];
  const recovery = createRealtimeRecovery({
    reconnect: () => { reconnects += 1; },
    onUnavailableChange: (value) => unavailable.push(value),
    isActive: () => active,
    graceMs: 5_000,
    retryBaseMs: 2_000,
    retryMaxMs: 30_000,
  });
  recovery.update({ state: "closed", willReconnect: true });
  mock.timers.tick(60_000);
  assert.equal(reconnects, 0, "SDK-managed reconnects need no app retry");
  recovery.update({ state: "closed", willReconnect: false });
  mock.timers.tick(2_000);
  recovery.update({ state: "open" });
  mock.timers.tick(10_000);
  assert.deepEqual([reconnects, unavailable], [1, []], "a quick recovery never shows the banner");
  recovery.update({ state: "closed", willReconnect: false });
  mock.timers.tick(2_000);
  recovery.update({ state: "closed", willReconnect: false });
  mock.timers.tick(4_000);
  assert.deepEqual([reconnects, unavailable], [3, [true]], "retries back off while the banner stays up");
  active = false;
  recovery.update({ state: "closed", willReconnect: false });
  mock.timers.tick(8_000);
  assert.equal(reconnects, 3, "no retries in the background");
  active = true;
  recovery.foreground();
  recovery.update({ state: "open" });
  assert.deepEqual([reconnects, unavailable], [4, [true, false]]);
  recovery.dispose();
} finally {
  mock.timers.reset();
}

mock.timers.enable({ apis: ["setTimeout"] });
try {
  const resyncRuns = [];
  const resyncResolvers = [];
  const resync = createSessionResyncCoordinator({
    debounceMs: 250,
    run: (sessionId, reason) => new Promise((resolve) => {
      resyncRuns.push({ sessionId, reason });
    resyncResolvers.push(resolve);
    }),
  });
  // `open` and `active` firing back-to-back collapse into one run with the latest reason.
  resync.request("s1", "transport-open");
  resync.request("s1", "foreground");
  mock.timers.tick(249);
  assert.deepEqual(resyncRuns, []);
  mock.timers.tick(1);
  assert.deepEqual(resyncRuns, [{ sessionId: "s1", reason: "foreground" }]);
  // A trigger during an in-flight resync queues exactly one follow-up.
  resync.request("s1", "out-of-sync");
  resync.request("s1", "transport-open");
  mock.timers.tick(250);
  assert.equal(resyncRuns.length, 1);
  resyncResolvers.shift()();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(resyncRuns.at(-1), { sessionId: "s1", reason: "transport-open" });
  assert.equal(resyncRuns.length, 2);
  // Other sessions are independent.
  resync.request("s2", "foreground");
  mock.timers.tick(250);
  assert.equal(resyncRuns.length, 3);
  // Cancel drops a pending trigger; a rejected run must not break later runs.
  resync.request("s3", "foreground");
  resync.cancel("s3");
  mock.timers.tick(250);
  assert.equal(resyncRuns.filter((run) => run.sessionId === "s3").length, 0);
  const failing = createSessionResyncCoordinator({ debounceMs: 0, run: async () => { throw new Error("boom"); } });
  failing.request("s4", "foreground");
  mock.timers.tick(0);
  await Promise.resolve();
  await Promise.resolve();
  failing.request("s4", "foreground");
  mock.timers.tick(0);
  // Disposal cancels pending triggers and ignores new ones.
  resync.request("s5", "foreground");
  resync.dispose();
  resync.request("s6", "foreground");
  mock.timers.tick(250);
  assert.equal(resyncRuns.filter((run) => run.sessionId === "s5" || run.sessionId === "s6").length, 0);
  for (const resolve of resyncResolvers) resolve();
} finally {
  mock.timers.reset();
}

mock.timers.enable({ apis: ["setTimeout"] });
try {
  const flush = async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); };
  let clock = 1_000;
  const gatedRuns = [];
  const gated = createSessionResyncCoordinator({
    debounceMs: 0,
    cooldowns: { "out-of-sync": 15_000 },
    now: () => clock,
    run: async (sessionId, reason) => { gatedRuns.push({ sessionId, reason }); },
  });
  assert.equal(gated.request("s7", "out-of-sync"), true);
  mock.timers.tick(0);
  await flush();
  assert.deepEqual(gatedRuns, [{ sessionId: "s7", reason: "out-of-sync" }]);
  // Repeated drift inside the window is suppressed so a broken server cannot loop snapshots.
  assert.equal(gated.request("s7", "out-of-sync"), false);
  mock.timers.tick(0);
  await flush();
  assert.equal(gatedRuns.length, 1);
  // The window is per session.
  assert.equal(gated.request("s8", "out-of-sync"), true);
  mock.timers.tick(0);
  await flush();
  assert.equal(gatedRuns.length, 2);
  // Reconnect recovery is never throttled, even right after a re-seed.
  assert.equal(gated.request("s7", "transport-open"), true);
  mock.timers.tick(0);
  await flush();
  assert.deepEqual(gatedRuns.at(-1), { sessionId: "s7", reason: "transport-open" });
  // Once the window elapses another drift re-seed is allowed.
  clock += 15_000;
  assert.equal(gated.request("s7", "out-of-sync"), true);
  mock.timers.tick(0);
  await flush();
  assert.deepEqual(gatedRuns.at(-1), { sessionId: "s7", reason: "out-of-sync" });
  // Closing the Chat clears the window so reopening can re-seed immediately.
  gated.request("s7", "out-of-sync");
  gated.cancel("s7");
  assert.equal(gated.request("s7", "out-of-sync"), true);
  mock.timers.tick(0);
  await flush();
  assert.equal(gatedRuns.filter((run) => run.sessionId === "s7" && run.reason === "out-of-sync").length, 3);
  gated.dispose();
} finally {
  mock.timers.reset();
}

assert.equal(isWebSessionSource({ source: "web" }), true);
assert.equal(isWebSessionSource({ source: "web_app" }), true);
assert.equal(isWebSessionSource({ source: null }), true);
assert.equal(isWebSessionSource({ source: "mobile" }), true);
assert.equal(sessionSourceGroup({ source: "mobile" }), "web");
assert.equal(sessionSourceGroup({ source: "Web App" }), "web");
assert.equal(sessionSourceFilterKeys("all"), null);
assert.deepEqual(sessionSourceFilterKeys("web"), ["web"]);
assert.ok(sessionSourceFilterKeys("other")?.includes("other"));
assert.ok(!sessionSourceFilterKeys("other")?.includes("web"));
assert.deepEqual(toUserSessionLabels([
  { id: "src", name: "Source", source: "system", systemKey: null, children: [{ id: "web", name: "Web App", source: "system", systemKey: "session-source:web", children: [] }] },
  { id: "work", name: "Work", source: "user", systemKey: null, children: [{ id: "urgent", name: "Urgent", source: "user", systemKey: null, children: [] }] },
]).map((label) => label.ref), ["Work/Urgent", "Work"]);
assert.equal(normalizeSearchQuery("  server   result  "), "server result");
assert.equal(isResourcePinned([{ labelSystemKey: "user:pinned" }]), true);
assert.equal(isResourcePinned([{ labelSystemKey: "other" }]), false);
const listNow = Date.parse("2026-09-11T12:00:00Z");
const spaceListInput = {
  spaces: [{ id: "old", updatedAt: "2026-01-01", isPinned: true }, { id: "new", updatedAt: "2026-09-11" }],
  sessions: [{ spaceId: "old", lastMessageAt: "2026-09-11T11:00:00Z" }],
  overview: { spaces: [{ id: "new", lastParticipatedAt: null }, { id: "old", lastParticipatedAt: "2026-09-10" }] },
  visits: [], personalActivity: new Map(), now: listNow,
};
const spaceIds = (options) => selectSpaceList({ ...spaceListInput, ...options }).map((space) => space.id);
assert.deepEqual(spaceIds({ filter: "recent" }), ["old", "new"], "Recent uses personal participation, not Space updatedAt");
assert.deepEqual(spaceIds({ filter: "all" }), ["old", "new"], "All includes session activity");
assert.deepEqual(spaceIds({ filter: "pinned" }), ["old"]);
assert.deepEqual(spaceIds({ filter: "recent", visits: [{ spaceId: "new", timestamp: listNow }] }), ["new", "old"]);
assert.deepEqual(spaceIds({ filter: "recent", personalActivity: new Map([["new", listNow]]) }), ["new", "old"]);
assert.deepEqual(spaceIds({ filter: "recent", overview: null }), [], "No server or cached overview is not a fabricated recent list");
assert.equal(recentSpaceVisits(Array.from({ length: 12 }, (_, i) => ({ spaceId: String(i), timestamp: listNow - i })), listNow).length, 10);
assert.deepEqual(recentSpaceVisits([{ spaceId: "expired", timestamp: listNow - SPACE_VISIT_MAX_AGE_MS - 1 }], listNow), []);
assert.throws(() => recentSpaceVisits([{ spaceId: "", timestamp: listNow }], listNow), /Invalid Space visit/);

mock.timers.enable({ apis: ["setTimeout"] });
try {
  let loads = 0;
  const releases = [];
  const lifecycle = createSessionLifecycle({ load: async () => { loads += 1; }, release: (id) => releases.push(id), releaseDelayMs: 1000 });
  await lifecycle.open("running");
  for (let i = 0; i < 100; i += 1) {
    lifecycle.close("running");
    mock.timers.tick(100);
    await lifecycle.open("running");
  }
  assert.equal(loads, 1, "Rapid navigation reuses one load and live subscription");
  assert.deepEqual(releases, []);
  await lifecycle.open("running");
  lifecycle.close("running");
  mock.timers.tick(1001);
  assert.deepEqual(releases, [], "Another reader still owns the stream");
  lifecycle.close("running");
  mock.timers.tick(1000);
  assert.deepEqual(releases, ["running"]);
  await lifecycle.open("running");
  assert.equal(loads, 2, "A released session reconciles when reopened");
  lifecycle.close("running");
  lifecycle.clear();
  mock.timers.tick(1000);
  assert.deepEqual(releases, ["running", "running"], "Account cleanup releases once and cancels timers");

  let primedLoads = 0;
  const primedReleases = [];
  const primed = createSessionLifecycle({ load: async () => { primedLoads += 1; }, release: (id) => primedReleases.push(id), releaseDelayMs: 1000 });
  primed.prime("warm");
  primed.prime("warm");
  assert.equal(primedLoads, 1, "press-in prefetch shares one load");
  await primed.open("warm");
  assert.equal(primedLoads, 1, "opening a primed Chat reuses the in-flight load");
  mock.timers.tick(1000);
  assert.deepEqual(primedReleases, [], "an owned Chat does not release on the prefetch timer");
  primed.close("warm");
  mock.timers.tick(1000);
  assert.deepEqual(primedReleases, ["warm"]);
  primed.prime("cancel");
  mock.timers.tick(1000);
  assert.deepEqual(primedReleases, ["warm", "cancel"], "a cancelled press-in still releases");
} finally {
  mock.timers.reset();
}
assert.equal(panelForScrollOffset(0, 360, 760), "chat");
assert.equal(panelForScrollOffset(360, 360, 760), null);
assert.equal(panelForScrollOffset(760, 360, 760), "files");
assert.equal(panelForScrollOffset(150, 360, 760), "chat");
assert.equal(panelForScrollOffset(620, 360, 760), "files");
assert.equal(panelSwipeTarget(344, 200, 0, 344), 344, "a short slow drag snaps back closed");
assert.equal(panelSwipeTarget(344, 150, 0, 344), 0, "dragging past halfway opens Chats");
assert.equal(panelSwipeTarget(344, 400, -1200, 344), 688, "a leftward flick opens Files");
assert.equal(panelSwipeTarget(0, 300, -5000, 344), 344, "a flick from an open panel closes it instead of crossing to the other panel");

// Filter touches re-render the pager to toggle the swipe. Reapplying a closed-page
// contentOffset can reset the native scroll position even though no close was requested.
const panelsSource = ts.createSourceFile("SpacePanels.tsx", readFileSync(new URL("../src/components/SpacePanels.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let panelPager;
function findPanelPager(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(panelsSource) === "Reanimated.ScrollView") panelPager = node;
  ts.forEachChild(node, findPanelPager);
}
findPanelPager(panelsSource);
assert.ok(panelPager, "Space panels retain their native scroll pager");
const pagerAttributes = panelPager.attributes.properties.filter(ts.isJsxAttribute);
assert.equal(pagerAttributes.some((attribute) => attribute.name.getText(panelsSource) === "contentOffset"), false, "Filter touch re-renders must not reapply the closed-page contentOffset");
assert.equal(panelPager.attributes.properties.filter(ts.isJsxSpreadAttribute).some((spread) => spread.getText(panelsSource).includes("contentOffset")), false, "Spreading contentOffset and then dropping it resets the pager onto the Chats page");
// Render the real pager with native commands delayed until both layouts are ready.
// This checks geometry and callback ordering, not Android rendering or Reanimated scheduling.
function panelPagerHarness(initialPanel = null) {
  const slots = [];
  let cursor = 0;
  const effects = [];
  let viewportWidth = 400;
  const commits = [];
  let props = { spaceId: "space", spaceName: "Space", sessions: [], client: null, activePanel: initialPanel, onActivePanelChange: (panel) => { commits.push(panel); props = { ...props, activePanel: panel }; }, children: { type: "ChatContent" } };
  let measuredViewport = false;
  let measuredContent = false;
  let nativeX = 0;
  const commands = [];
  const diagnostics = [];
  const slot = (create) => { const index = cursor++; if (!(index in slots)) slots[index] = create(); return [index, slots[index]]; };
  const effect = (callback, deps) => {
    const [index, previous] = slot(() => null);
    if (!previous || deps.some((value, index) => value !== previous[index])) { effects.push(callback); slots[index] = deps; }
  };
  const reactions = [];
  const springs = [];
  const flushReactions = () => {
    for (const reaction of reactions) {
      const value = reaction.prepare();
      if (Object.is(value, reaction.previous)) continue;
      const previous = reaction.previous;
      reaction.previous = value;
      reaction.react(value, previous);
    }
  };
  const gestureBuilder = () => {
    const gesture = { config: {}, handlers: {} };
    for (const name of ["enabled", "activeOffsetX", "failOffsetY", "hitSlop"]) gesture[name] = (value) => { gesture.config[name] = value; return gesture; };
    for (const name of ["onStart", "onUpdate", "onEnd"]) gesture[name] = (handler) => { gesture.handlers[name] = handler; return gesture; };
    return gesture;
  };
  const renderPanels = loadChromeComponent("../src/components/SpacePanels.tsx", "SpacePanels", {
    ...chromeScope,
    useState: (initial) => { const [index, value] = slot(() => typeof initial === "function" ? initial() : initial); return [value, (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef: (initial) => slot(() => ({ current: initial }))[1],
    useSharedValue: (initial) => slot(() => ({ value: initial, get() { return this.value; }, set(value) { this.value = value; } }))[1],
    useEffect: effect, useLayoutEffect: effect,
    useCallback: (callback, deps) => {
      const [index, previous] = slot(() => null);
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useMemo: (factory, deps) => {
      const [index, previous] = slot(() => null);
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useWindowDimensions: () => ({ width: viewportWidth }), useSafeAreaInsets: () => ({ top: 0, bottom: 0 }), useIsFocused: () => true,
    useAnimatedScrollHandler: (handler) => handler, useAnimatedStyle: (style) => ({ animated: style }),
    useAnimatedRef: () => slot(() => ({ current: null }))[1],
    useAnimatedReaction: (prepare, react) => { const [, reaction] = slot(() => { const created = { previous: undefined }; reactions.push(created); return created; }); reaction.prepare = prepare; reaction.react = react; },
    scrollTo: (ref, x, _y, animated) => ref.current?.scrollTo({ x, animated }),
    cancelAnimation: () => {}, withSpring: (target, _config, callback) => { springs.push(callback); return target; }, ReduceMotion: { System: "system" },
    Gesture: { Pan: gestureBuilder }, GestureDetector: "GestureDetector",
    scheduleOnRN: (callback, ...args) => callback(...args),
    interpolate: (value, input, output) => Math.min(output[1], Math.max(output[0], value / input[1])), Extrapolation: { CLAMP: "clamp" },
    Reanimated: { ScrollView: "Pager", View: "AnimatedView" }, BackHandler: { addEventListener: () => ({ remove() {} }) },
    PANEL_WIDTH_RATIO: 0.86, MAX_PANEL_WIDTH: 360, PANEL_CLOSE_SETTLE_MS: 380,
    PANEL_SEED_RETRY_MS: 240, PANEL_SEED_FORCE_MS: 480, PANEL_SWIPE_SPRING: {},
    PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_VERTICAL_SLOP_PX, panelForScrollOffset, panelSwipeTarget, recordDebugEvent: (name, fields) => diagnostics.push({ name, fields }), chatScrollTrace: { record() {} }, ChatPanel: "ChatPanel", FilesPanel: "FilesPanel",
  });
  let tree;
  const render = () => {
    cursor = 0;
    tree = renderPanels(props);
    const pager = chromeNodes(tree).find((node) => node.type === "Pager");
    pager.props.ref.current = { scrollTo: (command) => { commands.push(command); if (measuredContent && measuredViewport) nativeX = Math.max(0, Math.min(command.x, 2 * Math.min(360, Math.max(280, viewportWidth * 0.86)))); } };
    while (effects.length) effects.shift()();
    flushReactions();
    return pager;
  };
  const dragged = [];
  const swipe = () => chromeNodes(tree).find((node) => node.type === "GestureDetector").props.gesture;
  let pager = render();
  const content = (contentWidth = 2 * Math.min(360, Math.max(280, viewportWidth * 0.86)) + viewportWidth) => { measuredContent = true; pager.props.onContentSizeChange(contentWidth, 800); };
  const layout = (height = 800) => { measuredViewport = height > 0; pager.props.onLayout?.({ nativeEvent: { layout: { width: viewportWidth, height } } }); };
  const style = (node) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean).map((value) => value.animated ? value.animated() : value));
  return {
    commands, commits, diagnostics: () => diagnostics, content, layout,
    resize: (width) => { viewportWidth = width; measuredContent = measuredViewport = false; pager = render(); },
    nodes: () => chromeNodes(tree),
    render: () => (pager = render()),
    nativeX: () => nativeX,
    pager: () => pager,
    paintCoverage: () => {
      const shift = style(pager).transform?.[0]?.translateX ?? 0;
      return Math.max(0, Math.min(viewportWidth, shift + viewportWidth) - Math.max(0, shift));
    },
    contentShift: () => style(pager.props.children[0]).transform?.[0]?.translateX ?? 0,
    scroll: (x) => { nativeX = x; pager.props.onScroll.onScroll({ contentOffset: { x } }); },
    swipe,
    swipeEnabled: () => swipe().config.enabled,
    dragged,
    drag: (translationX, velocityX = 0) => {
      const { handlers } = swipe();
      handlers.onStart({ translationX: Math.sign(translationX) * PANEL_SWIPE_ACTIVATION_PX });
      flushReactions();
      handlers.onUpdate({ translationX });
      flushReactions();
      dragged.push(commands.at(-1));
      handlers.onEnd({ translationX, velocityX });
      flushReactions();
    },
    landSpring: (x) => { nativeX = x; pager.props.onScroll.onScroll({ contentOffset: { x } }); while (springs.length) springs.shift()(true); flushReactions(); },
    setPanel: (panel) => { props = { ...props, activePanel: panel }; return (pager = render()); },
  };
}
const clippedPager = panelPagerHarness();
assert.equal(clippedPager.paintCoverage(), 400, "initial seeding must not translate/clip the viewport down to the 14% Chat strip seen in the report");
for (const order of ["content-first", "viewport-first"]) {
  const harness = panelPagerHarness();
  if (order === "content-first") { harness.content(); harness.layout(); }
  else { harness.layout(); harness.content(); }
  assert.equal(harness.nativeX(), 344, `${order}: seed only after both viewport and content can accept scrollTo`);
  harness.scroll(344);
  harness.render();
  assert.equal(harness.paintCoverage(), 400);
  assert.equal(harness.contentShift(), 0, "native acknowledgement removes content-only compensation");
}
const delayedPager = panelPagerHarness();
assert.ok(delayedPager.nodes().some((node) => node.type === "ChatPanel"), "Chats are mounted before the first swipe reveals them");
assert.ok(delayedPager.nodes().some((node) => node.type === "FilesPanel"), "Files are mounted and start loading before the first swipe reveals them");
assert.equal(delayedPager.pager().props.scrollEnabled, false, "the native pager never drags by itself; a slanted scroll cannot pull a panel out");
assert.equal(delayedPager.swipeEnabled(), false, "unseeded native pages cannot be dragged into view");
assert.deepEqual(delayedPager.swipe().config.activeOffsetX, [-PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_ACTIVATION_PX]);
assert.deepEqual(delayedPager.swipe().config.failOffsetY, [-PANEL_SWIPE_VERTICAL_SLOP_PX, PANEL_SWIPE_VERTICAL_SLOP_PX], "vertical travel hands the touch to the timeline");
assert.equal(delayedPager.contentShift(), -344, "only the page strip compensates for native offset zero");
delayedPager.scroll(0);
delayedPager.pager().props.onMomentumScrollEnd();
assert.deepEqual(delayedPager.commits, [], "pre-layout scroll/end events cannot commit a phantom open panel");
delayedPager.content();
delayedPager.layout(0);
assert.equal(delayedPager.commands.length, 0, "zero-height route-transition layouts cannot complete seeding");
delayedPager.layout();
delayedPager.render();
assert.equal(delayedPager.swipeEnabled(), false, "sending scrollTo is not acknowledgement");
assert.equal(delayedPager.contentShift(), -344, "the seed compensation holds until native acknowledges");
delayedPager.scroll(344);
delayedPager.render();
assert.equal(delayedPager.swipeEnabled(), true);
assert.deepEqual(delayedPager.swipe().config.hitSlop, { top: -56 }, "header touches never start the swipe, so the back button and iOS edge-back keep working");
const commandsAfterSeed = delayedPager.commands.length;
delayedPager.content();
delayedPager.layout();
delayedPager.render();
assert.equal(delayedPager.commands.length, commandsAfterSeed, "stream/list re-layouts never reposition a ready pager");
for (let cycle = 0; cycle < 2; cycle++) {
  delayedPager.drag(-120, -1200);
  assert.deepEqual(delayedPager.dragged.at(-1), { x: 344 + 120 - PANEL_SWIPE_ACTIVATION_PX, animated: false }, "the swipe follows the finger without jumping by the activation travel");
  assert.deepEqual(delayedPager.commits.slice(-1), cycle === 0 ? [] : [null], "releasing does not commit before the spring lands");
  delayedPager.landSpring(688);
  delayedPager.render();
  assert.equal(delayedPager.commits.at(-1), "files", "a released flick settles once the spring lands");
  assert.ok(delayedPager.nodes().some((node) => node.type === "FilesPanel"), "every repeated swipe reveals the preloaded Files panel");
  assert.ok(delayedPager.diagnostics().some(({ name }) => name === "navigation.pager.drag_begin"), "pager drags are visible to diagnostics");
  delayedPager.scroll(344);
  delayedPager.pager().props.onMomentumScrollEnd();
  delayedPager.render();
  assert.ok(delayedPager.nodes().some((node) => node.type === "FilesPanel"), "closing keeps Files warm for the next swipe");
}
delayedPager.setPanel("chat");
assert.deepEqual(delayedPager.commands.at(-1), { x: 0, animated: true }, "external menu commands still open the requested panel");
delayedPager.scroll(0);
delayedPager.pager().props.onMomentumScrollEnd();
delayedPager.render();
assert.ok(delayedPager.nodes().some((node) => node.type === "ChatPanel"));
delayedPager.setPanel(null);
delayedPager.scroll(344);
delayedPager.pager().props.onMomentumScrollEnd();
delayedPager.render();
delayedPager.resize(800);
delayedPager.content();
delayedPager.layout();
assert.equal(delayedPager.nativeX(), 360, "resize uses current native layout dimensions");
delayedPager.scroll(360);
delayedPager.render();
delayedPager.resize(900);
delayedPager.layout();
delayedPager.content();
delayedPager.render();
assert.equal(delayedPager.swipeEnabled(), true, "a capped-width panel can retain its confirmed offset across resize without a new scroll event");
assert.equal(delayedPager.paintCoverage(), 900);
for (const [initialPanel, offset] of [["chat", 0], ["files", 688]]) {
  const harness = panelPagerHarness(initialPanel);
  harness.scroll(0);
  harness.content();
  harness.layout();
  assert.equal(harness.nativeX(), offset, "mounting with a panel open seeds that panel, not the center");
  assert.equal(harness.commands.at(-1).x, offset, "right-panel targets must be reachable without native scroll clamping");
  harness.scroll(offset);
  harness.render();
  assert.equal(harness.swipeEnabled(), true);
}
// The seed depends on one native scroll event; when the first chat frame swallows it, the
// fallback must re-send and then force-complete, or the panel swipe stays dead for the screen.
{
  const timer = mock.timers;
  // Arm inside the mocked clock: timers registered before enable() are not intercepted.
  timer.enable({ apis: ["setTimeout"], now: 50_000 });
  try {
    const swallowedSeed = panelPagerHarness();
    swallowedSeed.content();
    swallowedSeed.layout();
    assert.equal(swallowedSeed.swipeEnabled(), false, "the seed still waits for acknowledgement before enabling the gesture");
    const commandsBeforeRetry = swallowedSeed.commands.length;
    timer.tick(240);
    swallowedSeed.render();
    assert.ok(swallowedSeed.commands.length > commandsBeforeRetry, "a swallowed seed acknowledgement is re-issued once");
    assert.equal(swallowedSeed.swipeEnabled(), false, "the retry alone cannot mark the pager ready");
    timer.tick(480);
    swallowedSeed.render();
    assert.equal(swallowedSeed.swipeEnabled(), true, "a second unacknowledged seed force-completes instead of deadlocking the gesture");
    assert.equal(swallowedSeed.contentShift(), 0, "forcing the seed drops the stale page-strip compensation");
    swallowedSeed.scroll(344);
    swallowedSeed.render();
    assert.equal(swallowedSeed.swipeEnabled(), true, "the pager stays usable after a forced seed");
  } finally { timer.reset(); }
}
const closingSeed = panelPagerHarness("files");
closingSeed.content();
closingSeed.layout();
const seedFilesPanel = closingSeed.nodes().find((node) => node.type === "FilesPanel");
seedFilesPanel.props.onClose();
closingSeed.render();
assert.equal(closingSeed.nativeX(), 344);
assert.ok(closingSeed.nodes().some((node) => node.type === "FilesPanel"), "closing before seed acknowledgement keeps the preloaded panel mounted");
closingSeed.scroll(344);
closingSeed.render();
assert.equal(closingSeed.swipeEnabled(), true);
assert.ok(panelsSource.text.includes("pagerSeed"), "The first paint must compensate until native scroll reaches the closed page");
assert.equal(panelsSource.text.includes("activePanelRef.current ?? visiblePanelRef.current"), false, "width realignment must not follow a pre-seed visiblePanel onto the Chats page");
assert.ok(pagerAttributes.some((attribute) => attribute.name.getText(panelsSource) === "onContentSizeChange"), "The pager still initializes its position on first layout");
assert.equal(panelsSource.text.includes("usePanelGestureBlocker"), false, "The pager must not be disabled for every message that happens to contain a fence");
const markdownAndroid = "../modules/react-native-enriched-markdown/android/src/main/java/com/swmansion/enriched/markdown/segments/";
const markdownPatch = ["NestedHorizontalScrollView.kt", "CodeBlockContainerView.kt", "TableContainerView.kt"].map((file) => readFileSync(new URL(markdownAndroid + file, import.meta.url), "utf8")).join("\n");
assert.ok(markdownPatch.includes("NestedHorizontalScrollView"), "Code-block scrolling must use a nested HorizontalScrollView that can claim the drag");
assert.ok(markdownPatch.includes("dispatchTouchEvent"), "Code-block scrolling must claim in dispatchTouchEvent; OnTouchListener never sees ACTION_DOWN");
assert.equal(markdownPatch.includes("setOnTouchListener {"), false, "OnTouchListener never sees ACTION_DOWN once the code TextView consumes it");
assert.doesNotMatch(markdownPatch, /ACTION_DOWN -> \{[^}]*requestDisallowInterceptTouchEvent/, "claiming on ACTION_DOWN cancels the panel swipe even at a code block's edge");
for (const file of ["../src/components/FloatingTabBar.tsx", "../src/components/SettingsSelectRow.tsx"]) {
  const gestureSource = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cancelCallbacks = [];
  const findCancel = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "onTouchesCancelled") cancelCallbacks.push(node.arguments[0].getText(gestureSource));
    ts.forEachChild(node, findCancel);
  };
  findCancel(gestureSource);
  assert.ok(cancelCallbacks.length > 0, `${file} still handles cancelled touches`);
  for (const callback of cancelCallbacks) assert.doesNotMatch(callback, /manager\.(fail|end|activate)\(/, `${file}: changing state from onTouchesCancelled re-enters the handler's own cancellation and crashes RNGH 3.3 on Android`);
}
const messageContent = readFileSync(new URL("../src/components/MessageContent.tsx", import.meta.url), "utf8");
assert.equal(messageContent.includes("usePanelGestureBlocker"), false, "Message markdown must not blanket-block the panel swipe");
assert.equal(messageContent.includes("holdsPanelGesture"), false, "Message markdown must not blanket-block the panel swipe");
assert.ok(panelsSource.text.includes("prefetchSession"), "opening a Chat from the space panel starts the load on press-in");
assert.ok(readFileSync(new URL("../app/(tabs)/(chats)/index.tsx", import.meta.url), "utf8").includes("prefetchSession"), "opening a Chat from Chats starts the load on press-in");
assert.match(readFileSync(new URL("../src/data/context.tsx", import.meta.url), "utf8"), /useLayoutEffect\(\(\) => \{\s*void openSession\(sessionId\);/, "Chat open must attach before paint so a prefetch can win the first frame");

// Space Chat counts come from a cached probe of the Space's first page.
const countListCalls = [];
let countInFlight = 0;
let countMaxInFlight = 0;
const countClient = {
  space: (spaceId) => ({
    sessions: {
      list: async ({ limit } = {}) => {
        countListCalls.push({ spaceId, limit });
        countInFlight += 1;
        countMaxInFlight = Math.max(countMaxInFlight, countInFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        countInFlight -= 1;
        const total = spaceId === "small" ? 3 : 25;
        const count = Math.min(total, limit ?? 20);
        return {
          sessions: Array.from({ length: count }, (_, index) => ({ id: `${spaceId}-${index}` })),
          pageInfo: { hasMore: total > count, nextCursor: null },
        };
      },
    },
  }),
};
await loadSpaceSessionCounts(countClient, Array.from({ length: 9 }, (_, index) => `space-${index}`));
assert.ok(countMaxInFlight <= 4, "Space count probes must stay within the concurrency cap");
await loadSpaceSessionCounts(countClient, ["small", "big"]);
assert.deepEqual(getSpaceSessionCount(countClient, "small"), { count: 3, hasMore: false });
assert.deepEqual(getSpaceSessionCount(countClient, "big"), { count: 20, hasMore: true });
const countCallsAfterProbe = countListCalls.length;
await loadSpaceSessionCounts(countClient, ["small", "big"]);
assert.equal(countListCalls.length, countCallsAfterProbe, "Fresh Space counts must be reused");
await loadSpaceSessionCounts(countClient, ["small"], { force: true });
assert.equal(countListCalls.length, countCallsAfterProbe + 1);
publishSpaceSessionCount(countClient, "published", 7, false);
assert.deepEqual(getSpaceSessionCount(countClient, "published"), { count: 7, hasMore: false });
const failingCountClient = { space: () => ({ sessions: { list: async () => { throw new Error("offline"); } } }) };
await loadSpaceSessionCounts(failingCountClient, ["broken"]);
assert.equal(getSpaceSessionCount(failingCountClient, "broken"), null, "Failed probes must not be cached");
const sharedProbes = [];
const shareCountClient = {
  space: (spaceId) => ({
    sessions: {
      list: async () => {
        sharedProbes.push(spaceId);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { sessions: [{ id: "shared-session" }], pageInfo: { hasMore: false, nextCursor: null } };
      },
    },
  }),
};
await Promise.all([
  loadSpaceSessionCounts(shareCountClient, ["shared"]),
  loadSpaceSessionCounts(shareCountClient, ["shared"]),
]);
assert.equal(sharedProbes.length, 1, "Concurrent probes for the same Space must be shared");
assert.deepEqual(getSpaceSessionCount(shareCountClient, "shared"), { count: 1, hasMore: false });

// Cache retention prunes by cache write time; the default window is one week.
assert.equal(DEFAULT_CACHE_RETENTION, "7d");
const retentionNow = Date.UTC(2026, 0, 10);
assert.equal(cacheRetentionCutoff("1d", retentionNow), retentionNow - 24 * 60 * 60 * 1000);
assert.equal(cacheRetentionCutoff("7d", retentionNow), retentionNow - 7 * 24 * 60 * 60 * 1000);
assert.equal(cacheRetentionCutoff("30d", retentionNow), retentionNow - 30 * 24 * 60 * 60 * 1000);
assert.equal(cacheRetentionCutoff("forever", retentionNow), null);

let fakePinned = false;
const pinCalls = [];
const fakeClient = {
  user: {
    labels: {
      getResourceLabels: async () => ({ assignments: fakePinned ? [{ labelSystemKey: "user:pinned" }] : [] }),
      patchResourceLabels: async (_resourceType, _resourceRef, input) => {
        pinCalls.push(input);
        fakePinned = Boolean(input.addLabelRefs);
        return { assignments: fakePinned ? [{ labelSystemKey: "user:pinned" }] : [] };
      },
    },
  },
};
assert.equal(await getResourcePinState(fakeClient, "session", "session-1", { force: true }), false);
assert.equal(await toggleResourcePin(fakeClient, "session", "session-1", false), true);
assert.deepEqual(pinCalls, [{ addLabelRefs: ["Pinned"] }]);

let resolveRaceRead;
let racePinned = false;
const raceRead = new Promise((resolve) => {
  resolveRaceRead = resolve;
});
const raceClient = {
  user: {
    labels: {
      getResourceLabels: async () => raceRead,
      patchResourceLabels: async (_resourceType, _resourceRef, input) => {
        racePinned = Boolean(input.addLabelRefs);
        return { assignments: racePinned ? [{ labelSystemKey: "user:pinned" }] : [] };
      },
    },
  },
};
const staleRead = getResourcePinState(raceClient, "session", "race-1", { force: true });
const raceMutation = toggleResourcePin(raceClient, "session", "race-1", false);
resolveRaceRead({ assignments: [] });
assert.equal(await staleRead, false);
assert.equal(await raceMutation, true);
assert.equal(await getResourcePinState(raceClient, "session", "race-1"), true);

let patchStarted = false;
let resolveFirstPatch;
const mutationClient = {
  user: {
    labels: {
      getResourceLabels: async () => ({ assignments: [] }),
      patchResourceLabels: async (_resourceType, _resourceRef, input) => {
        patchStarted = true;
        await new Promise((resolve) => { resolveFirstPatch = resolve; });
        return { assignments: input.addLabelRefs ? [{ labelSystemKey: "user:pinned" }] : [] };
      },
    },
  },
};
const mutation = toggleResourcePin(mutationClient, "session", "mutation-1", false);
while (!patchStarted) await new Promise((resolve) => setTimeout(resolve, 0));
let readDuringMutationResolved = false;
const readDuringMutation = getResourcePinState(mutationClient, "session", "mutation-1", { force: true }).then((value) => {
  readDuringMutationResolved = true;
  return value;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(readDuringMutationResolved, false);
resolveFirstPatch(true);
assert.equal(await mutation, true);
assert.equal(await readDuringMutation, true);

let invalidationReadCount = 0;
let resolveHangingRead;
const invalidationClient = {
  user: {
    labels: {
      getResourceLabels: async () => {
        invalidationReadCount += 1;
        if (invalidationReadCount === 1) return { assignments: [{ labelSystemKey: "user:pinned" }] };
        if (invalidationReadCount === 2) return new Promise((resolve) => { resolveHangingRead = resolve; });
        return { assignments: [] };
      },
    },
  },
};
assert.equal(await getResourcePinState(invalidationClient, "session", "retry-1"), true);
const hangingRead = getResourcePinState(invalidationClient, "session", "retry-1", { force: true });
await new Promise((resolve) => setTimeout(resolve, 0));
invalidateResourcePinReads(invalidationClient, "session", ["retry-1"]);
assert.equal(await getResourcePinState(invalidationClient, "session", "retry-1"), false);
resolveHangingRead({ assignments: [{ labelSystemKey: "user:pinned" }] });
assert.equal(await hangingRead, true);
assert.equal(invalidationReadCount, 3);

const searchResult = (overrides = {}) => ({
  type: "chat",
  id: "session-1",
  spaceId: "space-1",
  sessionId: "session-1",
  title: "A remote Chat",
  excerpt: "A server-side match",
  hit: { turnId: "turn-1", sequence: 7, excerpt: "Matched prompt", highlights: [] },
  matchCount: 2,
  spaceName: "Research",
  spaceProfile: null,
  matchedField: "userText",
  href: "/spaces/space-1/sessions/session-1?turn=7",
  score: 0.4,
  textScore: 0.9,
  recencyScore: 0.2,
  typePriorityScore: 0.2,
  updatedAt: "2026-09-01T00:00:00.000Z",
  source: "remote",
  ...overrides,
});

assert.deepEqual(
  getComposerActionState({ text: "follow up", hasAttachment: false, disabled: false, sending: false, running: true, hasStopHandler: true }),
  { blocked: false, hasDraft: true, canSend: true, canStop: false },
);
assert.deepEqual(
  getComposerActionState({ text: "", hasAttachment: false, disabled: false, sending: false, running: true, hasStopHandler: true }),
  { blocked: false, hasDraft: false, canSend: false, canStop: true },
);
assert.deepEqual(
  getComposerActionState({ text: "", hasAttachment: true, disabled: false, sending: false, running: true, hasStopHandler: true }),
  { blocked: false, hasDraft: true, canSend: true, canStop: false },
);
assert.deepEqual(
  getComposerActionState({ text: "follow up", hasAttachment: false, disabled: false, sending: true, running: true, hasStopHandler: true }),
  { blocked: true, hasDraft: true, canSend: false, canStop: false },
);
const composerLayoutInput = { text: "hello", contentHeight: 30, lineHeight: 22, availableHeight: 800, expanded: false };
assert.deepEqual(getComposerLayout({ ...composerLayoutInput, text: "" }), {
  expanded: false, showExpandButton: false, height: 44, scrollEnabled: false,
});
assert.deepEqual(getComposerLayout(composerLayoutInput), {
  expanded: false, showExpandButton: false, height: 44, scrollEnabled: false,
});
assert.equal(getComposerLayout({ ...composerLayoutInput, text: "hello\n" }).showExpandButton, true, "explicit newline is expandable before native measurement");
assert.deepEqual(getComposerLayout({ ...composerLayoutInput, contentHeight: 52 }), {
  expanded: false, showExpandButton: true, height: 52, scrollEnabled: false,
}, "soft-wrapped text grows and exposes expansion");
assert.deepEqual(getComposerLayout({ ...composerLayoutInput, contentHeight: 600 }), {
  expanded: false, showExpandButton: true, height: 120, scrollEnabled: true,
});
assert.deepEqual(getComposerLayout({ ...composerLayoutInput, contentHeight: 600, expanded: true }), {
  expanded: true, showExpandButton: true, height: 320, scrollEnabled: true,
});
assert.equal(getComposerLayout({ ...composerLayoutInput, contentHeight: 52, expanded: true }).height, 320, "an expanded editor keeps its height even when the content fits");
assert.equal(getComposerLayout({ ...composerLayoutInput, contentHeight: 52, expanded: true }).scrollEnabled, true, "an expanded editor stays scrollable because the estimate may undershoot real wraps");
assert.equal(getComposerLayout({ ...composerLayoutInput, expanded: true }).showExpandButton, true, "collapse remains available after deleting back to one line");
assert.deepEqual(getComposerLayout({ ...composerLayoutInput, text: "", contentHeight: 600, expanded: true }), {
  expanded: false, showExpandButton: false, height: 44, scrollEnabled: false,
}, "clearing or sending resets the layout even before the native measurement catches up");
assert.equal(getComposerLayout({ ...composerLayoutInput, availableHeight: 400, expanded: true }).height, 180, "expanded input leaves room above the keyboard");
assert.equal(getComposerLayout({ ...composerLayoutInput, availableHeight: 180, contentHeight: 600 }).height, 81, "short viewports also constrain the default input");
assert.equal(getComposerLayout({ ...composerLayoutInput, lineHeight: 44, contentHeight: 52 }).showExpandButton, false, "a large-font single line is not mistaken for multiline");
assert.equal(getComposerLayout({ ...composerLayoutInput, lineHeight: 44, contentHeight: 96 }).showExpandButton, true);
assert.equal(getComposerLayout({ ...composerLayoutInput, lineHeight: 44, contentHeight: 52 }).height, 52);
// A dictation final can land after the mic already stopped, so auto-expansion keys off the
// JS-driven append (no onChangeText round-trip), not off active recording.
const autoExpandInput = { value: "hello", expanded: false, scrollEnabled: true, lastUserText: "hello", autoExpandedFor: null };
assert.equal(shouldAutoExpandComposer(autoExpandInput), false, "user-typed text never auto-expands");
assert.equal(shouldAutoExpandComposer({ ...autoExpandInput, value: "a very long dictation transcript" }), true, "a JS-appended overflowing transcript expands even after the mic stopped");
assert.equal(shouldAutoExpandComposer({ ...autoExpandInput, value: "a very long dictation transcript", scrollEnabled: false }), false, "a short append that fits the collapsed box stays collapsed");
assert.equal(shouldAutoExpandComposer({ ...autoExpandInput, value: "a very long dictation transcript", autoExpandedFor: "a very long dictation transcript" }), false, "the append expands once so a manual collapse sticks while the transcript is reviewed");
assert.equal(shouldAutoExpandComposer({ ...autoExpandInput, value: "first sentence. a longer final sentence.", lastUserText: "first sentence.", autoExpandedFor: "first sentence." }), true, "the next dictation final re-arms the expansion");
assert.equal(shouldAutoExpandComposer({ ...autoExpandInput, value: "a very long dictation transcript", expanded: true }), false, "an already-expanded editor needs no expansion");
// Android's stale-watcher deadlock: a JS-driven final leaves the native measurement stale, so
// the text-derived estimate must expose the overflow and raise the collapsed height on its own.
const lineHeight = 22;
assert.equal(estimateComposerContentHeight("", lineHeight), 0, "empty text measures nothing");
assert.equal(estimateComposerContentHeight("word ".repeat(45), lineHeight), 8 * lineHeight + COMPOSER_TEXT_PADDING, "the estimate wraps long prose into multiple lines");
assert.equal(estimateComposerContentHeight("这是一段比较长的中文语音转写内容，".repeat(6), lineHeight), 7 * lineHeight + COMPOSER_TEXT_PADDING, "CJK glyphs count double so Chinese lines are not under-counted");
assert.equal(estimateComposerContentHeight("a\nb\nc", lineHeight), 3 * lineHeight + COMPOSER_TEXT_PADDING, "explicit newlines each take a line");
assert.equal(estimateComposerContentHeight("a short dictation transcript", lineHeight), lineHeight + COMPOSER_TEXT_PADDING, "a short append still estimates one line");
assert.equal(getComposerLayout({ text: "word ".repeat(45), contentHeight: Math.max(30, estimateComposerContentHeight("word ".repeat(45), lineHeight)), lineHeight, availableHeight: 800, expanded: false }).scrollEnabled, true, "the estimate alone unsticks the overflow signal when the native measurement is stale");
assert.equal(getComposerLayout({ text: "word ".repeat(45), contentHeight: Math.max(30, estimateComposerContentHeight("word ".repeat(45), lineHeight)), lineHeight, availableHeight: 800, expanded: false }).height, 120, "the estimated overflow still respects the collapsed height cap");
assert.equal(COMPOSER_CHROME_HEIGHT, 132);
assert.equal(collapsedComposerHeight(34), 166);
assert.equal(collapsedComposerHeight(0), 132);
assert.equal(collapsedComposerHeight(-1), 132);
assert.equal(keyboardOverlap({ screenY: 620, height: 336 }, 956), 336, "a docked keyboard covers its own height");
assert.equal(keyboardOverlap({ screenY: 0, height: 0 }, 956), 0, "the iOS resume frame must not cover the whole screen");
assert.equal(keyboardOverlap({ screenY: 0, height: 956 }, 956), 0, "a zero-origin frame is never a docked keyboard");
assert.equal(isUsableKeyboardFrame({ screenY: 0, height: 336 }), false);
assert.equal(isUsableKeyboardFrame(undefined), false);
assert.equal(keyboardOverlap({ screenY: 900, height: 336 }, 956), 56, "overlap stops at the window edge");
const composerMenuInput = { anchor: { x: 12, y: 680, width: 366, height: 114 }, windowWidth: 390, windowHeight: 844, topInset: 47, bottomInset: 34, keyboardTop: null, preferredWidth: 360 };
assert.deepEqual(getComposerMenuLayout(composerMenuInput), { left: 12, bottom: 172, width: 360, maxHeight: 480 });
assert.equal(getComposerMenuLayout({ ...composerMenuInput, preferredWidth: 240 }).width, 240, "attachments use a compact menu");
assert.equal(getComposerMenuLayout({ ...composerMenuInput, windowWidth: 320 }).width, 296, "menu fits narrow screens");
assert.equal(getComposerMenuLayout({ ...composerMenuInput, anchor: { ...composerMenuInput.anchor, x: 300 } }).left, 18, "menu stays inside the right edge");
const iosKeyboardMenu = getComposerMenuLayout({ ...composerMenuInput, keyboardTop: 500, bottomInset: 0 });
assert.deepEqual(iosKeyboardMenu, { left: 12, bottom: 352, width: 360, maxHeight: 433 }, "iOS menu clears the keyboard without resizing the modal window");
const androidKeyboardMenu = getComposerMenuLayout({ ...composerMenuInput, windowHeight: 500, keyboardTop: 500, bottomInset: 0 });
assert.deepEqual(androidKeyboardMenu, { left: 12, bottom: 12, width: 360, maxHeight: 429 }, "Android uses the resized modal height without double-subtracting the keyboard");
const tallDraftMenu = getComposerMenuLayout({ ...composerMenuInput, anchor: { ...composerMenuInput.anchor, y: 280 }, windowHeight: 400, keyboardTop: 400, bottomInset: 0 });
assert.equal(tallDraftMenu.maxHeight, 213, "a tall draft constrains the menu above it");
assert.ok(400 - tallDraftMenu.bottom - tallDraftMenu.maxHeight >= composerMenuInput.topInset + 12);
assert.equal(nextChatTailFollowing({ currentlyFollowing: true, distanceToBottom: 420, userInteracting: false, pendingTarget: false }), true);
assert.equal(nextChatTailFollowing({ currentlyFollowing: false, distanceToBottom: 420, userInteracting: false, pendingTarget: false }), false);
assert.equal(nextChatTailFollowing({ currentlyFollowing: true, distanceToBottom: 420, userInteracting: true, pendingTarget: false }), false);
assert.equal(nextChatTailFollowing({ currentlyFollowing: false, distanceToBottom: 20, userInteracting: true, pendingTarget: false }), true);
assert.equal(nextChatTailFollowing({ currentlyFollowing: true, distanceToBottom: 20, userInteracting: false, pendingTarget: true }), false);
assert.equal(nextChatTailFollowing({ currentlyFollowing: false, distanceToBottom: 20, userInteracting: false, pendingTarget: true }), false);
assert.equal(nextChatTailFollowing({ currentlyFollowing: true, distanceToBottom: 0, userInteracting: false, pendingTarget: false, detached: true }), false, "the end of a window paged away from the tail is not the tail; following it chained every newer page in");
// Growth (or an animated programmatic pin) must not read as the user scrolling away.
assert.equal(chatTailScrolledAway({ dragging: false, momentum: false, contentGrew: false, offsetDelta: 0 }), false);
assert.equal(chatTailScrolledAway({ dragging: true, momentum: false, contentGrew: false, offsetDelta: -40 }), true);
assert.equal(chatTailScrolledAway({ dragging: false, momentum: true, contentGrew: false, offsetDelta: -40 }), true);
assert.equal(chatTailScrolledAway({ dragging: false, momentum: true, contentGrew: true, offsetDelta: -40 }), false, "a streamed burst keeps the tail");
assert.equal(chatTailScrolledAway({ dragging: true, momentum: true, contentGrew: true, offsetDelta: -40 }), false, "growth under the finger still keeps the tail");
assert.equal(chatTailScrolledAway({ dragging: false, momentum: true, contentGrew: false, offsetDelta: 80 }), false, "the animated pin catching up is not a scroll-away");
assert.equal(chatTailScrolledAway({ dragging: true, momentum: true, contentGrew: false, offsetDelta: 80 }), false, "a programmatic pin must not look like a drag-away");
assert.equal(chatTailScrolledAway({ dragging: true, momentum: false, contentGrew: false, offsetDelta: 0 }), false, "holding still at the tail is not leaving");
assert.equal(chatFollowPinAnimated(0), true);
assert.equal(chatFollowPinAnimated(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD), true);
assert.equal(chatFollowPinAnimated(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD + 1), false, "a burst larger than the pin window snaps instead of chasing");
assert.equal(chatFollowPinAnimated(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD, false), false, "stay snapped until back on the tail");
assert.equal(chatFollowPinAnimated(CHAT_TAIL_THRESHOLD, false), true);
assert.equal(chatFollowPinAnimated(CHAT_TAIL_THRESHOLD + 1, false), false);
assert.equal(chatTailStalled(0, true), false, "on the tail with a frozen pin is fine");
assert.equal(chatTailStalled(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD, true), false, "a gap inside the pin window still animates");
assert.equal(chatTailStalled(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD + 1, true), true, "a frozen pin with an outgrown gap must recover");
assert.equal(chatTailStalled(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD + 1, false), false, "a moving pin is catching up, not stalled");
const displacedReset = { dragging: false, momentum: false, contentGrew: false, offsetDelta: -8844, distanceToLatest: 8844 };
assert.equal(chatTailDisplaced(displacedReset), true, "a list reset to the oldest row while following must re-pin the tail");
assert.equal(chatTailDisplaced({ ...displacedReset, dragging: true }), false, "a user drag toward older messages is a scroll-away");
assert.equal(chatTailDisplaced({ ...displacedReset, offsetDelta: 40 }), false, "a pin catching up toward the tail is not displaced");
assert.deepEqual(chatMaintainScrollAtEnd(true), { animated: true }, "sending must not disable the moving tail");
assert.deepEqual(chatMaintainScrollAtEnd(true, false), { animated: false }, "first-row measurement and reduced motion must not animate the pin");
assert.equal(chatMaintainScrollAtEnd(false), false);
const sendRect = { x: 10, y: 20, width: 100, height: 40 };
assert.deepEqual(interpolateSendBubbleRect(sendRect, { x: 110, y: 220, width: 180, height: 60 }, 0.5), { x: 60, y: 120, width: 140, height: 50 });
assert.deepEqual(await measureSendBubbleSource({ measureInWindow: (callback) => callback(20, 30, 100, 40) }, { measureInWindow: (callback) => callback(5, 10, 300, 500) }, 6), { x: 15, y: 20, width: 100, height: 40, scrollY: 6 });
const sentMessage = { id: "local", sessionId: "session", role: "user", meta: { clientMessageId: "same" } };
assert.equal(isSendBubbleMessage({ ...sentMessage, id: "server", meta: { clientMessageId: "same" } }, sentMessage), true);
assert.ok(motion.sendBubble.duration < 500, "send bubble handoff stays within a short interaction window");
const renderSendOverlay = loadChromeComponent("../src/components/SendBubbleOverlay.tsx", "SendBubbleOverlay", {
  ...chromeScope,
  useAppTheme: () => ({ radius: { md: 20 }, colors: {} }),
  Animated: { View: "AnimatedView" }, MessageBubble: "MessageBubble", QueuedFollowupRow: "QueuedFollowupRow", AttachmentChip: "AttachmentChip",
  useAnimatedRef: () => ({ current: null }), useSharedValue: (value) => ({ get: () => value }),
  useEffect: () => {}, useFrameCallback: () => {}, useAnimatedStyle: (callback) => callback(),
  interpolateSendBubbleRect, getBubbleMaxWidth, interpolate: () => 0, interpolateColor: () => "color", Extrapolation: { CLAMP: "clamp" },
});
for (const destination of ["bubble", "queue"]) {
  for (const attachments of [[], [{ uri: "file:///photo.png", name: "photo.png", mimeType: "image/png", size: 20 }], [{ uri: "file:///file.pdf", name: "file.pdf", mimeType: "application/pdf", size: 30 }]]) {
    const overlay = renderSendOverlay({
      transition: { message: sentMessage, text: attachments.length ? "" : "Hello", attachments, source: { ...sendRect, scrollY: 0 }, destination },
      message: sentMessage, queueItem: destination === "queue" ? { preview: "Queued", turn: null } : null,
      rootRef: {}, targetRef: {}, availableWidth: 390, spaceId: "space", onComplete: () => {},
    });
    const nodes = chromeNodes(overlay);
    assert.equal(nodes.filter((node) => node.type === "MessageBubble").length, destination === "bubble" ? 1 : 0, "queue animations must never render a bubble copy");
    assert.equal(nodes.filter((node) => node.type === "QueuedFollowupRow").length, destination === "queue" ? 1 : 0);
    assert.equal(nodes.filter((node) => node.type === "AttachmentChip").length, attachments.length, "attachment sources keep their visible file/image previews");
  }
}
// An unmounted destination row makes Reanimated's measure throw. Worklets does not catch an
// exception raised inside a UI-thread frame callback, so a throw here would abort the process
// (the 2.2.12 send-bubble crash): an unmeasurable view must read as not ready instead.
const measureView = loadChromeComponent("../src/components/SendBubbleOverlay.tsx", "measureView", {
  ...chromeScope,
  measure: () => { throw new Error("Value is null, expected an Object"); },
});
assert.equal(measureView({}), null, "an unattached destination ref is not ready, not fatal");
const measuredRect = { x: 1, y: 2, width: 3, height: 4, pageX: 5, pageY: 6 };
const measureMountedView = loadChromeComponent("../src/components/SendBubbleOverlay.tsx", "measureView", { ...chromeScope, measure: () => measuredRect });
assert.deepEqual(measureMountedView({}), measuredRect, "a mounted view still reports its measurement");
assert.ok(CHAT_FOLLOW_TAIL_MAINTAIN_THRESHOLD >= 1, "a streamed card can grow more than 10% of the screen in one layout");
assert.ok(CHAT_FOLLOW_TAIL_ANIMATE_THRESHOLD > CHAT_TAIL_THRESHOLD, "the smooth pin has room to catch a few lines before snapping");
const chatSource = readFileSync(new URL("../app/chat/[sessionId].tsx", import.meta.url), "utf8");
assert.ok(chatSource.includes("offsetDelta"), "the pin catching up is distinguished from scrolling toward older messages");
assert.ok(chatSource.includes("chatTailStalled"), "content growth must run the stall fallback so an opened-while-streaming chat recovers without a manual nudge");
assert.ok(chatSource.includes("chatTailDisplaced"), "a non-user scroll away from a followed tail must re-pin instead of hiding the jump-to-latest control");
assert.ok(chatSource.includes("chatFollowPinAnimated"), "a burst larger than the pin window must snap");
const runningRowMessages = [
  { id: "user-a", role: "user", meta: { turnId: "turn-a", turnSequence: 1 } },
  { id: "queued-b", role: "user", meta: { optimistic: true, turnSequence: 2 } },
];
assert.equal(liveReplyAnchor(runningRowMessages, "turn-a"), "user-a", "a queued send must not take ownership of the running turn's reply");
assert.equal(liveReplyAnchor(runningRowMessages, null), "queued-b", "a send without a turn id follows its optimistic user row");
assert.equal(liveReplyAnchor([], "turn-a"), null);
assert.equal(liveReplyAnchor(runningRowMessages, "not-yet-loaded", false), "queued-b", "unloaded history retains the live reply at the loaded tail");
assert.equal(liveReplyAnchor(runningRowMessages, "not-yet-loaded", true), null, "a window paged away from the tail does not show the tail's running reply under its last Turn");

// Execute the production renderItem: the reply must be a normal-flow sibling of
// the user bubble inside the SAME measured row, including after tool expansion.
const chatAst = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let renderMessageSource;
function findChatRender(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(chatAst) === "renderMessage") renderMessageSource = node.initializer.arguments[0].getText(chatAst);
  ts.forEachChild(node, findChatRender);
}
findChatRender(chatAst);
const liveRowScope = {
  ...chromeScope, messages: runningRowMessages, sendTransition: null, replyAnchor: "user-a", liveStream: true,
  turnSequenceForMessage: (message) => message.meta?.turnSequence ?? null,
  turnIndexBySequence: new Map(), turnsById: new Map(), turnsBySequence: new Map(),
  chatScrollTrace: { isRecording: () => false }, trackRow: () => {},
  MessageBubble: "MessageBubble", LiveReply: "LiveReply", TURN_START_STYLE: { paddingTop: 8 },
  listWidth: 390, windowWidth: 390, sessionId: "fixture", spaceId: "space", streamTurnId: "turn-a",
  handleCopyMessage: () => {}, forkMessage: () => {}, forkingTurnId: null, forkOrigin: null, ForkedFromDivider: "ForkedFromDivider",
  ArrivalRow: "ArrivalRow", arrivalBaseline: null, reducedMotion: false, isCatchUpArrival: () => false, messageRowKey,
};
const compileRenderMessage = (scope) => new Function(...Object.keys(scope), ts.transpileModule(`return (${renderMessageSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText)(...Object.values(scope));
const renderLiveRow = compileRenderMessage(liveRowScope);
{
  const forkMessages = [
    { id: "inherited-user", role: "user", meta: { turnSequence: 1 } },
    { id: "inherited-reply", role: "assistant", meta: { turnSequence: 1 } },
    { id: "own-user", role: "user", meta: { turnSequence: 2 } },
  ];
  const renderForkRow = compileRenderMessage({ ...liveRowScope, client: null, lookupSession: () => null, openRelatedSession: () => {}, messages: forkMessages, replyAnchor: null, forkOrigin: { sequence: 1, ref: { spaceId: "space", sessionId: "parent", turnId: "anchor" } } });
  const dividers = forkMessages.map((item, index) => chromeNodes(renderForkRow({ item, index })).filter((node) => node.type === "ForkedFromDivider").length);
  assert.deepEqual(dividers, [0, 1, 0], "the fork divider closes the anchor Turn's last row, before the fork's own Turns");
}
const ownerRow = renderLiveRow({ item: runningRowMessages[0], index: 0 });
assert.equal(ownerRow.type, "View");
assert.equal(typeof ownerRow.props.onLayout, "function");
assert.equal(ownerRow.props.children.length, 1, "the measured row has one content wrapper, so the catch-up fade never remounts its children");
assert.deepEqual(ownerRow.props.children[0].props.children.filter((child) => child?.type === "MessageBubble" || child?.type === "LiveReply").map((child) => child.type), ["MessageBubble", "LiveReply"]);
assert.equal(ownerRow.props.style?.paddingTop, 8, "a prompt opens its Turn with space above it, in place of the #N divider");
{
  const reply = { id: "reply-a", role: "assistant", meta: { turnId: "turn-a", turnSequence: 1 } };
  const renderReply = (scope) => compileRenderMessage({ ...liveRowScope, messages: [...runningRowMessages, reply], replyAnchor: null, ...scope })({ item: reply, index: 2 });
  assert.equal(renderReply({}).props.style, undefined, "a reply continues its Turn without the opening space");
  const replyBubble = (scope) => chromeNodes(renderReply(scope)).find((node) => node.type === "MessageBubble").props;
  assert.equal(replyBubble({ forkingTurnId: "turn-a" }).forking, true, "the fork spinner follows the forked Turn, not the lazily loaded Turn index");
}
assert.equal(chromeNodes(renderLiveRow({ item: runningRowMessages[1], index: 1 })).filter((node) => node.type === "LiveReply").length, 0);
const liveView = { stream: { turnId: "turn", intermediateMessages: [] }, sending: false, messages: [] };
const renderLiveReply = loadChromeComponent("../app/chat/[sessionId].tsx", "LiveReply", {
  ...chromeScope, useApp: () => ({ state: { sessionViews: { fixture: liveView } } }),
  StreamingTurnProcess: "StreamingTurnProcess", StreamCard: "StreamCard", isOptimisticFollowup, thinkingBlocks,
});
assert.equal(chromeNodes(renderLiveReply({ sessionId: "fixture", showStream: true, processInRow: true, availableWidth: 390 })).filter((node) => node.type === "StreamCard").length, 1);
assert.equal(renderLiveReply({ sessionId: "fixture", showStream: false, processInRow: true, availableWidth: 390 }), null, "completed replies leave no stale live duplicate");
liveView.sending = true;
assert.equal(renderLiveReply({ sessionId: "fixture", showStream: false, processInRow: false, availableWidth: 390 }).props.status, "pending");
const renderLiveProcess = loadChromeComponent("../app/chat/[sessionId].tsx", "LiveTurnProcess", {
  ...chromeScope,
  useApp: () => ({ state: { sessionViews: { fixture: { stream: { turnId: "turn", intermediateMessages: [] } } } } }),
  StreamingTurnProcess: "StreamingTurnProcess", TurnProcess: "TurnProcess", thinkingBlocks,
});
const pendingProcess = renderLiveProcess({ sessionId: "fixture", turn: { id: "turn", intermediateSummary: { messageCount: 4, toolCallCount: 4 } }, client: null, spaceId: "space" });
assert.equal(pendingProcess.type, "TurnProcess", "reconnecting with an empty stream must not remove the cached execution summary and collapse its row");
assert.ok(!chatSource.includes('traceEnd("initial.latest"'), "Legend initialScrollAtEnd owns initial placement, without a competing app scroll");
assert.ok(!chatSource.includes("transition_cleanup_scheduled"), "animation completion, not a click-time timer, owns handoff");
assert.ok(!chatSource.includes("Keyboard.dismiss()"), "sending keeps the keyboard open");
assert.ok(chatSource.includes("hidden={isTransitionMessage}"), "the list reserves geometry without displaying a duplicate bubble");
assert.ok(!/ListFooterComponent=\{[^\n]*ListEdgeLoader/.test(chatSource), "the catch-up loader must not resize the list under a followed tail");
assert.ok(chatSource.includes("chatMaintainScrollAtEnd(followingTail, openSettled && "), "opening snaps the tail pin; only a settled timeline animates it");
assert.deepEqual(chatListDistances(0, 4000, 700), { distanceToLatest: 3300, distanceToOldest: 0 });
assert.deepEqual(chatListDistances(3280, 4000, 700), { distanceToLatest: 20, distanceToOldest: 3280 });

const messages = [
  { role: "assistant", meta: { turnSequence: 6 } },
  { role: "user", meta: { turnSequence: 7 } },
  { role: "assistant", meta: { turnSequence: 7 } },
  { role: "user", meta: { turnSequence: 8 } },
];
assert.equal(messageIndexForTurn(messages, 7), 1);
assert.equal(messageIndexForTurn(messages, 8), 3);
assert.equal(messageIndexForTurn([{ role: "assistant", meta: { turnSequence: 9 } }], 9), 0);
assert.equal(messageIndexForTurn(messages, 99), -1);
assert.equal(latestUnreadAssistantIndex(messages, null), 2);
assert.equal(latestUnreadAssistantIndex(messages, 6), 2);
assert.equal(latestUnreadAssistantIndex(messages, 7), -1);
assert.equal(latestUnreadAssistantIndex([{ role: "assistant", sequence: 1, meta: null }], null), -1);

// Accent presets replace the base accent tokens in every mode and keep the default's contrast.
{
  const load = (path, dependencies) => {
    const moduleExports = {};
    const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "exports", source)((name) => dependencies[name], moduleExports);
    return moduleExports;
  };
  const tokens = { lightPalette, darkPalette, pureBlackOverrides, RADIUS, TEXT_RAMP };
  const accents = load("../src/design/accents.ts", { "@/src/design/tokens": tokens });
  const storage = new Map();
  const themeExports = load("../src/theme.ts", {
    "@react-native-async-storage/async-storage": { __esModule: true, default: { setItem: async (key, value) => storage.set(key, value), getItem: async (key) => storage.get(key) ?? null } },
    "react-native": { useColorScheme: () => "light" },
    react: { useEffect: () => {}, useMemo: (factory) => factory(), useState: (value) => [value, () => {}], useSyncExternalStore: (_, snapshot) => snapshot() },
    "@/src/design/accents": accents,
    "@/src/design/color": { colorWithOpacity },
    "@/src/design/tokens": tokens,
  });
  assert.equal(colorWithOpacity("#12345680", 0.5), "#12345640");
  assert.equal(colorWithOpacity("#123456", 0.2), "#12345633");
  assert.equal(themeExports.getAppThemeColors("light", false), lightPalette, "the default accent is the base palette itself");
  await themeExports.setAccentPreference("blue");
  assert.equal(storage.get("cohub:mobile:accent:v1"), "blue");
  const blueBlack = themeExports.getAppThemeColors("dark", true);
  assert.equal(blueBlack.accent, accents.ACCENTS.blue.dark.accent);
  assert.equal(blueBlack.background, pureBlackOverrides.background, "an accent keeps the pure black surfaces");
  assert.equal(accents.isAccentId("blue"), true);
  assert.equal(accents.isAccentId("custom"), false, "a stored id from a removed preset falls back to the default");
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
  for (const id of accents.ACCENT_IDS) {
    for (const [mode, base] of [["light", lightPalette], ["dark", darkPalette]]) {
      const preset = accents.ACCENTS[id][mode];
      for (const [label, foreground, background] of [
        ["accent on surface", preset.accent, base.surface],
        ["accentText on accent", preset.accentText, preset.accent],
        ["bubble text", preset.userBubbleText, preset.userBubble],
        ["bubble link", preset.userBubbleLink, preset.userBubble],
      ]) assert.ok(contrast(foreground, background) >= 4.5, `${id} ${mode}: ${label} must keep 4.5:1`);
    }
  }
}

// Environment selection shares accelerated origins without changing OAuth identity or explicit overrides.
{
  const source = ts.transpileModule(readFileSync(new URL("../src/config.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const extra = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo.extra;
  function loadConfig(env = {}, configuredExtra = extra) {
    const exports = {};
    new Function("require", "exports", "process", source)((name) => {
      if (name === "expo-constants") return { __esModule: true, default: { expoConfig: { extra: configuredExtra } } };
      if (name === "expo-linking") return { createURL: (path) => `cohub://${path}` };
      throw new Error(`Unexpected config dependency: ${name}`);
    }, exports, { env });
    return exports;
  }
  const module = loadConfig();
  assert.equal(module.defaultEnvironment, "prod");
  assert.equal(module.config.apiOrigin, "https://capi.neta.art");
  assert.equal(module.config.gatewayOrigin, "wss://cgateway.neta.art/ws");
  const reference = module.config;
  module.setActiveEnvironment("dev");
  assert.equal(module.config, reference, "environment switches retain the shared config identity");
  assert.equal(module.config.apiOrigin, "https://capi-dev.neta.art");
  assert.equal(module.config.gatewayOrigin, "wss://cgateway-dev.neta.art/ws");
  assert.equal(module.config.authEndpoint, "https://dev-auth.neta.art/");
  assert.equal(module.config.logtoAppId, "vpikk7sl9zwvefiptowtn");
  assert.equal(module.config.apiResource, "https://api.talesofai");
  module.setActiveEnvironment("prod");
  assert.equal(module.config.authEndpoint, "https://auth.neta.art/");
  assert.equal(module.config.logtoAppId, "16ai0wao2mud3xqkbzqo0");
  assert.equal(loadConfig({ EXPO_PUBLIC_COHUB_ENV: "dev" }).config.apiOrigin, "https://capi-dev.neta.art");
  assert.equal(loadConfig({}, {}).config.gatewayOrigin, "wss://cgateway.neta.art/ws", "JS defaults match app.json even without Expo extra");
  const overridden = loadConfig({ EXPO_PUBLIC_API_ORIGIN: " https://api.example.test ", EXPO_PUBLIC_GATEWAY_ORIGIN: " wss://gateway.example.test/ws " });
  for (const environment of ["prod", "dev"]) {
    const resolved = overridden.resolveConfig(environment);
    assert.equal(resolved.apiOrigin, "https://api.example.test");
    assert.equal(resolved.gatewayOrigin, "wss://gateway.example.test/ws");
  }
}

// Device Runtime: relays live at the gateway root, and tokens carry their expiry to native.
{
  const source = ts.transpileModule(readFileSync(new URL("../src/platform/device-runtime.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const calls = [];
  let enabled = true;
  const nativeRuntime = {
    isAvailable: () => true,
    isControlKeepAliveEnabled: () => enabled,
    setControlKeepAliveEnabled: (value) => { enabled = value; calls.push(value); },
  };
  function loadPlatform(os, runtime) {
    const exports = {};
    const dependencies = {
      react: {},
      "react-native": { Platform: { OS: os } },
      "@/modules/cohub-device-runtime": { __esModule: true, default: runtime },
      "@/src/config": { config: {} },
      "@/src/data/device-runtime": {},
    };
    new Function("require", "exports", source)((name) => {
      assert.ok(name in dependencies, `Unexpected device Runtime dependency: ${name}`);
      return dependencies[name];
    }, exports);
    return exports;
  }
  const platform = loadPlatform("android", nativeRuntime);
  assert.deepEqual(calls, [false], "JS startup disables idle keep-alive even before sign-in");
  assert.equal(platform.isDeviceControlKeepAliveEnabled(), false);
  platform.setDeviceControlKeepAliveEnabled(true);
  assert.equal(platform.isDeviceControlKeepAliveEnabled(), true);
  platform.setDeviceControlKeepAliveEnabled(false);
  assert.deepEqual(calls, [false, true, false], "policy changes cross the native interface immediately");
  const unavailable = loadPlatform("android", { isAvailable: () => false });
  assert.throws(() => unavailable.setDeviceControlKeepAliveEnabled(true), /cannot serve a Space/);
  const ios = loadPlatform("ios", nativeRuntime);
  assert.equal(ios.deviceRuntimeSupported, false);
  assert.throws(() => ios.isDeviceControlKeepAliveEnabled(), /cannot serve a Space/);
  assert.deepEqual(calls, [false, true, false], "unsupported platforms do not configure native services");
}
assert.equal(runtimeGatewayOrigin("wss://cgateway.neta.art/ws"), "wss://cgateway.neta.art");
assert.equal(runtimeGatewayOrigin("wss://cgateway-dev.neta.art/ws/"), "wss://cgateway-dev.neta.art");
for (const invalid of ["ws://cgateway.neta.art/ws", "wss://cgateway.neta.art", "wss://cgateway.neta.art/realtime"]) assert.throws(() => runtimeGatewayOrigin(invalid), /wss:\/\/<host>\/ws/);
const jwt = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
assert.equal(accessTokenExpiresAt(jwt({ exp: 1_800_000_000 })), 1_800_000_000_000);
assert.equal(accessTokenExpiresAt(jwt({ sub: "user" })), null);
assert.equal(accessTokenExpiresAt("opaque-token"), null);
assert.equal(isDeviceRuntimeRunning({ state: "connecting" }), true);
assert.equal(isDeviceRuntimeRunning({ state: "error" }), false);
assert.equal(isDeviceRuntimeRunning(null), false);
assert.equal(deviceFolderName({ label: "Internal storage/Documents/Notes" }), "Notes");
assert.equal(deviceFolderName({ label: "Internal storage" }), "Internal storage");
assert.equal(deviceRuntimeStateKey(null), "deviceRuntime.notConnected");
assert.equal(deviceRuntimeStateKey({ state: "error", error: "conflict" }), "deviceRuntime.error.conflict");
assert.equal(deviceRuntimeStateKey({ state: "error", error: null }), "deviceRuntime.error.failed");
assert.deepEqual(conflictedDeviceRuntimes([
  { spaceId: "conflict", state: "error", error: "conflict" },
  { spaceId: "forbidden", state: "error", error: "forbidden" },
  { spaceId: "failed", state: "error", error: null },
  { spaceId: "stopped", state: "stopped", error: null },
  { spaceId: "ready", state: "ready", error: null },
]).map((instance) => instance.spaceId), ["conflict"], "only a lost lease reconnects on its own; forbidden and user-stopped Spaces stay stopped");
assert.equal(deviceRuntimeRefusalKey("declined"), "deviceRuntime.accessRequired");
assert.equal(deviceRuntimeRefusalKey("space_in_use"), "deviceRuntime.spaceInUse");
assert.equal(deviceDisplayStateKey({ sharedWith: null, control: true, error: null }, "space-1"), "deviceRuntime.display.notShared");
assert.equal(deviceDisplayStateKey({ sharedWith: "space-2", control: false, error: null }, "space-1"), "deviceRuntime.display.notShared");
assert.equal(deviceDisplayStateKey({ sharedWith: "space-1", control: false, error: null }, "space-1"), "deviceRuntime.display.sharing");
assert.equal(deviceDisplayStateKey({ sharedWith: "space-1", control: true, error: null }, "space-1"), "deviceRuntime.display.sharingControl");

const spaceListCalls = [];
const pagedSpaces = await listAllSpaces({ spaces: { list: async (options) => {
  spaceListCalls.push(options);
  return options.cursor
    ? { items: [{ id: "space-2" }], pageInfo: { nextCursor: "ignored", hasMore: false } }
    : { items: [{ id: "space-1" }], pageInfo: { nextCursor: "page-2", hasMore: true } };
} } });
assert.deepEqual(pagedSpaces.map((space) => space.id), ["space-1", "space-2"]);
assert.deepEqual(spaceListCalls.map(({ filter, cursor, limit }) => ({ filter, cursor, limit })), [
  { filter: "all", cursor: null, limit: 100 },
  { filter: "all", cursor: "page-2", limit: 100 },
]);

const mapped = mapRemoteSearchResults([
  searchResult({ score: 0.99, title: "Remote Chat", hit: { turnId: "turn-7", sequence: 7, excerpt: "Matched prompt", highlights: [] } }),
  searchResult({ id: "session-2", sessionId: "session-2", title: "Title only", excerpt: null, hit: null, score: 0.3 }),
  searchResult({ type: "label", id: "label-1", sessionId: null, score: 0.9 }),
]);
assert.equal(mapped.sessions.length, 2);
assert.equal(mapped.sessions[0]?.sessionId, "session-1");
assert.equal(mapped.sessions[0]?.title, "Remote Chat");
assert.equal(mapped.sessions[0]?.preview, "Matched prompt");
assert.equal(mapped.sessions[0]?.turnSequence, 7);
assert.equal(mapped.sessions[0]?.turnId, "turn-7");
assert.equal(mapped.sessions[1]?.preview, null);
assert.equal(mapped.sessions[1]?.turnSequence, null);

assert.equal(toolCallPreview("skill_view", { skill: "github-pr-workflow" }), "github-pr-workflow");
assert.equal(toolCallPreview("terminal", { command: "git status --short --branch && git rebase" }), "git status --short --branch && git rebase");
assert.equal(toolCallPreview("bash", { command: { preview: "git pull --rebase origin main" } }), "git pull --rebase origin main");
assert.equal(toolCallPreview("read", { path: "src/app.ts" }), "src/app.ts");
assert.equal(toolCallPreview("unknown", {}), "");
assert.equal(formatToolCallCaption("skill_view", { skill: "github-pr-workflow" }), "skill_view: \"github-pr-workflow\"");
assert.equal(formatToolCallCaption("terminal", {}), "terminal");
assert.equal(formatMessageClock(new Date(2026, 0, 1, 19, 3).toISOString()), "19:03");
assert.equal(formatMessageClock("not-a-date"), "");

const apkOrigin = "https://mobile.talesofai.com";
const apkRelease = {
  version: "1.6.1",
  downloadUrl: androidUpdateApkUrl(apkOrigin, "1.6.1", "arm64-v8a"),
  downloadName: "cohub-v1.6.1-android-arm64-v8a.apk",
  downloadSize: 123,
  downloadSha256: "A".repeat(64),
};
for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) {
  const name = `cohub-v1.6.1-android-${abi}.apk`;
  const url = androidUpdateApkUrl(apkOrigin, "1.6.1", abi);
  assert.deepEqual(validateAndroidUpdateAsset({ ...apkRelease, downloadName: name, downloadUrl: url }, apkOrigin), {
    name, url, size: 123, sha256: "a".repeat(64),
  });
}
for (const invalid of [
  { version: "1.6.1-beta" },
  { downloadUrl: "https://github.com/markbang/cohub-mobile/releases/download/v1.6.1/cohub-v1.6.1-android-arm64-v8a.apk" },
  { downloadUrl: apkRelease.downloadUrl.replace("https:", "http:") },
  { downloadUrl: `${apkRelease.downloadUrl}?redirect=elsewhere` },
  { downloadName: "../update.apk" },
  { downloadName: "cohub-v1.6.0-android-arm64-v8a.apk" },
  { downloadSize: 0 },
  { downloadSize: NaN },
  { downloadSize: 1.5 },
  { downloadSha256: null },
  { downloadSha256: "invalid" },
]) assert.throws(() => validateAndroidUpdateAsset({ ...apkRelease, ...invalid }, apkOrigin));
assert.equal(selectYaotaAndroidUpdate({
  apks: [
    { version: "1.6.0", arch: "arm64-v8a", size: 100, sha256: "b".repeat(64), url: androidUpdateApkUrl(apkOrigin, "1.6.0", "arm64-v8a"), status: "Available", createdAt: "2026-01-01T00:00:00.000Z" },
    { version: "1.6.1", arch: "arm64-v8a", size: 123, sha256: "a".repeat(64), url: androidUpdateApkUrl(apkOrigin, "1.6.1", "arm64-v8a"), status: "Available", createdAt: "2026-01-02T00:00:00.000Z" },
    { version: "1.7.0", arch: "x86_64", size: 123, sha256: "c".repeat(64), url: androidUpdateApkUrl(apkOrigin, "1.7.0", "x86_64"), status: "Available", createdAt: "2026-01-03T00:00:00.000Z" },
  ],
}, apkOrigin, "arm64-v8a")?.version, "1.6.1");
const apkAsset = validateAndroidUpdateAsset(apkRelease, apkOrigin);
assert.doesNotThrow(() => verifyAndroidUpdateIntegrity(apkAsset, { size: 123, sha256: "a".repeat(64) }));
assert.throws(() => verifyAndroidUpdateIntegrity(apkAsset, { size: 124, sha256: apkAsset.sha256 }), /verification/);
assert.throws(() => verifyAndroidUpdateIntegrity(apkAsset, { size: 123, sha256: "b".repeat(64) }), /verification/);

const queuedFollowup = (id, sequence, overrides = {}) => ({ id, sequence, status: "queued", intent: "followup", userText: `Follow-up ${id}`, createdAt: "2026-09-01T00:00:00.000Z", ...overrides });
const activeQueueTurn = queuedFollowup("active", 1, { status: "running" });
assert.equal(shouldQueueFollowup([activeQueueTurn], null), true);
assert.equal(shouldQueueFollowup([], { status: "streaming" }), true);
assert.equal(shouldQueueFollowup([], { status: "pending" }), true);
assert.equal(shouldQueueFollowup([queuedFollowup("finished", 1, { status: "completed" })], { status: "completed" }), false);
const photoDraft = { uri: "file:///photo.png", name: "photo.png", mimeType: "image/png", size: 20 };
const fileDraft = { uri: "file:///report.pdf", name: "report.pdf", mimeType: "application/pdf", size: 30 };
for (const busy of [false, true]) {
  for (const [text, attachments] of [["Hello", []], ["", [photoDraft]], ["", [fileDraft]], ["Review these", [photoDraft, fileDraft]]]) {
    const actions = [];
    const prompts = [];
    const uploads = Promise.withResolvers();
    let optimistic;
    const turns = busy ? [activeQueueTurn] : [];
    const sendScope = {
      stateRef: { current: { sessionViews: { fixture: { session: { spaceId: "space" }, turns, messages: [], stream: null } } } },
      client: { space: () => ({ prompt: async (body) => (prompts.push(body), { mode: "immediate", turn: queuedFollowup("accepted", busy ? 2 : 1, { status: busy ? "queued" : "running", meta: { clientMessageId: "client" } }) }) }) },
      translate: (key) => key, newId: () => "client", nextTurnSequence,
      optimisticMessageSequenceRef: { current: new Map() }, userUuid: "user", userKey: "user",
      shouldQueueFollowup, recordDebugEvent: () => {}, dispatch: (action) => actions.push(action), saveMessages: async () => {},
      buildPromptContent: () => uploads.promise, withFallbackUserContent: (turn) => turn, sync: { invalidate: () => {} },
      mentionTextBlock: (blockText) => ({ type: "text", text: blockText }),
    };
    const send = new Function(...Object.keys(sendScope), ts.transpileModule(`return (${sessionCallbacks.sendMessage});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(sendScope));
    const request = send("fixture", text, attachments, { model: { provider: "openai", id: "gpt-5", thinkingLevel: "low" }, harness: "codex", onOptimistic: (message) => { optimistic = message; } });
    assert.ok(optimistic, "the animation destination exists before uploads complete");
    assert.equal(isOptimisticFollowup(optimistic), busy);
    assert.equal(optimistic.content.filter((block) => block.type === "image").length, attachments.filter((file) => file.mimeType.startsWith("image/")).length);
    if (attachments.includes(fileDraft)) assert.ok(optimistic.content.some((block) => block.type === "text" && block.text.includes("report.pdf")), "files stay visible even with a text caption");
    const localQueue = followupQueueItems(turns, busy ? "active" : null, [optimistic]);
    assert.equal(localQueue.length, busy ? 1 : 0, "queued uploads render as queue items; idle uploads render as messages");
    if (busy) {
      assert.equal(isSendQueueItem(localQueue[0], optimistic), true);
      assert.equal(isSendQueueItem({ ...localQueue[0], clientMessageId: "other" }, optimistic), false);
      assert.equal(localQueue[0].turn, null);
    }
    uploads.resolve(optimistic.content);
    await request;
    assert.equal(prompts[0].thinkingLevel, "low", "local Harness turns forward the selected thinking level like web");
    const accepted = actions.find((action) => action.type === "turn-upsert").turn;
    const acceptedQueue = followupQueueItems([...turns, accepted], busy ? "active" : accepted.id, [optimistic]);
    assert.equal(acceptedQueue.length, busy ? 1 : 0, "acceptance replaces the optimistic queue item, never duplicates it");
    if (busy) {
      assert.equal(isSendQueueItem(acceptedQueue[0], optimistic), true);
      assert.equal(followupQueueItems([{ ...activeQueueTurn, status: "completed" }, { ...accepted, status: "running" }], accepted.id, [optimistic]).length, 0, "a started turn leaves the queue even if an optimistic snapshot is still present");
    }
  }
}
{
  // A send lands after the newest Turn: a window paged away from it comes back to the tail first.
  for (const fails of [false, true]) {
    const actions = [];
    let optimistic;
    const sendScope = {
      stateRef: { current: { sessionViews: { fixture: { ...windowOf(1, 25, false, true), session: { spaceId: "space" }, messages: [], stream: null } } } },
      client: { space: () => ({ prompt: async () => ({ mode: "immediate", turn: queuedFollowup("accepted", 101, { status: "running", meta: { clientMessageId: "client" } }) }) }) },
      loadLatestWindow: async () => { if (fails) throw new Error("offline"); return { turns: turnRange(71, 100), replaced: true }; },
      errorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
      translate: (key) => key, newId: () => "client", nextTurnSequence,
      optimisticMessageSequenceRef: { current: new Map() }, userUuid: "user", userKey: "user",
      shouldQueueFollowup, recordDebugEvent: () => {}, dispatch: (action) => actions.push(action), saveMessages: async () => {},
      buildPromptContent: async (_client, _space, _session, text) => [{ type: "text", text }], withFallbackUserContent: (turn) => turn, sync: { invalidate: () => {} },
      mentionTextBlock: (blockText) => ({ type: "text", text: blockText }),
    };
    const send = new Function(...Object.keys(sendScope), ts.transpileModule(`return (${sessionCallbacks.sendMessage});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(sendScope));
    const request = send("fixture", "Next", [], { onOptimistic: (message) => { optimistic = message; } });
    if (fails) {
      await assert.rejects(request, /offline/);
      assert.deepEqual([actions.map((action) => action.type), optimistic], [["send-start", "send-failed"], undefined], "a send that cannot reach the tail shows progress, then fails visibly and keeps the draft");
    } else {
      await request;
      assert.equal(optimistic.meta.turnSequence, 101, "the optimistic send takes the Turn after the newest one, not after the old window");
    }
  }
}
const reducerFunction = contextSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "reducer");
const reduceQueueFailure = new Function("isOptimisticFollowup", "recordDebugEvent", "updateView", ts.transpileModule(`${reducerFunction.getText(contextSource)}; return reducer;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(isOptimisticFollowup, () => {}, (state, id, patch) => ({ ...state, sessionViews: { ...state.sessionViews, [id]: { ...state.sessionViews[id], ...patch } } }));
const failedQueuedMessage = { id: "upload", role: "user", meta: { optimistic: true, queuedFollowup: true, clientMessageId: "failed" } };
const queueFailure = reduceQueueFailure({ sessionViews: { fixture: { messages: [failedQueuedMessage] } } }, { type: "send-failed", sessionId: "fixture", clientMessageId: "failed", message: "Upload failed" });
assert.deepEqual(queueFailure.sessionViews.fixture.messages, [], "failed queued uploads return to the composer, not a failed message bubble");
const cachedOpen = reduceQueueFailure({ sessionViews: { fixture: { messages: [], catchingUp: false } } }, { type: "session-cache", sessionId: "fixture", messages: [{ id: "cached" }] });
assert.equal(cachedOpen.sessionViews.fixture.catchingUp, true, "cached history on screen waits visibly for the server tail");
assert.equal(reduceQueueFailure(cachedOpen, { type: "session-start", sessionId: "fixture" }).sessionViews.fixture.catchingUp, false, "a restarted open does not inherit an abandoned catch-up");
assert.equal(reduceQueueFailure({ sessionViews: { fixture: { catchingUp: false } } }, { type: "session-refresh-start", sessionId: "fixture", silent: true, catchUp: true }).sessionViews.fixture.catchingUp, true);
assert.equal(reduceQueueFailure({ sessionViews: { fixture: { catchingUp: false } } }, { type: "session-refresh-start", sessionId: "fixture", silent: true }).sessionViews.fixture.catchingUp, false, "the periodic tail poll must not flash the catch-up loader");
assert.equal(reduceQueueFailure({ sessionViews: { fixture: { catchingUp: true } } }, { type: "session-error", sessionId: "fixture", message: "x" }).sessionViews.fixture.catchingUp, false);
{
  const pagedAway = { ...windowOf(1, 25, false, true), messages: [{ id: "old" }], historyLoaded: true, oldestCursor: 1, newestCursor: 25, session: { id: "fixture" } };
  const released = reduceQueueFailure({ sessionViews: { fixture: pagedAway } }, { type: "session-release", sessionId: "fixture" }).sessionViews.fixture;
  assert.deepEqual([released.turns.length, released.messages.length, released.historyLoaded, released.hasMoreNewer, released.newestCursor], [0, 0, false, false, null], "leaving a Chat paged away from the tail reopens it on the latest turns");
  assert.equal(released.session, pagedAway.session);
  const atTail = { sessionViews: { fixture: { ...windowOf(1, 25, false, false), messages: [], historyLoaded: true } } };
  assert.equal(reduceQueueFailure(atTail, { type: "session-release", sessionId: "fixture" }), atTail, "a window at the tail stays warm for the next open");
  const contextFunction = (name) => contextSource.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name).getText(contextSource);
  const viewScope = {
    emptyView: () => ({ messages: [], turns: [], hasMoreOlder: false, hasMoreNewer: false, windowGeneration: 0, stream: null }),
    mergeTurnWindows, turnWindowsJoin, turnFitsWindow, latestTurn, mergeDisplayMessages, messagesFromTurns, turnSequenceForMessage,
    isTerminalTurnStatus, isActiveTurnStatus, pendingStreamForTurn, streamRecoveryFromTail,
    preferNewerSession: (_current, incoming) => incoming,
    updateView: (state, id, patch) => ({ ...state, sessionViews: { ...state.sessionViews, [id]: { ...state.sessionViews[id], ...patch } } }),
    updateLatestTurn: (state, id, turn) => ({ ...state, sessionLatestTurns: { ...state.sessionLatestTurns, [id]: turn ?? state.sessionLatestTurns?.[id] } }),
    isLiveMessage: (message) => message.meta?.optimistic === true || message.meta?._mobileLive === true,
    recordDebugEvent: () => {}, sortByRecent: (rows) => rows,
  };
  const reduceView = new Function(...Object.keys(viewScope), ts.transpileModule(`${contextFunction("turnClientMessageId")}\n${contextFunction("mergeTurnRecords")}\n${reducerFunction.getText(contextSource)}; return reducer;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(viewScope));
  const viewOf = (window) => ({ sessionViews: { fixture: { ...window, messages: [], windowGeneration: 0, stream: null } }, sessionLatestTurns: {} });
  const tailView = viewOf(windowOf(71, 100, true, false));
  const jumped = reduceView(tailView, { type: "session-window-success", sessionId: "fixture", turns: turnRange(1, 25), hasMoreOlder: false, hasMoreNewer: true }).sessionViews.fixture;
  assert.deepEqual([jumped.turns[0].sequence, jumped.turns.at(-1).sequence, jumped.hasMoreNewer, jumped.newestCursor, jumped.windowGeneration], [1, 25, true, 25, 0], "a jump far from the loaded turns pages forward from its own window, not across a gap; the turn jump places it itself");
  const latest = reduceView(viewOf(windowOf(1, 25, false, true)), { type: "session-window-success", sessionId: "fixture", turns: turnRange(71, 100), hasMoreOlder: true, hasMoreNewer: false, newest: true }).sessionViews.fixture;
  assert.deepEqual([latest.turns[0].sequence, latest.turns.length, latest.hasMoreOlder, latest.hasMoreNewer, latest.windowGeneration], [71, 30, true, false, 1], "jumping to latest loads the newest page in one request and lays it out fresh");
  const reattached = reduceView(viewOf(windowOf(60, 80, true, true)), { type: "session-window-success", sessionId: "fixture", turns: turnRange(71, 100), hasMoreOlder: true, hasMoreNewer: false, newest: true }).sessionViews.fixture;
  assert.deepEqual([reattached.turns.length, reattached.hasMoreNewer, reattached.windowGeneration], [41, false, 0], "a newest page that reaches the window extends it in place");
  const outrun = reduceView(viewOf(windowOf(1, 30, false, false)), { type: "session-refresh-end", sessionId: "fixture", silent: true, turns: turnRange(51, 80), messages: [], hasMoreOlder: true, hasMoreNewer: false }).sessionViews.fixture;
  assert.equal(outrun.windowGeneration, 1, "a tail refresh that replaced an outrun window lays the new one out fresh");
  const running = { ...turnRange(101, 101)[0], status: "running" };
  const detachedUpsert = reduceView(viewOf(windowOf(1, 25, false, true)), { type: "turn-upsert", sessionId: "fixture", turn: running });
  assert.deepEqual([detachedUpsert.sessionViews.fixture.turns.length, detachedUpsert.sessionViews.fixture.turns.at(-1).sequence, detachedUpsert.sessionViews.fixture.stream?.turnId, detachedUpsert.sessionLatestTurns.fixture.sequence], [25, 25, running.id, 101], "a Turn past a window paged away from the tail waits for the page that reaches it; status and the live reply still follow it");
  assert.equal(reduceView(tailView, { type: "turn-upsert", sessionId: "fixture", turn: running }).sessionViews.fixture.turns.at(-1).sequence, 101, "a window at the tail grows with new Turns");
}
{
  // The response replaces messages and clears catchingUp in one commit, so the baseline must
  // already exist in that render or the new rows paint once before they could fade in.
  const slots = [];
  let cursor = 0;
  let pendingRender = false;
  const hooks = {
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; pendingRender = true; }]; },
    useEffect: () => {},
  };
  const catchUpHook = loadChromeComponent("../src/components/use-chat-catch-up.ts", "useChatCatchUp", { ...hooks, CATCH_UP_LOADER_DELAY_MS: 300, ARRIVAL_WINDOW_MS: 800, messageRowKey });
  const isCatchUpArrival = loadChromeComponent("../src/components/use-chat-catch-up.ts", "isCatchUpArrival", { messageRowKey });
  const render = (catchingUp, messages) => { let result; do { pendingRender = false; cursor = 0; result = catchUpHook(catchingUp, messages); } while (pendingRender); return result; };
  const cached = [{ id: "a" }, { id: "b" }];
  assert.equal(render(true, cached).showLoader, false, "a catch-up shows its loader only after the delay");
  const landed = render(false, [...cached, { id: "c" }, { id: "local", meta: { optimistic: true } }]);
  assert.ok(landed.arrivalBaseline, "the arrival baseline survives the commit that ends the catch-up");
  assert.deepEqual([...cached, { id: "c" }, { id: "local", meta: { optimistic: true } }].filter((message) => isCatchUpArrival(landed.arrivalBaseline, message)).map((message) => message.id), ["c"], "only rows the response added fade in; local sends keep their own entrance");
  slots.length = 0;
  const cachedTurn = { id: "cached-row", role: "assistant", meta: { turnId: "turn", turnSequence: 4 } };
  render(true, [cachedTurn]);
  const reconciled = render(false, [{ ...cachedTurn, id: "turn:assistant" }, { id: "turn-5:user", role: "user", meta: { turnSequence: 5 } }]);
  assert.deepEqual([{ ...cachedTurn, id: "turn:assistant" }, { id: "turn-5:user", role: "user", meta: { turnSequence: 5 } }].filter((message) => isCatchUpArrival(reconciled.arrivalBaseline, message)).map((message) => message.id), ["turn-5:user"], "the server copy of a cached row is the same row, not an arrival that fades in again");
  slots.length = 0;
  assert.equal(render(true, []).arrivalBaseline, null, "a cold open with nothing on screen has nothing to arrive after");
}
const cachedSends = [];
const saveQueueMessages = loadChromeComponent("../src/data/local-db.ts", "saveMessages", {
  isOptimisticFollowup,
  cachedMessageRow: loadChromeComponent("../src/data/local-db.ts", "cachedMessageRow", { turnSequenceForMessage }),
  database: async () => ({
    withTransactionAsync: async (action) => action(),
    prepareAsync: async () => ({ executeAsync: async (...args) => cachedSends.push(args), finalizeAsync: async () => {} }),
  }),
});
await saveQueueMessages("user", "fixture", [failedQueuedMessage, { id: "accepted", role: "user", meta: { clientMessageId: "accepted" } }]);
assert.deepEqual(cachedSends.map((args) => args[2]), ["accepted"], "unaccepted queue placeholders must not survive a restart as cached messages");
assert.equal(followupPreviewText({ userText: null, userContent: [{ type: "image", _meta: { filename: "photo.png" } }] }), "photo.png");
assert.deepEqual(
  queuedFollowupTurns([
    { id: "running", sequence: 2, status: "running", intent: "followup", userText: "now", createdAt: "2026-09-01T00:00:00.000Z" },
    queuedFollowup("b", 4),
    queuedFollowup("a", 3),
    queuedFollowup("steer", 5, { intent: "steer" }),
    queuedFollowup("done", 6, { status: "cancelled" }),
  ], "running").map((turn) => turn.id),
  ["a", "b"],
);
assert.deepEqual(queuedFollowupTurns([queuedFollowup("active", 7)], "active"), []);
for (const status of ["completed", "failed", "interrupted", "merged", "cancelled"]) {
  const finished = queuedFollowup("finished", 8, { status });
  assert.deepEqual(
    queuedFollowupTurns([finished, queuedFollowup("new", 9)], "finished"),
    [],
    `${status} stream references must not put a new message in the follow-up queue`,
  );
  assert.deepEqual(
    queuedFollowupTurns([finished, queuedFollowup("running", 9, { status: "running" }), queuedFollowup("next", 10)], "finished").map((turn) => turn.id),
    ["next"],
    "a stale stream reference must not hide the queue behind an actually running turn",
  );
}
// A stale queued record after the previous turn completed is not a live queue: nothing is running to steer.
assert.deepEqual(queuedFollowupTurns([
  { id: "finished", sequence: 8, status: "completed", intent: "followup", userText: "done", createdAt: "2026-09-01T00:00:00.000Z" },
  queuedFollowup("stale", 9),
], null), []);
assert.deepEqual(queuedFollowupTurns([
  { id: "running", sequence: 10, status: "running", intent: "followup", userText: "now", createdAt: "2026-09-01T00:00:00.000Z" },
  queuedFollowup("next", 11),
], null).map((turn) => turn.id), ["next"]);
assert.equal(followupPreviewText({ userText: "  hello\n\n world  " }), "hello world");
assert.equal(followupPreviewText({ userText: "   " }), "Follow-up");
assert.equal(followupPreviewText({ userText: null }), "Follow-up");

assert.deepEqual(resolveMessageLink("cohub://spaces/241ec263-bd4f-47d6-b459-35b4219e0c23"), { kind: "space", spaceId: "241ec263-bd4f-47d6-b459-35b4219e0c23" });
assert.deepEqual(resolveMessageLink("cohub://spaces/241ec263-bd4f-47d6-b459-35b4219e0c23/sessions/81816f3f-02fa-4b71-b775-ba64a5759c8f"), { kind: "session", spaceId: "241ec263-bd4f-47d6-b459-35b4219e0c23", sessionId: "81816f3f-02fa-4b71-b775-ba64a5759c8f" });
assert.deepEqual(resolveMessageLink("https://cohub.live/spaces/241ec263-bd4f-47d6-b459-35b4219e0c23/sessions/81816f3f-02fa-4b71-b775-ba64a5759c8f?turn=3"), { kind: "session", spaceId: "241ec263-bd4f-47d6-b459-35b4219e0c23", sessionId: "81816f3f-02fa-4b71-b775-ba64a5759c8f" });
assert.deepEqual(resolveMessageLink("/workspace/avatars/out/contact-sheet.png"), { kind: "file", path: "/workspace/avatars/out/contact-sheet.png" });
assert.deepEqual(resolveMessageLink("https://example.com/x"), { kind: "external", url: "https://example.com/x" });
assert.equal(resolveMessageLink("javascript:alert(1)"), null);
assert.equal(resolveMessageLink(""), null);
assert.equal(MESSAGE_LINK_ORIGIN_SOURCE, COHUB_WEB_ORIGIN_SOURCE, "message links and composer link conversion accept the same Cohub origins");
for (const origin of ["https://cohub.run", "https://dev.cohub.live", "https://www.cohub.live", "http://localhost:5173"]) {
  assert.deepEqual(resolveMessageLink(`${origin}/spaces/241ec263-bd4f-47d6-b459-35b4219e0c23`), { kind: "space", spaceId: "241ec263-bd4f-47d6-b459-35b4219e0c23" }, origin);
}
assert.deepEqual(resolveMessageLink("https://cohub.live.evil.example/spaces/241ec263-bd4f-47d6-b459-35b4219e0c23"), { kind: "external", url: "https://cohub.live.evil.example/spaces/241ec263-bd4f-47d6-b459-35b4219e0c23" }, "lookalike hosts stay external");
assert.deepEqual(resolveMessageLink("cohub://apps/alice/studio/pulsewall?view=board"), { kind: "external", url: "https://cohub.live/alice/studio/w/pulsewall?view=board" });

// Composer @Space mentions: drafts keep server-parsed markup while the input shows `@Label`.
{
  const spaceId = "f7000115-55d8-4d97-a0e4-d2a55b6ffa41";
  const sessionId = "3b1e6a2c-9d4f-4a7b-8c5d-2e1f0a9b8c7d";
  const mention = `@[Design Studio](cohub://spaces/${spaceId})`;
  const draft = `hi ${mention} there`;
  const edit = (display) => applyComposerDisplayEdit(draft, display).markup;
  assert.equal(mentionDisplayText(draft), "hi @Design Studio there");
  assert.equal(mentionDisplayText(`x${mention}`), `x${mention}`, "mentions need a leading boundary, like the server parser");
  assert.equal(edit("hi @Design Studio there!"), `${draft}!`, "typing outside a mention keeps it");
  assert.equal(edit("hi @Design Studi there"), "hi @Design Studi there", "cutting into a mention degrades it to its plain label");
  assert.equal(edit("hi x@Design Studio there"), "hi x@Design Studio there", "detaching a mention from its boundary degrades it");
  assert.equal(edit("hi@Design Studio there"), "hi@Design Studio there");
  assert.equal(applyComposerDisplayEdit(`${mention} ${mention}`, "@Design Studio@Design Studio").markup, `${mention}@Design Studio`);
  for (const display of ["hi @Design Studio there!", "hi @Design Studi there", "hi x@Design Studio there", "@Design Studio there", ""]) {
    assert.equal(mentionDisplayText(edit(display)), display, "mapped markup always renders what the native input shows");
  }

  assert.deepEqual(detectSpaceMentionTrigger("ask @des", { start: 8, end: 8 }), { start: 4, end: 8, query: "des" });
  assert.deepEqual(detectSpaceMentionTrigger("ask @", { start: 5, end: 5 }), { start: 4, end: 5, query: "" });
  assert.equal(detectSpaceMentionTrigger("mail a@b", { start: 8, end: 8 }), null, "@ inside a word is not a trigger");
  assert.equal(detectSpaceMentionTrigger("ask @des", { start: 5, end: 8 }), null);
  assert.equal(detectSpaceMentionTrigger(`hi @[Design](cohub://spaces/${spaceId})`, { start: 10, end: 10 }), null, "an inserted mention is not re-triggered");
  const inserted = insertSpaceMention("ask @des now", { start: 4, end: 8, query: "des" }, { spaceId, label: "Design [x]  Studio" });
  assert.equal(inserted.markup, `ask @[Design x Studio](cohub://spaces/${spaceId}) now`, "labels are sanitized and existing whitespace is reused");
  assert.equal(inserted.caret, "ask @Design x Studio ".length);
  assert.equal(insertSpaceMention("@", { start: 0, end: 1, query: "" }, { spaceId, label: "" }).markup, `@[space:f7000115](cohub://spaces/${spaceId}) `);

  // Slash commands are plain text: the server expands `/name` and `/skill:name` at turn start.
  assert.deepEqual(detectSlashCommandTrigger("/mod"), { start: 0, end: 4, query: "mod" });
  assert.deepEqual(detectSlashCommandTrigger("/"), { start: 0, end: 1, query: "" });
  assert.deepEqual(detectSlashCommandTrigger("  /skill:gp"), { start: 2, end: 11, query: "skill:gp" });
  assert.equal(detectSlashCommandTrigger("/mod arg"), null, "a typed argument closes the token, like the web composer");
  assert.equal(detectSlashCommandTrigger("ask /mod"), null, "the slash only counts at the start of the draft");
  assert.equal(detectSlashCommandTrigger(`/${'a'.repeat(81)}`), null, "queries over the length limit are ignored");

  const prompts = [{ name: "mod", description: "Run a mod", scope: "project", argumentHint: "<slug>" }, { name: "review", description: "Review the diff", scope: "user", category: "Code" }];
  const skills = [{ name: "git-guardrails", description: "Block destructive git", scope: "mod", source: { type: "mod", modSpaceId: spaceId, mountSlug: "toolbox" } }];
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "" }).map((item) => slashCommandLabel(item)), ["review", "mod", "skill:git-guardrails"], "an empty query keeps prompts before skills");
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "rev" }).map((item) => item.name), ["review"]);
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "skill:git" }).map((item) => item.kind), ["skill"], "skills match on their `/skill:` label");
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "toolbox" }).map((item) => item.name), ["git-guardrails"], "a mod mount slug matches its skill");
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "code" }).map((item) => item.name), ["review"], "categories match");
  assert.deepEqual(selectSlashCommandItems({ prompts, skills, query: "nope" }), []);
  assert.equal(slashCommandText({ kind: "skill", name: "git-guardrails" }), "/skill:git-guardrails");

  const picked = insertSlashCommand("/rev", { start: 0, end: 4, query: "rev" }, { kind: "prompt", name: "review" });
  assert.equal(picked.markup, "/review ", "the caret leaves room for arguments");
  assert.equal(picked.caret, "/review ".length);
  assert.equal(insertSlashCommand("/rev now", { start: 0, end: 5, query: "rev" }, { kind: "prompt", name: "review" }).markup, "/review now", "existing spacing after the token is reused");
  assert.equal(insertSlashCommand("  /skill:git", { start: 2, end: 12, query: "skill:git" }, { kind: "skill", name: "git-guardrails" }).markup, "  /skill:git-guardrails ", "leading whitespace survives");

  const pasted = `see https://cohub.live/spaces/${spaceId}, https://www.cohub.live/spaces/${spaceId}/sessions/${sessionId}?turn=2 https://cohub.run/alice/studio/w/pulsewall?x=1 /spaces/${spaceId} https://cohub.live.evil.example/spaces/${spaceId} https://example.com/spaces/${spaceId}`;
  const links = findCohubLinks(pasted, { start: 0, end: pasted.length });
  assert.deepEqual(links.map((match) => match.link), [
    { kind: "space", spaceId },
    { kind: "space", spaceId, sessionId },
    { kind: "app", username: "alice", spaceSlug: "studio", appSlug: "pulsewall", launchSuffix: "?x=1" },
    { kind: "space", spaceId },
  ], "cohub.live, legacy cohub.run, and root-relative links convert; lookalike hosts do not");
  assert.equal(
    replaceCohubLinks(pasted, links, (link) => link.kind === "app" ? "Pulse Wall" : link.sessionId ? null : "Studio"),
    `see @[Studio](cohub://spaces/${spaceId}), https://www.cohub.live/spaces/${spaceId}/sessions/${sessionId}?turn=2 @[Pulse Wall](cohub://apps/alice/studio/pulsewall?x=1) @[Studio](cohub://spaces/${spaceId}) https://cohub.live.evil.example/spaces/${spaceId} https://example.com/spaces/${spaceId}`,
    "unresolved links stay as pasted text",
  );
  assert.deepEqual(findCohubLinks(draft, { start: 0, end: draft.length }), [], "existing mentions are not re-parsed as links");
  assert.deepEqual(findCohubLinks(`https://cohub.live/spaces/${spaceId} tail`, { start: 63, end: 67 }), [], "only links touching the inserted range convert");
  const staleLinks = findCohubLinks(`x https://cohub.live/spaces/${spaceId}`, { start: 0, end: 70 });
  assert.equal(replaceCohubLinks(`xy https://cohub.live/spaces/${spaceId}`, staleLinks, () => "Studio"), `xy https://cohub.live/spaces/${spaceId}`, "late labels skip text that moved");

  assert.deepEqual(extractSpaceMentions(`${mention} ${mention} @[Fork](cohub://spaces/${spaceId}/sessions/${sessionId}) @[Pulse](cohub://apps/alice/studio/pulsewall)`), [
    { type: "space", spaceId, label: "Design Studio", uri: `cohub://spaces/${spaceId}`, href: `/spaces/${spaceId}` },
    { type: "space", spaceId, sessionId, label: "Fork", uri: `cohub://spaces/${spaceId}/sessions/${sessionId}`, href: `/spaces/${spaceId}/sessions/${sessionId}` },
  ], "_meta.mentions matches the web shape: unique Space and Chat mentions, Works stay text-only");
  assert.deepEqual(extractSpaceMentions("plain"), []);

  // Native copy only carries `@Label`; pasting it back restores the mention it came from.
  const known = draftMentions(`${mention} @[Design](cohub://spaces/${sessionId})`);
  const restore = (text, range = { start: 0, end: text.length }) => restoreDraftMentions(text, range, known);
  assert.equal(restore("see @Design Studio."), `see ${mention}.`, "the longest known label wins");
  assert.equal(restore("see @Designer"), "see @Designer", "a label must end at a word boundary");
  assert.equal(restore("see @Design Studios"), `see @[Design](cohub://spaces/${sessionId}) Studios`, "a longer label that does not fit falls back to a shorter one");
  assert.equal(restore("x@Design Studio"), "x@Design Studio", "a label must start at a boundary");
  assert.equal(restore(`${mention}@Design Studio`), `${mention}@Design Studio`, "a mention's closing paren is not a boundary");
  assert.equal(restore("keep @Design Studio, paste @Design Studio", { start: 20, end: 41 }), `keep @Design Studio, paste ${mention}`, "only pasted text is restored");
  assert.equal(mentionDisplayText(restore("see @Design Studio.")), "see @Design Studio.", "restoring never changes what the input shows");

  assert.ok(textMatchScore("test", "tt") > 0, "subsequence matches like the web palette");
  assert.ok(textMatchScore("test", "te") > textMatchScore("sandbox test", "te"));
  const space = (id, name) => ({ id, name, description: null, isPinned: false });
  const remoteHit = (id, title) => ({ spaceId: id, title, description: null, avatarUrl: null, updatedAt: null, score: 1 });
  const mentionIds = (query) => selectSpaceMentionSuggestions({
    recent: [space("beta", "Beta test"), space("current", "Current test")],
    spaces: [space("alpha", "Alpha"), space("beta", "Beta test"), space("tt", "test")],
    remote: [remoteHit("public", "test-public"), remoteHit("tt", "test")],
    query,
    currentSpaceId: "current",
  }).map((item) => item.spaceId);
  assert.deepEqual(mentionIds(""), ["beta", "alpha", "tt"], "empty @ keeps Recent order, then the rest, without the current Space");
  assert.deepEqual(mentionIds("test"), ["tt", "beta", "public"], "typed @ ranks by match quality, then appends server-only Spaces");
  assert.deepEqual(mentionIds("zz"), ["public"], "local Spaces must match the query; server hits are already matched");
}

assert.equal(detectCodeLanguage("src/components/App.tsx"), "tsx");
assert.equal(detectCodeLanguage("docs/readme.md"), "markdown");
assert.equal(detectCodeLanguage("Dockerfile"), "dockerfile");
assert.equal(detectCodeLanguage("Makefile"), null);
assert.equal(resolveCodeLanguage("ts"), "typescript");
assert.equal(resolveCodeLanguage("C++"), "cpp");
assert.equal(resolveCodeLanguage("unknown"), null);

// Streaming code tokenizer: complete lines tokenize once with the carried grammar state, and an
// append only re-tokenizes the trailing partial line.
const streamCalls = [];
const fakeHighlighter = {
  codeToTokens(line, options) {
    streamCalls.push({ line, state: options?.grammarState ?? null });
    return { tokens: [[{ content: line, offset: 0 }]], fg: "#111", bg: "#222", grammarState: `g:${line}` };
  },
};
const streamTokenizer = new StreamingCodeTokenizer(fakeHighlighter, "typescript", "github-dark");
streamTokenizer.enqueue("const a");
streamTokenizer.enqueue(" = 1;\nconst b");
const callsAfterAppend = streamCalls.length;
assert.equal(streamCalls[0].state, null, "the first line starts without grammar state");
assert.equal(streamCalls[2].state, "g:const a = 1;", "complete lines carry the grammar state forward");
streamTokenizer.enqueue(" = 2");
assert.equal(streamCalls.length, callsAfterAppend + 1, "an append only re-tokenizes the trailing line");
assert.deepEqual(streamTokenizer.lines().map((line) => line.map((token) => token.content)), [["const a = 1;"], ["const b = 2"]]);
streamTokenizer.clear();
assert.deepEqual(streamTokenizer.lines(), [], "clear drops buffered token lines");

const textFile = { path: "a.ts", name: "a.ts", size: 10, mimeType: "text/plain", mtimeMs: 1, kind: "text", encoding: "utf-8", content: "const a" };
assert.equal(isEditableTextFile(textFile), true);
assert.equal(isEditableTextFile({ ...textFile, delivery: "url" }), false);
assert.equal(isEditableTextFile({ ...textFile, encoding: "base64" }), false);
assert.equal(isEditableTextFile({ ...textFile, kind: "binary" }), false);
assert.equal(isEditableTextFile({ ...textFile, size: 512 * 1024 + 1 }), false);
assert.equal(classifySaveConflict({ ...textFile, content: "draft" }, "base", "draft"), "already-saved");
assert.equal(classifySaveConflict({ ...textFile, content: "base" }, "base", "draft"), "retry");
assert.equal(classifySaveConflict({ ...textFile, content: "other" }, "base", "draft"), "conflict");
assert.equal(classifySaveConflict(null, "base", "draft"), "conflict");
assert.equal(isFileConflictError({ status: 409 }), true);
assert.equal(isFileConflictError({ code: "file_conflict" }), true);
assert.equal(isFileConflictError(new Error("nope")), false);

const localDbSource = ts.transpileModule(readFileSync(new URL("../src/data/local-db.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cacheModule = {};
let databaseOpens = 0;
let schemaRuns = 0;
let messageCacheResets = 0;
let failCacheWrite = false;
const preparedWrites = [];
const cacheDatabase = {
  execAsync: async (sql) => { if (sql.includes("DELETE FROM messages")) messageCacheResets += 1; else schemaRuns += 1; },
  getFirstAsync: async (sql) => sql.startsWith("PRAGMA") ? { user_version: 0 } : { sequence: 4 },
  withTransactionAsync: async (task) => task(),
  prepareAsync: async (sql) => {
    const write = { sql, rows: [], finalized: false };
    preparedWrites.push(write);
    return {
      executeAsync: async (...params) => {
        if (failCacheWrite) throw new Error("Cache write failed");
        write.rows.push(params);
      },
      finalizeAsync: async () => { write.finalized = true; },
    };
  },
};
new Function("require", "exports", localDbSource)((name) => {
  if (name === "./followup-queue") return { isOptimisticFollowup };
  if (name === "./session-history") return { turnSequenceForMessage };
  assert.equal(name, "expo-sqlite");
  return { openDatabaseAsync: async () => { databaseOpens += 1; return cacheDatabase; } };
}, cacheModule);
assert.deepEqual(await Promise.all([
  cacheModule.loadSessionReadSequence("user-a", "chat"),
  cacheModule.loadSessionReadSequence("user-b", "chat"),
]), [4, 4]);
assert.equal(databaseOpens, 1);
assert.equal(schemaRuns, 1, "concurrent cache readers share completed schema initialization");
assert.equal(messageCacheResets, 1, "rows written under the per-step ordering are dropped once");
{
  const pageLimits = [...readFileSync(new URL("../src/data/context.tsx", import.meta.url), "utf8").matchAll(/turns\.listPaginated\(\{ limit: (\d+) \}\)/g)].map((match) => Number(match[1]));
  assert.ok(pageLimits.length >= 2);
  assert.ok(cacheModule.MESSAGE_CACHE_LIMIT >= 2 * Math.max(...pageLimits), "the cached tail covers the first server page, so that page does not prepend rows above an opened Chat");
}
await cacheModule.saveHome("user-a", {
  spaces: [{ id: "space-a" }, { id: "space-b" }],
  sessions: [{ id: "chat-a", spaceId: "space-a" }, { id: "chat-b", spaceId: "space-b" }],
  forks: [],
});
// A live record carries the session's per-step sequence; the cache orders it by its Turn instead.
const cacheMessages = [
  { id: "step", role: "assistant", sequence: 880, meta: { _mobileLive: true, turnId: "turn-a", turnSequence: 3, messageKind: "assistant_intermediate" }, text: "step" },
  { id: "message-a", role: "assistant", sequence: 900, meta: { _mobileLive: true, turnId: "turn-a", turnSequence: 3 }, text: "answer" },
  { id: "message-b", role: "system", sequence: 4, meta: null, text: "next answer" },
];
await cacheModule.saveMessages("user-a", "chat-a", cacheMessages);
assert.equal(preparedWrites.length, 3, "prepare once per table batch, not once per record");
assert.ok(preparedWrites.every((write) => write.rows.length === 2 && write.finalized));
assert.deepEqual(preparedWrites[0].rows.map((row) => row.slice(0, 3)), [
  ["user-a", "space-a", JSON.stringify({ id: "space-a" })],
  ["user-a", "space-b", JSON.stringify({ id: "space-b" })],
]);
assert.deepEqual(preparedWrites[1].rows.map((row) => row.slice(0, 3)), [["user-a", "chat-a", "space-a"], ["user-a", "chat-b", "space-b"]]);
assert.deepEqual(preparedWrites[2].rows.map((row) => row.slice(0, 4)), [["user-a", "chat-a", "turn-a:assistant", 6], ["user-a", "chat-a", "message-b", 4]], "agent steps are not cached, and a Turn's message is one row in timeline order");
assert.deepEqual(JSON.parse(preparedWrites[2].rows[0][4]), { ...cacheMessages[1], meta: { turnId: "turn-a", turnSequence: 3 } });
assert.equal(cacheMessages[1].meta._mobileLive, true, "persistence must not mutate live records");
assert.equal(preparedWrites[2].rows[0][5], preparedWrites[2].rows[1][5], "keep one retention timestamp per batch");
for (const save of [
  () => cacheModule.saveSpaces("user-a", [{ id: "space-a" }]),
  () => cacheModule.saveSessions("user-a", [{ id: "chat-a", spaceId: "space-a" }]),
  () => cacheModule.saveMessages("user-a", "chat-a", cacheMessages),
]) {
  failCacheWrite = true;
  await assert.rejects(save(), /Cache write failed/);
  assert.equal(preparedWrites.at(-1).finalized, true, "failed writes release their prepared statement");
}
assert.equal(schemaRuns, 1, "writes do not repeat schema setup");

{
  // A fatal error ends the JS runtime; it must reach the log before React Native's handler runs.
  const order = [];
  let handler;
  const flushed = Promise.withResolvers();
  const fakeGlobal = { ErrorUtils: { getGlobalHandler: () => (_error, fatal) => order.push(`native:${fatal}`), setGlobalHandler: (next) => { handler = next; } } };
  loadChromeComponent("../src/data/interaction-trace.ts", "installErrorLogging", {
    globalThis: fakeGlobal, record: (name) => order.push(name), errorFields: () => ({}), FATAL_FLUSH_TIMEOUT_MS: 300,
    flushDebugEventsNow: () => (order.push("flush"), flushed.promise),
  })();
  handler(new Error("boom"), true);
  assert.deepEqual(order, ["error.uncaught", "flush"], "the fatal error is written before the runtime is torn down");
  flushed.resolve();
  await flushSync();
  assert.equal(order.at(-1), "native:true");
  handler(new Error("soft"), false);
  assert.deepEqual(order.slice(-2), ["error.uncaught", "native:false"], "non-fatal errors hand off at once");
}

// LegendList memoizes each row on [item, extraData], unlike FlatList cells that re-rendered
// with renderItem identity. Rows that read state outside `data` must forward it through
// extraData, or in-place updates (thinking options, async counts, turn selection, fork/send
// feedback) never reach mounted rows.
for (const path of [
  "../src/components/ModelSelectorMenu.tsx",
  "../src/components/TurnNavigatorSheet.tsx",
  "../src/components/SpacePanels.tsx",
  "../app/(tabs)/(chats)/index.tsx",
  "../app/(tabs)/(spaces)/spaces.tsx",
  "../app/chat/[sessionId].tsx",
  "../app/space/[spaceId]/files.tsx",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.ok(/<(?:LegendList|FlatList)[\s\S]*?extraData=/.test(source), `${path} must pass extraData so list rows re-render on external state`);
}

assert.equal(runtimeHarnessFromTurn({ meta: { harness: "claude" } }), "claude");
assert.equal(runtimeHarnessFromTurn({ harness: "workbuddy" }), "workbuddy");
assert.equal(runtimeHarnessFromTurn({ meta: { harness: "unknown" } }), "cohub");
const claudeRuntime = { kind: "local", online: true, capabilities: { harnesses: ["claude"], models: [] } };
assert.equal(canUseRuntimeHarness(claudeRuntime, "claude"), true);
assert.equal(canUseRuntimeHarness(claudeRuntime, "workbuddy"), false);
assert.equal(canUseRuntimeHarness({ ...claudeRuntime, online: false }, "claude"), false);
const harnessView = (status) => harnessOptions(status).map(({ harness, availability }) => `${harness}:${availability}`);
const pickerRuntime = { kind: "local", online: true, capabilities: { harnesses: ["codex", "claude"], models: [] } };
assert.deepEqual(harnessView(pickerRuntime), ["cohub:ready", "codex:ready", "claude:ready", "pi:missing", "workbuddy:missing", "cursor:missing"]);
// Cached capabilities of an offline Runtime are not connected harnesses.
assert.deepEqual(harnessView({ ...pickerRuntime, online: false }), ["cohub:ready", "pi:offline", "codex:offline", "claude:offline", "workbuddy:offline", "cursor:offline"]);

console.log("Chat workflow checks passed");
