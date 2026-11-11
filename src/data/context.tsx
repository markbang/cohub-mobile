import type {
  ApprovalMode,
  CohubClient,
  ContentBlock,
  HarnessKind,
  MessageRecord,
  ModelStatusResponse,
  PaletteOverviewResponse,
  SessionListFork,
  SessionRecord,
  SessionTurnIndexItem,
  SessionTurnRecord,
  SpaceRecord,
  SpaceUsageSummary,
  UnauthorizedContext,
  UserSessionListItem,
} from "@neta-art/cohub";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { File as ExpoFile, UploadType } from "expo-file-system";
import { translate } from "@/src/i18n/core";
import { config } from "@/src/config";
import { createMobileClient } from "@/src/data/client";
import { debugAlias, record as recordDebugEvent } from "@/src/data/debug-session";
import { markChatEntry, startChatEntry } from "@/src/data/chat-entry-trace";
import { useSpaceList as useSpaceListQuery, useSpaceListOwner } from "@/src/data/use-space-list";
import { createAppQueryClient, createScopeInvalidator } from "@/src/data/query";
import { applySpaceToSessionSummaries, listAllSpaces, personalSpaceActivity, type SpaceVisit } from "@/src/data/space-list";
import { reconcileSessionHead } from "@/src/data/session-list-sync";
import { emptyRunningSessions, loadRunningSessions, parseCachedRunningSessions, reconcileRunningSessions, runningSessionsForCache, type CachedRunningSessions } from "@/src/data/running-sessions";
import { createSpaceRealtime, type SpaceRealtime } from "@/src/data/space-realtime";
import { spaceRealtimeChange, userSessionRealtimeChange, type SpaceRealtimeEvent } from "@/src/data/space-realtime-events";
import { sessionSourceFilterKeys, sessionSourceFilterOf, type SessionSourceFilter } from "@/src/data/session-source";
import { hydrateBotCache } from "@/src/data/bot-cache";
import { cachedTurnRange } from "@/src/data/bot-mode";
import { cacheRetentionCutoff, loadCacheRetention } from "@/src/data/cache-retention";
import { EMPTY_SESSION_SEEN, type SessionSeenState } from "@/src/data/chat-read-state";
import { useSessionSeenOwner } from "@/src/data/use-session-seen";
import { createStreamBatch } from "@/src/data/chat-rendering";
import { createAttachmentUploads, type AttachmentUploadState, type AttachmentUploads, type UploadTarget, type UploadedAttachment } from "@/src/data/attachment-uploads";
import {
  clearComposerDraft as clearLocalComposerDraft,
  clearComposerDraftIf as clearLocalComposerDraftIf,
  clearUserCache,
  deleteMessages,
  hydrateHome,
  loadComposerDraft as loadLocalComposerDraft,
  loadMessages,
  loadRunningSessionCache,
  loadSessionReadSequence,
  pruneUserCache,
  saveRunningSessionCache,
  saveComposerDraft as saveLocalComposerDraft,
  saveHome,
  saveMessages,
  saveSessionReadSequence,
  saveSessions,
  saveSpaces,
  type ComposerDraftScope,
} from "@/src/data/local-db";
import type {
  AppState,
  AttachmentDraft,
  ChatModelCatalogItem,
  ChatModelSelection,
  ConnectionState,
  NewChatMessageResult,
  SessionView,
  StreamView,
} from "@/src/data/types";
import { hasFinalAssistantForTurn, isActiveTurnStatus, isTerminalTurnStatus, liveStreamStatusFromPatch, pendingStreamForTurn, streamRecoveryFromTail } from "@/src/data/chat-stream";
import { claimedFailedSends, failedSendMessage, isAwaitingSubmit, isFailedSend, isLocalSend, mergeDisplayMessages, placeAwaitingSends, submitAwaitingSend, mergeTurns, mergeTurnWindows, messagesFromTurns, nextTurnSequence, settleInterruptedSends, turnFitsWindow, turnSequenceForMessage, turnWindowsJoin, withFallbackUserContent, type SendDraft } from "@/src/data/session-history";
import { forkSessionTurn } from "@/src/data/session-fork";
import { mergeSessionForks, realtimeSessionFork } from "@/src/data/session-fork-tree";
import { extractSpaceMentions } from "@/src/data/space-mentions";
import { createSendQueue, shouldQueueFollowup, type SendQueue } from "@/src/data/followup-queue";
import { createSessionLifecycle } from "@/src/data/session-lifecycle";
import { getResourcePinState, invalidateResourcePinReads, isResourcePinned, loadResourcePinStates, toggleResourcePin } from "@/src/data/resource-pins";
import { getInstallationId } from "@/src/platform/installation";
import { isAppActive, subscribeAppActive } from "@/src/platform/app-lifecycle";
import { useDeviceDisplayInterrupts, useDeviceRuntimeSession } from "@/src/platform/device-runtime";
import { DEFAULT_SESSION_FILTER_MINUTES, sessionListStatus, latestTurn, loadSessionLatestTurns, reconcileLatestTurn, reconcileTurnStatusPatch, sessionPageState, type LatestSessionTurn, type SessionPageBoundary, type StatusSession } from "@/src/data/session-status";
import { connectionDisplayState, createRealtimeRecovery, createSessionResyncCoordinator, isTransportRecovery, type SessionResyncReason } from "@/src/data/session-reconnect";
import {
  displaySpaceName,
  newId,
  sortByRecent,
} from "@/src/utils";

const HOME_REQUEST_TIMEOUT_MS = 15_000;
// Reconnect `open` and AppState `active` usually fire together; collapse them into one resync.
const SESSION_RESYNC_DEBOUNCE_MS = 250;
// Mirrors the web client: never re-seed the same session's stream more than once per window.
const OUT_OF_SYNC_RESYNC_COOLDOWN_MS = 15_000;
const REALTIME_UNAVAILABLE_GRACE_MS = 5_000;
const RUNNING_RELEASE_GRACE_MS = 2_000;
const REALTIME_RETRY_BASE_MS = 2_000;
const REALTIME_RETRY_MAX_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(translate("data.timeout", { label, seconds: 15 }))), HOME_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 401) return translate("data.signInRejected");
    if (status === 403) return translate("data.noAccess");
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** Mirrors the web composer: Space mentions ride along as structured `_meta` on the text block. */
function mentionTextBlock(blockText: string, draft: string): ContentBlock {
  const mentions = extractSpaceMentions(draft);
  return { type: "text", text: blockText, ...(mentions.length > 0 ? { _meta: { mentions } } : {}) };
}

async function uploadAttachmentFile(
  client: CohubClient,
  target: UploadTarget,
  attachment: AttachmentDraft,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (ratio: number) => void },
): Promise<UploadedAttachment> {
  const file = new ExpoFile(attachment.uri);
  const mimeType = file.type || attachment.mimeType;

  // Use expo-file-system's native upload to avoid React Native bridge recycling issues.
  // SDK's fetch-based upload can fail with "dynamic value has been recycled" on Android.
  const plan = await client.publicAssets.createUpload({
    purpose: "chat_attachment",
    uploadProtocol: "presigned_put_v1",
    spaceId: target.spaceId,
    sessionId: target.sessionId,
    file: {
      size: file.size,
      mimeType,
      filename: attachment.name,
    },
  }, { signal });

  const uploadHeaders: Record<string, string> = {};
  if (plan.asset.uploadHeaders) {
    for (const [key, value] of Object.entries(plan.asset.uploadHeaders)) {
      if (value != null) uploadHeaders[key] = String(value);
    }
  }

  // `File.upload` defaults to POST; the presigned URL is signed for the method the plan
  // reports (PUT), and a mismatched method makes R2 reject the signature with 403.
  const uploadStarted = performance.now();
  recordDebugEvent("net.upload", { kind: "attachment", bytes: file.size, mimeType, method: plan.asset.uploadMethod });
  try {
    const uploadResult = await file.upload(plan.asset.uploadUrl, {
      httpMethod: plan.asset.uploadMethod,
      uploadType: UploadType.BINARY_CONTENT,
      headers: uploadHeaders,
      signal,
      onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0),
    });
    recordDebugEvent("net.upload.response", { kind: "attachment", status: uploadResult.status, durationMs: Math.round(performance.now() - uploadStarted) });
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`File upload failed: HTTP ${uploadResult.status}`);
    }
  } catch (error) {
    recordDebugEvent("net.upload.error", { kind: "attachment", durationMs: Math.round(performance.now() - uploadStarted), message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  return { publicUrl: plan.asset.publicUrl, mimeType };
}

/** A failed send that was deleted, retried, or claimed by the Turn the server did accept no longer holds the sends behind it. */
function releaseSettledFailures(queue: SendQueue, state: AppState) {
  for (const [sessionId, clientMessageId] of queue.blocked()) {
    const messages = state.sessionViews[sessionId]?.messages ?? [];
    if (!messages.some((message) => isFailedSend(message) && message.meta?.clientMessageId === clientMessageId)) queue.release(sessionId, clientMessageId);
  }
}

/** The local bubble of a send, drawn the moment the user sends; the accepted Turn replaces it by `clientMessageId`. */
function optimisticSend(input: { sessionId: string; clientMessageId: string; text: string; attachments: AttachmentDraft[]; model: ChatModelSelection | null; harness: HarnessKind | null; authorUuid: string; turnSequence: number; meta?: Record<string, unknown> }): MessageRecord {
  const { text, attachments, model, harness } = input;
  return {
    id: `local-${input.clientMessageId}`,
    sessionId: input.sessionId,
    role: "user",
    content: [
      ...(text ? [mentionTextBlock(text, text)] : []),
      ...attachments.filter((item) => item.mimeType.startsWith("image/")).map((item) => ({
        type: "image" as const,
        source: { type: "url" as const, url: item.uri },
        _meta: { filename: item.name, mediaType: item.mimeType, size: item.size },
      })),
      ...attachments.filter((item) => !item.mimeType.startsWith("image/")).map((item) => ({ type: "text" as const, text: `Attached file: ${item.name}` })),
    ],
    text: text || attachments.map((item) => item.name).join(", "),
    sequence: input.turnSequence * 2 - 1,
    provider: model?.provider ?? null,
    model: model?.id ?? null,
    stopReason: null,
    errorMessage: null,
    usage: null,
    meta: {
      optimistic: true,
      ...input.meta,
      clientMessageId: input.clientMessageId,
      turnSequence: input.turnSequence,
      sendDraft: { text, attachments, model, harness } satisfies SendDraft,
      ...(harness ? { harness } : {}),
      ...(model?.thinkingLevel ? { requestedThinkingLevel: model.thinkingLevel } : {}),
    },
    authorUuid: input.authorUuid,
    authorProfile: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    createdAt: new Date().toISOString(),
  };
}

/** The store exists whenever a client does, and every send already requires one. */
function claimAttachmentUpload(uploads: AttachmentUploads | null, target: UploadTarget, attachment: AttachmentDraft) {
  if (!uploads) throw new Error(translate("data.stillConnecting"));
  return uploads.claim(target, attachment);
}

async function buildPromptContent(
  text: string,
  attachments: AttachmentDraft[],
  resolveUpload: (attachment: AttachmentDraft) => Promise<UploadedAttachment>,
) {
  let promptText = text;
  const content: ContentBlock[] = [];
  const imageBlocks: ContentBlock[] = [];
  // Uploads usually started when each file was attached; any still running finish in parallel.
  const uploads = await Promise.all(attachments.map(resolveUpload));
  attachments.forEach((attachment, index) => {
    const uploaded = uploads[index]!;
    if (uploaded.mimeType.startsWith("image/")) {
      imageBlocks.push({
        type: "image",
        source: { type: "url", url: uploaded.publicUrl },
        _meta: {
          filename: attachment.name,
          mediaType: uploaded.mimeType,
          size: attachment.size,
        },
      });
    } else {
      promptText = [
        promptText,
        `Attached file: ${attachment.name}\n${uploaded.publicUrl}`,
      ].filter(Boolean).join("\n\n");
    }
  });
  if (promptText) content.push(mentionTextBlock(promptText, text));
  content.push(...imageBlocks);
  return content;
}

function withAccessTokenTimeout(
  promise: Promise<string | null>,
  timeoutMs = 10_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const emptyView = (): SessionView => ({
  space: null,
  session: null,
  messages: [],
  turns: [],
  historyLoaded: false,
  turnIndex: [],
  turnIndexLoading: false,
  hasMoreOlder: false,
  hasMoreNewer: false,
  loadingOlder: false,
  loadingNewer: false,
  oldestCursor: null,
  newestCursor: null,
  windowGeneration: 0,
  loading: false,
  refreshing: false,
  catchingUp: false,
  error: null,
  stream: null,
});

const initialState: AppState = {
  booting: true,
  refreshing: false,
  error: null,
  spacesError: null,
  sessionsError: null,
  activityLoading: false,
  activityError: null,
  lastSyncedAt: null,
  spaces: [],
  sessions: [],
  sessionsHasMore: false,
  sessionsCursor: null,
  sessionsPageBoundary: null,
  sessionsPagesLoaded: 0,
  sessionsLoadingMore: false,
  sessionForks: {},
  sessionLatestTurns: {},
  sessionTurnStatuses: {},
  sessionStatusRequests: 0,
  sessionStatusError: null,
  sessionViews: {},
  runningSessions: {},
  realtimeError: null,
  usage: null,
};

type Action =
  | { type: "hydrate"; spaces: SpaceRecord[]; sessions: UserSessionListItem[]; forks: SessionListFork[] }
  | { type: "home-start"; silent?: boolean }
  | { type: "home-success"; spaces: SpaceRecord[]; sessions: UserSessionListItem[]; sessionsHasMore?: boolean; sessionsCursor?: string | null; sessionsPageBoundary: SessionPageBoundary | null; spacesError?: string; sessionsError?: string; silent?: boolean; requestStartedAt: number; forks: SessionListFork[] }
  | { type: "sessions-head-success"; sessions: UserSessionListItem[]; forks: SessionListFork[]; hasMore: boolean; cursor: string | null; boundary: SessionPageBoundary | null; requestStartedAt: number }
  | { type: "sessions-head-error"; message: string }
  | { type: "running-start"; source: SessionSourceFilter }
  | { type: "running-success"; source: SessionSourceFilter; sessions: UserSessionListItem[]; changedSessionIds: string[]; complete?: boolean }
  | { type: "running-end"; source: SessionSourceFilter; error?: string }
  | { type: "running-cached"; source: SessionSourceFilter; cache: CachedRunningSessions }
  | { type: "realtime-error"; message: string | null }
  | { type: "session-realtime-turn"; sessionId: string; turn: Partial<LatestSessionTurn> }
  | { type: "running-session-found"; session: UserSessionListItem }
  | { type: "session-realtime-meta"; sessionId: string; session: Partial<SessionRecord> }
  | { type: "spaces-sync"; spaces?: SpaceRecord[]; error?: string }
  | { type: "sessions-more-start" }
  | { type: "sessions-more-success"; sessions: UserSessionListItem[]; forks: SessionListFork[]; hasMore: boolean; cursor: string | null; boundary: SessionPageBoundary | null }
  | { type: "sessions-more-error"; message: string }
  | { type: "session-status-start"; silent?: boolean }
  | { type: "session-status-reset" }
  | { type: "session-status-end"; error?: string | null; silent?: boolean }
  | { type: "session-latest-turn"; sessionId: string; turn: LatestSessionTurn | null }
  | { type: "home-error"; message: string; silent?: boolean }
  | { type: "usage-start"; silent?: boolean }
  | { type: "usage"; usage: SpaceUsageSummary }
  | { type: "usage-error"; message: string; silent?: boolean }
  | { type: "session-start"; sessionId: string; space?: SpaceRecord | null; session?: SessionRecord | null }
  | { type: "session-meta"; sessionId: string; space?: SpaceRecord | null; session: SessionRecord }
  | { type: "session-cache"; sessionId: string; messages: MessageRecord[] }
  | { type: "session-success"; sessionId: string; space: SpaceRecord; session: SessionRecord; messages: MessageRecord[]; turns: SessionTurnRecord[]; hasMoreOlder: boolean; hasMoreNewer?: boolean; oldestCursor?: number | null; newestCursor?: number | null }
  | { type: "session-error"; sessionId: string; message: string }
  | { type: "session-refresh-start"; sessionId: string; silent?: boolean; catchUp?: boolean }
  | { type: "session-refresh-end"; sessionId: string; silent?: boolean; session?: SessionRecord; messages?: MessageRecord[]; turns?: SessionTurnRecord[]; hasMoreOlder?: boolean; hasMoreNewer?: boolean; oldestCursor?: number | null; newestCursor?: number | null; error?: string }
  | { type: "session-page-start"; sessionId: string; direction: "older" | "newer" }
  | { type: "session-page-success"; sessionId: string; session?: SessionRecord | null; turns: SessionTurnRecord[]; hasMore: boolean; direction: "older" | "newer" }
  | { type: "session-page-error"; sessionId: string; message: string }
  | { type: "session-page-end"; sessionId: string; direction: "older" | "newer" }
  | { type: "session-window-success"; sessionId: string; session?: SessionRecord | null; turns: SessionTurnRecord[]; hasMoreOlder: boolean; hasMoreNewer: boolean; oldestCursor?: number | null; newestCursor?: number | null; newest?: boolean }
  | { type: "session-release"; sessionId: string }
  | { type: "turn-upsert"; sessionId: string; session?: SessionRecord | null; turn: SessionTurnRecord }
  | { type: "turn-patch"; sessionId: string; turn: Partial<SessionTurnRecord> }
  | { type: "turn-index-start"; sessionId: string }
  | { type: "turn-index"; sessionId: string; turnIndex: SessionTurnIndexItem[] }
  | { type: "turn-index-end"; sessionId: string }
  | { type: "message-add"; sessionId: string; message: MessageRecord }
  | { type: "message-optimistic"; sessionId: string; message: MessageRecord }
  | { type: "send-submit"; sessionId: string; clientMessageId: string; turnSequence: number; queuedFollowup: boolean }
  | { type: "send-accepted"; sessionId: string; clientMessageId: string }
  | { type: "send-failed"; sessionId: string; clientMessageId: string; message: string }
  | { type: "send-discard"; sessionId: string; messageId: string }
  | { type: "stream-state"; sessionId: string; stream: StreamView }
  | { type: "stream-lifecycle"; sessionId: string; provider: string | null; model: string | null }
  | { type: "stream-clear"; sessionId: string }
  | { type: "session-upsert"; session: UserSessionListItem }
  | { type: "session-forks"; forks: SessionListFork[] }
  | { type: "space-upsert"; space: SpaceRecord };

function isLiveMessage(message: MessageRecord) {
  return message.meta?.optimistic === true || message.meta?._mobileLive === true || isFailedSend(message);
}

function mergeMessages(messages: MessageRecord[], incoming: MessageRecord) {
  const clientMessageId = incoming.meta?.clientMessageId;
  const optimisticId = clientMessageId
    ? messages.find((message) => message.meta?.clientMessageId === clientMessageId)?.id
    : null;
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (optimisticId && optimisticId !== incoming.id) byId.delete(optimisticId);
  const previous = byId.get(incoming.id);
  if (!previous) {
    byId.set(incoming.id, incoming);
  } else {
    const meta = incoming.meta ? { ...(previous.meta ?? {}), ...incoming.meta } : { ...(previous.meta ?? {}) };
    if (incoming.meta?.optimistic !== true) delete meta.optimistic;
    byId.set(incoming.id, { ...previous, ...incoming, meta });
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

function turnClientMessageId(turn: { meta?: Record<string, unknown> | null }) {
  const value = turn.meta?.clientMessageId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mergeTurnRecords(existing: SessionTurnRecord[], incoming: SessionTurnRecord[]) {
  const byId = new Map(existing.map((turn) => [turn.id, turn]));
  for (const turn of incoming) {
    const clientMessageId = turnClientMessageId(turn);
    const previous = byId.get(turn.id) ?? (clientMessageId ? [...byId.values()].find((item) => turnClientMessageId(item) === clientMessageId) : undefined);
    if (previous && previous.id !== turn.id) byId.delete(previous.id);
    byId.set(turn.id, previous ? { ...previous, ...turn, meta: turn.meta ? { ...(previous.meta ?? {}), ...turn.meta } : previous.meta } : turn);
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

function patchTurnRecords(existing: SessionTurnRecord[], patch: Partial<SessionTurnRecord>) {
  const clientMessageId = turnClientMessageId(patch);
  const index = existing.findIndex((turn) => turn.id === patch.id || (clientMessageId !== null && turnClientMessageId(turn) === clientMessageId));
  if (index < 0) return existing;
  const previous = existing[index];
  if (!previous) return existing;
  const next = [...existing];
  next[index] = { ...previous, ...patch, meta: patch.meta ? { ...(previous.meta ?? {}), ...patch.meta } : previous.meta };
  return next.sort((a, b) => a.sequence - b.sequence);
}

function updateLatestTurn(state: AppState, sessionId: string, turn: LatestSessionTurn | null): AppState {
  const latest = reconcileLatestTurn(state.sessionLatestTurns[sessionId], turn);
  const status = turn ? reconcileLatestTurn(state.sessionTurnStatuses[turn.id], turn) : null;
  const latestKept = state.sessionLatestTurns[sessionId] === latest;
  const statusKept = !turn || state.sessionTurnStatuses[turn.id] === status;
  // An unchanged Turn returns the same state, so the Chats list does not re-render for it.
  if (latestKept && statusKept) return state;
  return {
    ...state,
    sessionLatestTurns: latestKept ? state.sessionLatestTurns : { ...state.sessionLatestTurns, [sessionId]: latest },
    sessionTurnStatuses: statusKept || !turn ? state.sessionTurnStatuses : { ...state.sessionTurnStatuses, [turn.id]: status },
  };
}

function updateView(state: AppState, sessionId: string, update: Partial<SessionView>) {
  const current = state.sessionViews[sessionId] ?? emptyView();
  const next = { ...current, ...update };
  if (update.messages || update.turns) next.messages = placeAwaitingSends(next.messages, next.turns);
  return {
    ...state,
    sessionViews: {
      ...state.sessionViews,
      [sessionId]: next,
    },
  };
}

function preferNewerSession(current: SessionRecord | null | undefined, incoming: SessionRecord) {
  if (!current) return incoming;
  const currentTime = Date.parse(current.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime) && currentTime > incomingTime) return current;
  // Turn pages return the Session without resolving its archive; the last known state stands until one does.
  return incoming.archivedAt === undefined && current.archivedAt !== undefined ? { ...incoming, archivedAt: current.archivedAt } : incoming;
}

function mergeSessionItem(current: UserSessionListItem | undefined, incoming: UserSessionListItem) {
  if (!current) return incoming;
  const preferred = preferNewerSession(current, incoming);
  return preferred === current
    ? { ...current, space: current.space ?? incoming.space }
    : { ...current, ...incoming, space: incoming.space ?? current.space };
}

/** Realtime keeps Running membership current between account scans; settled Chats leave every bucket. */
function placeRunningSession(state: AppState, sessionId: string, found?: UserSessionListItem): AppState["runningSessions"] {
  const buckets = Object.values(state.runningSessions);
  const session = found
    ?? state.sessions.find((item) => item.id === sessionId)
    ?? buckets.flatMap((query) => query?.sessions ?? []).find((item) => item.id === sessionId);
  if (!session) return state.runningSessions;
  const running = sessionListStatus(session, state.sessionLatestTurns[sessionId], state.sessionTurnStatuses) === "running";
  const source = sessionSourceFilterOf(session.source);
  const runningSessions = { ...state.runningSessions };
  let changed = false;
  for (const filter of ["all", "web", "other"] as const) {
    const current = runningSessions[filter];
    // Source buckets exist only after their own scan; a live row must not imply coverage.
    if (!current && filter !== "all") continue;
    const query = current ?? emptyRunningSessions;
    const existing = query.sessions.find((item) => item.id === sessionId);
    const belongs = running && (filter === "all" || filter === source);
    if (!belongs && !existing) continue;
    if (belongs && existing && !found) continue;
    const others = query.sessions.filter((item) => item.id !== sessionId);
    runningSessions[filter] = { ...query, sessions: belongs ? sortByRecent([...others, existing ? mergeSessionItem(existing, session) : session]) : others };
    changed = true;
  }
  return changed ? runningSessions : state.runningSessions;
}

function isListedSession(session: Pick<SessionRecord, "archivedAt">) {
  return !session.archivedAt;
}

function preserveSpacePin(current: SpaceRecord | undefined, incoming: SpaceRecord) {
  return incoming.isPinned === undefined && current?.isPinned !== undefined
    ? { ...incoming, isPinned: current.isPinned }
    : incoming;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        spaces: sortByRecent(action.spaces),
        sessions: sortByRecent(action.sessions.filter(isListedSession)),
        sessionForks: mergeSessionForks(state.sessionForks, action.forks),
        booting: false,
      };
    case "home-start":
      return { ...state, refreshing: action.silent ? state.refreshing : true, sessionsLoadingMore: false, error: action.silent ? state.error : null, spacesError: action.silent ? state.spacesError : null, sessionsError: action.silent ? state.sessionsError : null, activityLoading: action.silent ? state.activityLoading : true, activityError: action.silent ? state.activityError : null };
    case "home-success": {
      const existingSpaces = new Map(state.spaces.map((space) => [space.id, space]));
      const refreshedSpaces = action.spaces.map((space) => preserveSpacePin(existingSpaces.get(space.id), space));
      const existingSessions = new Map(state.sessions.map((session) => [session.id, session]));
      const refreshedSessions = action.sessions.map((session) => mergeSessionItem(existingSessions.get(session.id), session));
      return {
        ...state,
        booting: false,
        refreshing: false,
        error: null,
        spacesError: action.spacesError ?? null,
        sessionsError: action.sessionsError ?? null,
        lastSyncedAt: new Date().toISOString(),
        spaces: sortByRecent(refreshedSpaces),
        sessions: sortByRecent(action.silent ? reconcileSessionHead(state.sessions, refreshedSessions, action.sessionsHasMore === true, action.requestStartedAt) : refreshedSessions),
        sessionsHasMore: action.silent && state.sessionsPagesLoaded > 1 && action.sessionsHasMore ? state.sessionsHasMore : action.sessionsHasMore ?? false,
        sessionsCursor: action.silent && state.sessionsPagesLoaded > 1 && action.sessionsHasMore ? state.sessionsCursor : action.sessionsCursor ?? null,
        sessionsPageBoundary: action.silent && state.sessionsPagesLoaded > 1 && action.sessionsHasMore ? state.sessionsPageBoundary : action.sessionsPageBoundary,
        sessionsPagesLoaded: action.silent && action.sessionsHasMore ? Math.max(1, state.sessionsPagesLoaded) : 1,
        sessionsLoadingMore: false,
        sessionForks: mergeSessionForks(state.sessionForks, action.forks),
      };
    }
    case "sessions-head-success": {
      const keepTail = state.sessionsPagesLoaded > 1 && action.hasMore;
      return {
        ...state,
        sessions: sortByRecent(reconcileSessionHead(state.sessions, action.sessions, action.hasMore, action.requestStartedAt)),
        sessionsHasMore: keepTail ? state.sessionsHasMore : action.hasMore,
        sessionsCursor: keepTail ? state.sessionsCursor : action.cursor,
        sessionsPageBoundary: keepTail ? state.sessionsPageBoundary : action.boundary,
        sessionsPagesLoaded: keepTail ? state.sessionsPagesLoaded : 1,
        sessionForks: mergeSessionForks(state.sessionForks, action.forks),
        sessionsError: null,
        error: null,
        lastSyncedAt: new Date().toISOString(),
      };
    }
    case "running-start": {
      const current = state.runningSessions[action.source] ?? emptyRunningSessions;
      return { ...state, runningSessions: { ...state.runningSessions, [action.source]: { ...current, loading: true } } };
    }
    case "running-success": {
      const previous = state.runningSessions[action.source] ?? emptyRunningSessions;
      const changed = new Set(action.changedSessionIds);
      const previousById = new Map(previous.sessions.map((session) => [session.id, session]));
      const incomingIds = new Set(action.sessions.map((session) => session.id));
      const complete = action.complete !== false;
      const sessions = [
        ...action.sessions.map((session) => changed.has(session.id) ? previousById.get(session.id) ?? session : session).filter((session) => session.activeTurn !== null),
        ...previous.sessions.filter((session) => !incomingIds.has(session.id) && (!complete || changed.has(session.id))),
      ];
      return { ...state, runningSessions: { ...state.runningSessions, [action.source]: { sessions: sortByRecent(sessions), loading: !complete, loaded: complete || previous.loaded, error: null } } };
    }
    case "running-end": {
      const current = state.runningSessions[action.source] ?? emptyRunningSessions;
      return { ...state, runningSessions: { ...state.runningSessions, [action.source]: { ...current, loading: false, error: action.error ?? current.error } } };
    }
    case "running-cached": {
      const current = state.runningSessions[action.source] ?? emptyRunningSessions;
      // A live scan always wins; the cache only fills a bucket that has not painted rows yet.
      if (current.loaded || current.loading || current.sessions.length > 0) return state;
      const sessions = reconcileRunningSessions(current.sessions, action.cache.sessions);
      return { ...state, runningSessions: { ...state.runningSessions, [action.source]: { ...current, sessions: sortByRecent(action.source === "all" ? sessions : sessions.filter((session) => sessionSourceFilterOf(session.source) === action.source)), loaded: true } } };
    }
    case "realtime-error":
      recordDebugEvent("realtime.error", { message: action.message });
      return { ...state, realtimeError: action.message };
    case "session-realtime-turn": {
      const known = action.turn.id ? state.sessionTurnStatuses[action.turn.id] : null;
      const turn = reconcileTurnStatusPatch(known ?? state.sessionLatestTurns[action.sessionId], action.turn);
      const next = updateLatestTurn(state, action.sessionId, turn);
      if (!turn) return next;
      const runningSessions = placeRunningSession(next, action.sessionId);
      return runningSessions === next.runningSessions ? next : { ...next, runningSessions };
    }
    case "running-session-found": {
      const runningSessions = placeRunningSession(state, action.session.id, action.session);
      return runningSessions === state.runningSessions ? state : { ...state, runningSessions };
    }
    case "session-realtime-meta": {
      const patch = (session: UserSessionListItem) => session.id === action.sessionId ? { ...session, ...preferNewerSession(session, { ...session, ...action.session }) } : session;
      const runningSessions = { ...state.runningSessions };
      for (const source of ["all", "web", "other"] as const) {
        const current = runningSessions[source];
        if (current) runningSessions[source] = { ...current, sessions: sortByRecent(current.sessions.map(patch).filter(isListedSession)) };
      }
      return { ...state, sessions: sortByRecent(state.sessions.map(patch).filter(isListedSession)), runningSessions };
    }
    case "sessions-head-error":
      return { ...state, sessionsError: action.message };
    case "spaces-sync":
      return { ...state, spacesError: action.error ?? null, spaces: action.spaces ? sortByRecent(action.spaces.map((space) => preserveSpacePin(state.spaces.find((current) => current.id === space.id), space))) : state.spaces };
    case "sessions-more-start":
      return { ...state, sessionsLoadingMore: true, sessionsError: null };
    case "sessions-more-success": {
      if (state.sessionsPagesLoaded === 1 && !state.sessionsHasMore) return { ...state, sessionsLoadingMore: false };
      const incomingById = new Map(action.sessions.map((session) => [session.id, session]));
      const existingIds = new Set(state.sessions.map((session) => session.id));
      const merged = [
        ...state.sessions.map((session) => {
          const incoming = incomingById.get(session.id);
          return incoming ? mergeSessionItem(session, incoming) : session;
        }),
        ...action.sessions.filter((session) => !existingIds.has(session.id)),
      ];
      return { ...state, sessionsLoadingMore: false, sessions: sortByRecent(merged), sessionsHasMore: action.hasMore, sessionsCursor: action.cursor, sessionsPageBoundary: action.boundary, sessionsPagesLoaded: state.sessionsPagesLoaded + 1, sessionForks: mergeSessionForks(state.sessionForks, action.forks) };
    }
    case "sessions-more-error":
      return { ...state, sessionsLoadingMore: false, sessionsError: action.message };
    case "session-status-start":
      return { ...state, sessionStatusRequests: state.sessionStatusRequests + (action.silent ? 0 : 1), sessionStatusError: action.silent ? state.sessionStatusError : state.sessionStatusRequests === 0 ? null : state.sessionStatusError };
    case "session-status-reset":
      return { ...state, sessionLatestTurns: {}, sessionTurnStatuses: {}, sessionStatusRequests: 0, sessionStatusError: null };
    case "session-status-end":
      return { ...state, sessionStatusRequests: state.sessionStatusRequests - (action.silent ? 0 : 1), sessionStatusError: action.silent ? state.sessionStatusError : action.error ?? null };
    case "session-latest-turn":
      return updateLatestTurn(state, action.sessionId, action.turn);
    case "home-error":
      return action.silent ? { ...state, refreshing: false } : { ...state, booting: false, refreshing: false, activityLoading: false, error: action.message, spacesError: action.message, sessionsError: action.message, activityError: action.message };
    case "usage-start":
      return { ...state, activityLoading: action.silent ? state.activityLoading : true, activityError: action.silent ? state.activityError : null };
    case "usage":
      return { ...state, activityLoading: false, activityError: null, usage: action.usage };
    case "usage-error":
      return action.silent ? { ...state, activityLoading: false } : { ...state, activityLoading: false, activityError: action.message };
    case "session-start":
      return updateView(state, action.sessionId, {
        loading: true,
        catchingUp: false,
        historyLoaded: false,
        loadingOlder: false,
        loadingNewer: false,
        error: null,
        space: action.space ?? state.sessionViews[action.sessionId]?.space ?? null,
        session: action.session ?? state.sessionViews[action.sessionId]?.session ?? null,
      });
    case "session-meta":
      return updateView(state, action.sessionId, {
        space: action.space ?? state.sessionViews[action.sessionId]?.space ?? null,
        session: action.session,
      });
    case "session-cache":
      // Cached Turn rows carry their clientMessageId, so a send that was accepted before the
      // process died does not show twice beside its settled failed row.
      // Sends made since the open began are this process's own; their cached copies are older.
      {
        const local = (state.sessionViews[action.sessionId]?.messages ?? []).filter((message) => isLocalSend(message) || isFailedSend(message));
        const localIds = new Set(local.map((message) => message.meta?.clientMessageId));
        const cached = action.messages.filter((message) => typeof message.meta?.clientMessageId !== "string" || !localIds.has(message.meta.clientMessageId));
        return updateView(state, action.sessionId, { messages: mergeDisplayMessages(cached, local), loading: false, catchingUp: true });
      }
    case "session-success": {
      const session = preferNewerSession(
        state.sessionViews[action.sessionId]?.session,
        action.session,
      );
      return updateView(
        updateLatestTurn(
          {
            ...state,
            sessions: state.sessions.map((item) =>
              item.id === session.id
                ? { ...mergeSessionItem(item, session as UserSessionListItem), space: item.space ?? { id: action.space.id, name: displaySpaceName(action.space), slug: action.space.slug, publicProfile: action.space.publicProfile ?? null } }
                : item,
            ),
          },
          action.sessionId,
          latestTurn(action.turns),
        ),
        action.sessionId,
        {
          loading: false,
          refreshing: false,
          catchingUp: false,
          error: null,
          space: action.space,
          session,
          messages: action.messages,
          turns: action.turns,
          historyLoaded: true,
          hasMoreOlder: action.hasMoreOlder,
          hasMoreNewer: action.hasMoreNewer ?? false,
          loadingOlder: false,
          loadingNewer: false,
          oldestCursor: action.oldestCursor ?? action.turns[0]?.sequence ?? null,
          newestCursor: action.newestCursor ?? action.turns.at(-1)?.sequence ?? null,
        },
      );
    }
    case "session-error":
      return updateView(state, action.sessionId, { loading: false, refreshing: false, catchingUp: false, error: action.message });
    case "session-refresh-start":
      return updateView(state, action.sessionId, { ...(action.silent ? {} : { refreshing: true }), ...(action.catchUp ? { catchingUp: true } : {}), error: null });
    case "session-refresh-end": {
      const current = state.sessionViews[action.sessionId];
      const session = action.session && current?.session
        ? preferNewerSession(current.session, action.session)
        : action.session;
      const tail = action.turns ? latestTurn(action.turns) : null;
      // After a gap the local stream can be stale either way: the turn finished
      // while we were away, or it is still running and the overlay was lost.
      const streamRecovery = streamRecoveryFromTail({
        stream: current?.stream,
        tail,
        turns: action.turns ?? current?.turns ?? [],
        messages: action.messages ?? current?.messages ?? [],
      });
      const replaced = Boolean(action.turns && current && !turnWindowsJoin(current.turns, action.turns));
      return updateView(action.turns ? updateLatestTurn(state, action.sessionId, tail) : state, action.sessionId, {
        ...(action.silent ? {} : { refreshing: false }),
        catchingUp: false,
        ...(session ? { session } : {}),
        ...(action.messages ? { messages: action.messages } : {}),
        ...(action.turns ? { turns: action.turns, historyLoaded: true } : {}),
        ...(replaced && current ? { windowGeneration: current.windowGeneration + 1 } : {}),
        ...(streamRecovery === "clear" ? { stream: null } : streamRecovery === "pending" && tail ? { stream: pendingStreamForTurn(tail.id) } : {}),
        ...(action.hasMoreOlder !== undefined ? { hasMoreOlder: action.hasMoreOlder } : {}),
        ...(action.hasMoreNewer !== undefined ? { hasMoreNewer: action.hasMoreNewer } : {}),
        ...(action.oldestCursor !== undefined ? { oldestCursor: action.oldestCursor } : {}),
        ...(action.newestCursor !== undefined ? { newestCursor: action.newestCursor } : {}),
        ...(action.error ? { error: action.error } : {}),
      });
    }
    case "session-page-start":
      return updateView(state, action.sessionId, action.direction === "older" ? { loadingOlder: true, error: null } : { loadingNewer: true, error: null });
    case "session-page-success": {
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      const turns = mergeTurns(current.turns, action.turns);
      const session = action.session && current.session ? preferNewerSession(current.session, action.session) : action.session;
      return updateView(updateLatestTurn(state, action.sessionId, latestTurn(turns)), action.sessionId, {
        error: null,
        ...(session ? { session } : {}),
        turns,
        historyLoaded: true,
        messages: mergeDisplayMessages(messagesFromTurns(turns), current.messages),
        hasMoreOlder: action.direction === "older" ? action.hasMore : current.hasMoreOlder,
        hasMoreNewer: action.direction === "newer" ? action.hasMore : current.hasMoreNewer,
        loadingOlder: action.direction === "older" ? false : current.loadingOlder,
        loadingNewer: action.direction === "newer" ? false : current.loadingNewer,
        oldestCursor: turns[0]?.sequence ?? current.oldestCursor,
        newestCursor: turns.at(-1)?.sequence ?? current.newestCursor,
      });
    }
    case "session-page-error":
      return updateView(state, action.sessionId, { loadingOlder: false, loadingNewer: false, error: action.message });
    case "session-page-end":
      return updateView(state, action.sessionId, action.direction === "older" ? { loadingOlder: false } : { loadingNewer: false });
    case "session-window-success": {
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      const incoming = { turns: action.turns, hasMoreOlder: action.hasMoreOlder, hasMoreNewer: action.hasMoreNewer };
      const merged = mergeTurnWindows(current, incoming);
      const { turns, hasMoreOlder, hasMoreNewer } = merged ?? incoming;
      const session = action.session && current.session ? preferNewerSession(current.session, action.session) : action.session;
      return updateView(updateLatestTurn(state, action.sessionId, latestTurn(turns)), action.sessionId, {
        error: null,
        ...(session ? { session } : {}),
        turns,
        historyLoaded: true,
        messages: mergeDisplayMessages(messagesFromTurns(turns), current.messages.filter(isLiveMessage)),
        hasMoreOlder,
        hasMoreNewer,
        loadingOlder: false,
        loadingNewer: false,
        oldestCursor: turns[0]?.sequence ?? action.oldestCursor ?? null,
        newestCursor: turns.at(-1)?.sequence ?? action.newestCursor ?? null,
        ...(action.newest && !merged ? { windowGeneration: current.windowGeneration + 1 } : {}),
      });
    }
    case "session-release": {
      const current = state.sessionViews[action.sessionId];
      // Release retires the open token, so a refresh still in flight never dispatches its end; a
      // non-silent one's `refreshing` would outlive it and the next open's silent refresh never clears it.
      // A window paged away from the tail (a turn jump) must not be what the next open lands on.
      if (!current?.hasMoreNewer) return current?.refreshing ? updateView(state, action.sessionId, { refreshing: false }) : state;
      return updateView(state, action.sessionId, {
        refreshing: false,
        // Only the send flow removes its rows; a queued send outlives the window it was made in.
        messages: current.messages.filter((message) => isLocalSend(message) || isFailedSend(message)),
        turns: [],
        historyLoaded: false,
        hasMoreOlder: false,
        hasMoreNewer: false,
        loadingOlder: false,
        loadingNewer: false,
        oldestCursor: null,
        newestCursor: null,
      });
    }
    case "turn-upsert": {
      recordDebugEvent("chat.turn.upsert", { sequence: action.turn.sequence, status: action.turn.status, intent: action.turn.intent ?? null, clientMessageIdPresent: typeof turnClientMessageId(action.turn) === "string" });
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      const session = action.session
        ? current.session
          ? preferNewerSession(current.session, action.session)
          : action.session
        : current.session;
      const sessions = action.session
        ? state.sessions.map((item) => item.id === action.session?.id ? mergeSessionItem(item, { ...action.session, space: item.space }) : item)
        : state.sessions;
      const live = {
        ...(isTerminalTurnStatus(action.turn.status) && (current.stream?.turnId === action.turn.id || !current.stream) ? { stream: null } : {}),
        ...(isActiveTurnStatus(action.turn.status) && !current.stream ? { stream: pendingStreamForTurn(action.turn.id) } : {}),
      };
      // Appending a Turn past a detached window's edge would hide the Turns between; its page brings it.
      if (!turnFitsWindow(current, action.turn.sequence)) {
        return updateView(updateLatestTurn({ ...state, sessions: sortByRecent(sessions) }, action.sessionId, action.turn), action.sessionId, { ...(session ? { session } : {}), ...live });
      }
      const turns = mergeTurnRecords(current.turns, [action.turn]);
      const clientMessageId = turnClientMessageId(action.turn);
      const projected = messagesFromTurns(turns);
      const hasProjectedUser = projected.some((message) => message.role === "user" && (turnSequenceForMessage(message) === action.turn.sequence || message.meta?.turnId === action.turn.id));
      const liveMessages = current.messages.filter((message) => {
        if (!isLiveMessage(message)) return false;
        if (clientMessageId && message.meta?.clientMessageId === clientMessageId && hasProjectedUser) return false;
        if (isAwaitingSubmit(message)) return true;
        return !(hasProjectedUser && message.meta?.optimistic === true && message.role === "user" && turnSequenceForMessage(message) === action.turn.sequence);
      });
      return updateView(updateLatestTurn(updateLatestTurn({ ...state, sessions: sortByRecent(sessions) }, action.sessionId, action.turn), action.sessionId, latestTurn(turns)), action.sessionId, {
        ...(session ? { session } : {}),
        turns,
        historyLoaded: true,
        messages: mergeDisplayMessages(projected, liveMessages),
        oldestCursor: turns[0]?.sequence ?? current.oldestCursor,
        newestCursor: turns.at(-1)?.sequence ?? current.newestCursor,
        ...live,
      });
    }
    case "turn-patch": {
      recordDebugEvent("chat.turn.patch", { status: action.turn.status ?? null, clientMessageIdPresent: typeof turnClientMessageId(action.turn) === "string" });
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      const turns = patchTurnRecords(current.turns, action.turn);
      const knownTurn = action.turn.id ? state.sessionTurnStatuses[action.turn.id] : null;
      const nextState = updateLatestTurn(state, action.sessionId, reconcileTurnStatusPatch(knownTurn ?? state.sessionLatestTurns[action.sessionId], action.turn));
      if (turns === current.turns) return nextState;
      const patched = turns.find((turn) => turn.id === action.turn.id || turn.id === current.stream?.turnId);
      return updateView(nextState, action.sessionId, {
        turns,
        historyLoaded: true,
        messages: mergeDisplayMessages(messagesFromTurns(turns), current.messages),
        oldestCursor: turns[0]?.sequence ?? current.oldestCursor,
        newestCursor: turns.at(-1)?.sequence ?? current.newestCursor,
        ...(isTerminalTurnStatus(patched?.status) && current.stream?.turnId === patched?.id ? { stream: null } : {}),
      });
    }
    case "turn-index-start":
      return updateView(state, action.sessionId, { turnIndexLoading: true });
    case "turn-index":
      return updateView(updateLatestTurn(state, action.sessionId, latestTurn(action.turnIndex)), action.sessionId, { turnIndex: action.turnIndex });
    case "turn-index-end":
      return updateView(state, action.sessionId, { turnIndexLoading: false });
    case "message-add": {
      recordDebugEvent("chat.message.added", { role: action.message.role, sequence: action.message.sequence, optimistic: action.message.meta?.optimistic === true, messageKind: action.message.meta?.messageKind ?? null });
      const view = state.sessionViews[action.sessionId] ?? emptyView();
      const incomingMeta = action.message.meta ?? {};
      const turnId = typeof incomingMeta.turnId === "string" ? incomingMeta.turnId : null;
      const turnSequence = typeof incomingMeta.turnSequence === "number" ? incomingMeta.turnSequence : view.turns.find((turn) => turn.id === turnId)?.sequence;
      const message = { ...action.message, meta: { ...incomingMeta, ...(turnSequence != null ? { turnSequence } : {}), _mobileLive: true } };
      const messages = mergeMessages(view.messages, message);
      const streamDone = action.message.role === "assistant" && incomingMeta.messageKind !== "assistant_intermediate" && hasFinalAssistantForTurn(messages, view.stream?.turnId ?? turnId);
      return updateView(state, action.sessionId, {
        messages,
        ...(streamDone ? { stream: null } : {}),
      });
    }
    case "message-optimistic": {
      recordDebugEvent("chat.message.optimistic", { role: action.message.role, sequence: action.message.sequence, clientMessageIdPresent: typeof action.message.meta?.clientMessageId === "string" });
      const view = state.sessionViews[action.sessionId] ?? emptyView();
      return updateView(state, action.sessionId, {
        messages: mergeMessages(view.messages, action.message),
      });
    }
    case "send-submit": {
      recordDebugEvent("chat.send.submitted", { turnSequence: action.turnSequence, queuedFollowup: action.queuedFollowup });
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      return updateView(state, action.sessionId, { messages: submitAwaitingSend(current.messages, action.clientMessageId, action.turnSequence, action.queuedFollowup) });
    }
    case "send-accepted": {
      recordDebugEvent("chat.send.accepted");
      const current = state.sessionViews[action.sessionId] ?? emptyView();
      // Only this send's row, if its Turn did not already replace it (a Turn outside the loaded window).
      if (!current.messages.some((message) => isLocalSend(message) && message.meta?.clientMessageId === action.clientMessageId)) return state;
      const messages = current.messages.map((message) => {
        if (!isLocalSend(message) || message.meta?.clientMessageId !== action.clientMessageId) return message;
        const meta = { ...(message.meta ?? {}) };
        delete meta.optimistic;
        return { ...message, meta };
      });
      return updateView(state, action.sessionId, { messages });
    }
    case "send-failed": {
      recordDebugEvent("chat.send.failed", { clientMessageIdPresent: typeof action.clientMessageId === "string", message: action.message });
      const view = state.sessionViews[action.sessionId] ?? emptyView();
      // The failed bubble carries the feedback and its retry; the view error is for loading.
      // Matched by clientMessageId alone, so a send whose in-flight mark was already cleared still
      // fails visibly; a row projected from a server Turn (it has a turnId) was accepted and stays.
      const messages = view.messages.map((message) => message.role === "user" && message.meta?.clientMessageId === action.clientMessageId && typeof message.meta.turnId !== "string" ? failedSendMessage(message, action.message) : message);
      return updateView(state, action.sessionId, { messages });
    }
    case "send-discard": {
      const view = state.sessionViews[action.sessionId] ?? emptyView();
      return updateView(state, action.sessionId, { messages: view.messages.filter((message) => !(message.id === action.messageId && isFailedSend(message))) });
    }
    case "stream-state": {
      const view = state.sessionViews[action.sessionId] ?? emptyView();
      if (!liveStreamStatusFromPatch(action.stream.status)) {
        return view.stream ? updateView(state, action.sessionId, { stream: null }) : state;
      }
      if (hasFinalAssistantForTurn(view.messages, action.stream.turnId)) return view.stream ? updateView(state, action.sessionId, { stream: null }) : state;
      return updateView(state, action.sessionId, { stream: action.stream });
    }
    case "stream-lifecycle":
      return state.sessionViews[action.sessionId]?.stream
        ? updateView(state, action.sessionId, { stream: { ...state.sessionViews[action.sessionId]!.stream!, runtimePhase: "llm_call_started", runtimeProvider: action.provider, runtimeModel: action.model } })
        : state;
    case "stream-clear":
      return updateView(state, action.sessionId, { stream: null });
    case "session-upsert": {
      // Lists hold what the server lists by default; an archived Chat leaves them.
      if (!isListedSession(action.session)) return state.sessions.some((session) => session.id === action.session.id) ? { ...state, sessions: state.sessions.filter((session) => session.id !== action.session.id) } : state;
      const exists = state.sessions.some((session) => session.id === action.session.id);
      return {
        ...state,
        sessions: sortByRecent(
          exists
            ? state.sessions.map((session) => (session.id === action.session.id ? mergeSessionItem(session, action.session) : session))
            : [action.session, ...state.sessions],
        ),
      };
    }
    case "session-forks": {
      const sessionForks = mergeSessionForks(state.sessionForks, action.forks);
      return sessionForks === state.sessionForks ? state : { ...state, sessionForks };
    }
    case "space-upsert": {
      const exists = state.spaces.some((space) => space.id === action.space.id);
      const sessions = applySpaceToSessionSummaries(state.sessions, action.space);
      return {
        ...state,
        spaces: sortByRecent(
          exists
            ? state.spaces.map((space) => (space.id === action.space.id ? { ...space, ...action.space } : space))
            : [action.space, ...state.spaces],
        ),
        ...(sessions === state.sessions ? {} : { sessions }),
      };
    }
    default:
      return state;
  }
}

/** Everything that changes with data; read it through `useAppSelector` so only affected slices re-render. */
export type AppSnapshot = {
  state: AppState;
  connectionState: ConnectionState;
  connectionUnavailable: boolean;
  spaceVisits: SpaceVisit[];
  spaceVisitsError: string | null;
  sessionSeen: SessionSeenState;
};

/** How a local Harness runs a Turn; absent fields leave the Harness's own settings. */
export type LocalExecution = { approvalMode?: ApprovalMode; serviceTier?: string };

/** Provider operations and session-scoped handles; identities change only with the client or user. */
export type AppActions = {
  client: CohubClient | null;
  userUuid: string;
  /** Scopes this account's local cache. */
  userKey: string;
  spaceRealtime: SpaceRealtime | null;
  refreshChats: () => Promise<void>;
  discoverRunningSessions: (source?: SessionSourceFilter) => Promise<void>;
  /** Restarts account-wide Running discovery for the filter that now shows it. */
  requestRunningSessions: (source?: SessionSourceFilter) => Promise<void>;
  /** Stops a scan the filter no longer shows, after a short grace for back-to-back requests. */
  releaseRunningSessions: (source?: SessionSourceFilter) => void;
  installationId: string | null;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  refreshHome: (options?: { silent?: boolean }) => Promise<void>;
  refreshSessionStatuses: (sessions: StatusSession[], options?: { silent?: boolean; throwOnError?: boolean; activeOnly?: boolean; force?: boolean }) => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  openSession: (sessionId: string, options?: SessionOpenOptions) => Promise<void>;
  prefetchSession: (sessionId: string, options?: SessionOpenOptions) => void;
  closeSession: (sessionId: string) => void;
  refreshSession: (sessionId: string, options?: { silent?: boolean; throwOnError?: boolean; catchUp?: boolean; notesOnly?: boolean }) => Promise<void>;
  loadOlderTurns: (sessionId: string) => Promise<void>;
  loadNewerTurns: (sessionId: string) => Promise<void>;
  loadTurnIndex: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  jumpToTurn: (sessionId: string, target: number | { turnId: string }) => Promise<number>;
  /** Resolves true when the newest page replaced the loaded turns instead of joining them. */
  loadLatestTurns: (sessionId: string) => Promise<boolean>;
  /** Inserts the bubble before returning; resolves once the server accepts the send. */
  sendMessage: (sessionId: string, text: string, attachments?: AttachmentDraft[], options?: { model?: ChatModelSelection | null; harness?: HarnessKind; execution?: LocalExecution; note?: boolean; relay?: (content: ContentBlock[]) => Promise<unknown>; retryOf?: MessageRecord; onOptimistic?: (message: MessageRecord) => void }) => Promise<void>;
  /** `onOptimistic` receives the pending bubble synchronously; it has no Chat until the server answers. */
  sendNewMessage: (spaceId: string, text: string, attachments?: AttachmentDraft[], options?: { model?: ChatModelSelection | null; harness?: HarnessKind; execution?: LocalExecution; onOptimistic?: (message: MessageRecord) => void }) => Promise<NewChatMessageResult>;
  discardFailedSend: (sessionId: string, messageId: string) => void;
  loadComposerDraft: (spaceId: string, scope: ComposerDraftScope) => Promise<string>;
  saveComposerDraft: (spaceId: string, scope: ComposerDraftScope, text: string) => Promise<void>;
  /** With `expected`, clears only while the draft still holds that text. */
  clearComposerDraft: (spaceId: string, scope: ComposerDraftScope, expected?: string) => Promise<void>;
  abortSession: (sessionId: string, options?: { refresh?: boolean }) => Promise<void>;
  loadModels: (options?: { force?: boolean }) => Promise<ChatModelCatalogItem[]>;
  loadModelStatus: (options?: { force?: boolean }) => Promise<ModelStatusResponse | null>;
  loadSpaceOverview: () => Promise<PaletteOverviewResponse>;
  recordSpaceVisit: (spaceId: string) => void;
  /** `onDevice` creates a Space whose sandbox is a local Runtime, e.g. a folder on this device. */
  createSpace: (name: string, description?: string, options?: { onDevice?: boolean }) => Promise<SpaceRecord>;
  refreshSpacePin: (spaceId: string) => Promise<boolean>;
  toggleSpacePin: (spaceId: string) => Promise<boolean>;
  upsertSpace: (space: SpaceRecord) => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  /** Archives for every member of the Space; lists drop the Chat at once and restore it if the server refuses. */
  setSessionArchived: (session: SessionRecord & { space?: UserSessionListItem["space"] }, archived: boolean) => Promise<void>;
  forkSession: (spaceId: string, sessionId: string, turn: Pick<SessionTurnRecord, "id" | "sourceTurnId">) => Promise<SessionRecord>;
  rememberSessionForks: (forks: SessionListFork[]) => void;
  clearCache: () => Promise<void>;
  applyCacheRetention: () => Promise<void>;
  loadSessionReadSequence: (sessionId: string) => Promise<number | null>;
  saveSessionReadSequence: (sessionId: string, sequence: number) => Promise<void>;
  /** Device-local: records the Chat's latest message as seen for the Chats list unread marker. */
  markSessionSeen: (sessionId: string, messageId: string | null) => Promise<void>;
  markSessionUnread: (sessionId: string) => Promise<void>;
  /** Device-local: clears every unread marker, including Chats not loaded into a list yet. */
  markAllSessionsSeen: () => Promise<void>;
  /** Starts uploading files as they are attached; `release` stops ones removed before sending. */
  prepareAttachments: (target: UploadTarget, attachments: readonly AttachmentDraft[]) => void;
  releaseAttachments: (target: UploadTarget, attachments: readonly AttachmentDraft[]) => void;
  attachmentUploadState: (target: UploadTarget, attachment: Pick<AttachmentDraft, "uri">) => AttachmentUploadState | null;
  subscribeAttachmentUploads: (listener: () => void) => () => void;
};

type AppStore = StoreApi<AppSnapshot>;

const createAppStore = (): AppStore => createStore<AppSnapshot>()(() => ({
  state: initialState,
  connectionState: "idle",
  connectionUnavailable: false,
  spaceVisits: [],
  spaceVisitsError: null,
  sessionSeen: EMPTY_SESSION_SEEN,
}));

/** A Bot's page shows only its notes, so it reads what arrived since the cached tail instead of the last page again. */
type SessionOpenOptions = { notesOnly?: boolean };

const MODELS_KEY = ["models"] as const;
const MODEL_STATUS_KEY = ["model-status"] as const;

const AppActionsContext = createContext<AppActions | null>(null);
const AppStoreContext = createContext<AppStore | null>(null);

export function AppProvider({
  userUuid,
  getAccessToken,
  getAuthSessionVersion,
  onUnauthorized,
  children,
}: {
  userUuid: string;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  getAuthSessionVersion: () => string | number | null;
  onUnauthorized: (context: UnauthorizedContext) => Promise<void> | void;
  children: ReactNode;
}) {
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [store] = useState(createAppStore);
  // The provider is keyed by user, so this cache never outlives the account it was filled for.
  const [queryClient] = useState(createAppQueryClient);
  const [scopeInvalidator] = useState(() => createScopeInvalidator(queryClient));
  useEffect(() => () => { scopeInvalidator.dispose(); queryClient.clear(); }, [queryClient, scopeInvalidator]);
  const booting = useStore(store, (snapshot) => snapshot.state.booting);
  const connectionStateRef = useRef<ConnectionState>("idle");
  const setConnectionState = useCallback((connectionState: ConnectionState) => store.setState({ connectionState }), [store]);
  const setConnectionUnavailable = useCallback((connectionUnavailable: boolean) => store.setState({ connectionUnavailable }), [store]);
  // Reducer updates apply synchronously, so callbacks and layout effects always read the newest state.
  const [stateRef] = useState(() => ({ get current() { return store.getState().state; } }));
  const subscriptions = useRef(new Map<string, () => void>());
  const sessionSpaces = useRef(new Map<string, string>());
  const openTokens = useRef(new Map<string, number>());
  const sessionLoadRef = useRef<(sessionId: string, options?: SessionOpenOptions) => Promise<void>>(async () => undefined);
  const sessionReleaseRef = useRef<(sessionId: string) => void>(() => undefined);
  const sessionLifecycleRef = useRef(createSessionLifecycle({
    load: (sessionId, options) => sessionLoadRef.current(sessionId, options),
    release: (sessionId) => sessionReleaseRef.current(sessionId),
    releaseDelayMs: 1000,
  }));
  const installationIdRef = useRef<string | null>(null);
  const installationRequestRef = useRef<Promise<string> | null>(null);
  const clientRef = useRef<CohubClient | null>(null);
  const homeRefreshGenerationRef = useRef(0);
  const statusGenerationRef = useRef(0);
  const homeRefreshRequestRef = useRef<Promise<void> | null>(null);
  const chatsRefreshRequestRef = useRef<Promise<void> | null>(null);
  const runningDiscoveryRequests = useRef(new Map<SessionSourceFilter, Promise<void>>());
  const runningDiscoveryControllers = useRef(new Map<SessionSourceFilter, AbortController>());
  const runningDiscoveryRequestedAt = useRef(new Map<SessionSourceFilter, number>());
  const sessionEventRevisions = useRef(new Map<string, number>());
  const sessionEventRevision = useRef(0);
  const statusSessionsRef = useRef(new Map<string, StatusSession>());
  const resyncRunRef = useRef<(sessionId: string, reason: SessionResyncReason) => Promise<void>>(async () => undefined);
  // A ref keeps one coordinator instance for the provider without participating in hook dependencies.
  const resyncCoordinatorRef = useRef(createSessionResyncCoordinator({
    debounceMs: SESSION_RESYNC_DEBOUNCE_MS,
    cooldowns: { "out-of-sync": OUT_OF_SYNC_RESYNC_COOLDOWN_MS },
    run: (sessionId, reason) => resyncRunRef.current(sessionId, reason),
  }));
  const paginationRequestsRef = useRef(new Map<string, Promise<void>>());
  // A ref keeps one queue for the provider; sends outlive the Chat screen that made them.
  const sendQueueRef = useRef(createSendQueue());
  const lastSendOrderRef = useRef(0);
  const sessionsMoreRequestRef = useRef<Promise<void> | null>(null);
  const spacePinMutationVersionsRef = useRef(new Map<string, number>());
  const spacePinPendingMutationsRef = useRef(new Map<string, number>());
  const spacePinMutationSequenceRef = useRef(0);
  // Prod keeps the historical scope; other environments are namespaced so a separate
  // deployment never reuses another environment's cached Spaces, Chats, or read state.
  const userKey = config.environment === "prod" ? userUuid : `${config.environment}:${userUuid}`;
  useDeviceRuntimeSession(userKey, getAccessToken);

  const dispatch = useCallback((action: Action) => {
    if (action.type === "turn-upsert" || action.type === "turn-patch" || action.type === "session-upsert") {
      const id = action.type === "session-upsert" ? action.session.id : action.sessionId;
      sessionEventRevisions.current.set(id, ++sessionEventRevision.current);
    }
    const current = store.getState().state;
    const next = reducer(current, action);
    if (next !== current) store.setState({ state: next });
  }, [store]);

  const ensureInstallation = useCallback(async () => {
    const existing = installationIdRef.current;
    if (existing) return existing;
    const pending = installationRequestRef.current;
    if (pending) return pending;

    const request = getInstallationId().then((id) => {
      installationIdRef.current = id;
      setInstallationId(id);
      return id;
    });
    installationRequestRef.current = request;
    void request.finally(() => {
      if (installationRequestRef.current === request) installationRequestRef.current = null;
    }).catch(() => undefined);
    return request;
  }, []);

  useEffect(() => {
    installationIdRef.current = installationId;
  }, [installationId]);

  const createClient = useCallback(
    (resolvedInstallationId: string) => createMobileClient(getAccessToken, resolvedInstallationId, { getAuthSessionVersion, onUnauthorized }),
    [getAccessToken, getAuthSessionVersion, onUnauthorized],
  );

  const client = useMemo(
    () => installationId ? createClient(installationId) : null,
    [createClient, installationId],
  );

  const { loadOverview: loadSpaceOverview, recordVisit: recordSpaceVisit, reset: resetSpaceList } = useSpaceListOwner(client, userKey, store, queryClient);
  const { markSeen: markSessionSeen, markUnread: markSessionUnread, markAllSeen: markAllSessionsSeen, reload: reloadSessionSeen } = useSessionSeenOwner(userKey, store);
  // Scoped to the client and user like every other cache: a new account never sees another's uploads.
  const attachmentUploads = useMemo(
    () => client && userKey ? createAttachmentUploads((target, attachment, options) => uploadAttachmentFile(client, target, attachment, options)) : null,
    [client, userKey],
  );
  useEffect(() => () => attachmentUploads?.dispose(), [attachmentUploads]);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  // Stop on the phone's indicator ends the agent's Turn as well as its plan, as on the web.
  const stopDisplayTurn = useMemo(() => client
    ? ({ spaceId, sessionId, turnId }: { spaceId: string; sessionId: string; turnId: string | null }) => {
      void client.space(spaceId).session(sessionId).abort({ turnId }).catch((error: unknown) => console.warn("[device-runtime] could not stop the Turn", error));
    }
    : null, [client]);
  useDeviceDisplayInterrupts(stopDisplayTurn);

  const loadModels = useCallback(async (options: { force?: boolean } = {}) => {
    const activeClient = clientRef.current;
    if (!activeClient) throw new Error(translate("data.stillConnecting"));
    if (options.force) await queryClient.invalidateQueries({ queryKey: MODELS_KEY, refetchType: "none" });
    return queryClient.fetchQuery({ queryKey: MODELS_KEY, queryFn: async () => Object.values(await activeClient.models.list()).flat(), staleTime: Infinity });
  }, [queryClient]);

  const loadModelStatus = useCallback(async (options: { force?: boolean } = {}): Promise<ModelStatusResponse | null> => {
    const activeClient = clientRef.current;
    if (!activeClient) throw new Error(translate("data.stillConnecting"));
    if (options.force) await queryClient.invalidateQueries({ queryKey: MODEL_STATUS_KEY, refetchType: "none" });
    return queryClient.fetchQuery({ queryKey: MODEL_STATUS_KEY, queryFn: () => activeClient.models.status(), staleTime: 60_000 });
  }, [queryClient]);

  const refreshSessionStatuses = useCallback(async (sessions: StatusSession[], options: { silent?: boolean; throwOnError?: boolean; activeOnly?: boolean; force?: boolean } = {}) => {
    const activeClient = clientRef.current;
    if (!activeClient || sessions.length === 0) return;
    const generation = statusGenerationRef.current;
    for (const session of sessions) statusSessionsRef.current.set(session.id, session);
    dispatch({ type: "session-status-start", silent: options.silent });
    let statusError: string | undefined;
    try {
      await loadSessionLatestTurns(activeClient, sessions, (sessionId, turn) => {
        if (generation !== statusGenerationRef.current) return;
        dispatch({ type: "session-latest-turn", sessionId, turn });
        const stream = stateRef.current.sessionViews[sessionId]?.stream;
        if (turn && subscriptions.current.has(sessionId) && (
          (isTerminalTurnStatus(turn.status) && stream?.turnId === turn.id) ||
          (isActiveTurnStatus(turn.status) && !stream)
        )) resyncCoordinatorRef.current.request(sessionId, "out-of-sync");
      }, DEFAULT_SESSION_FILTER_MINUTES, {
        knownTurns: stateRef.current.sessionLatestTurns,
        turnStatuses: stateRef.current.sessionTurnStatuses,
        cached: options.silent && !options.force,
        activeOnly: options.activeOnly,
        shouldContinue: () => generation === statusGenerationRef.current && (!options.silent || isAppActive()),
      });
    } catch (error) {
      statusError = errorMessage(error, "Unable to refresh Chat statuses. Check your connection and retry.");
      if (options.throwOnError) throw error;
    } finally {
      if (generation === statusGenerationRef.current) dispatch({ type: "session-status-end", error: statusError, silent: options.silent });
    }
  }, [dispatch, stateRef]);

  const refreshHome = useCallback((options: { silent?: boolean } = {}) => {
    if (homeRefreshRequestRef.current) return homeRefreshRequestRef.current;
    const requestStartedAt = Date.now();
    const request = (async () => {
      const generation = homeRefreshGenerationRef.current + 1;
      homeRefreshGenerationRef.current = generation;
      sessionsMoreRequestRef.current = null;
      dispatch({ type: "home-start", silent: options.silent });
      try {
      const resolvedInstallationId = await ensureInstallation();
      const activeClient = clientRef.current ?? createClient(resolvedInstallationId);
      clientRef.current = activeClient;
      const token = await withAccessTokenTimeout(getAccessToken());
      if (!token) throw new Error(translate("data.signInUnavailable"));
      const [spacesResult, sessionsResult] = await Promise.all([
        withTimeout(listAllSpaces(activeClient), "Loading Spaces").then(
          (spaces) => ({ status: "fulfilled" as const, value: spaces }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        ),
        withTimeout(activeClient.user.listSessions({ limit: 60, includeForks: true }), "Loading Chats").then(
          (sessions) => ({ ...sessions, page: sessionPageState(sessions) }),
        ).then(
          (sessions) => ({ status: "fulfilled" as const, value: sessions }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        ),
      ]);
      if (generation !== homeRefreshGenerationRef.current) return;
      const errors = [spacesResult, sessionsResult].flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (errors.length === 2) {
        throw new Error(errors.map((error) => errorMessage(error, translate("data.requestFailed"))).join("\n"));
      }
      const existingSpaces = new Map(stateRef.current.spaces.map((space) => [space.id, space]));
      const remoteSpaces = spacesResult.status === "fulfilled" ? spacesResult.value ?? [] : null;
      let spaces = remoteSpaces
        ? remoteSpaces.map((space) => preserveSpacePin(existingSpaces.get(space.id), space))
        : stateRef.current.spaces;
      const spacesError = spacesResult.status === "rejected"
        ? `Spaces could not be refreshed: ${errorMessage(spacesResult.reason, translate("data.requestFailed"))}`
        : undefined;
      const pinRequestVersions = new Map(spaces.map((space) => [space.id, spacePinMutationVersionsRef.current.get(space.id) ?? 0]));
      const spacesMissingPinState = remoteSpaces?.filter((space) => space.isPinned === undefined).map((space) => space.id) ?? [];
      let pinStates: Record<string, boolean> = {};
      if (spacesMissingPinState.length > 0) {
        try {
          pinStates = await withTimeout(
            loadResourcePinStates(activeClient, "space", spacesMissingPinState, { force: true }),
            "Loading Space pins",
          );
        } catch (error) {
          invalidateResourcePinReads(activeClient, "space", spacesMissingPinState);
          console.warn("[mobile-pins] failed to refresh Space pins", error);
        }
      }
      if (generation !== homeRefreshGenerationRef.current) return;
      spaces = spaces.map((space) => {
        const mutationVersion = spacePinMutationVersionsRef.current.get(space.id) ?? 0;
        if (spacePinPendingMutationsRef.current.has(space.id) || mutationVersion !== pinRequestVersions.get(space.id)) {
          const current = stateRef.current.spaces.find((item) => item.id === space.id);
          return current?.isPinned === undefined ? space : { ...space, isPinned: current.isPinned };
        }
        const pinned = pinStates[space.id];
        return pinned === undefined ? space : { ...space, isPinned: pinned };
      });
      const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions ?? [] : stateRef.current.sessions;
      const sessionsHasMore = sessionsResult.status === "fulfilled" ? sessionsResult.value.page.hasMore : stateRef.current.sessionsHasMore;
      const sessionsCursor = sessionsResult.status === "fulfilled" ? sessionsResult.value.page.cursor : stateRef.current.sessionsCursor;
      const sessionsPageBoundary = sessionsResult.status === "fulfilled" ? sessionsResult.value.page.boundary : stateRef.current.sessionsPageBoundary;
      const forks = sessionsResult.status === "fulfilled" ? sessionsResult.value.forks ?? [] : [];
      const sessionsError = sessionsResult.status === "rejected"
        ? `Chats could not be refreshed: ${errorMessage(sessionsResult.reason, translate("data.requestFailed"))}`
        : undefined;
      dispatch({ type: "home-success", spaces, sessions, forks, sessionsHasMore, sessionsCursor, sessionsPageBoundary, spacesError, sessionsError, silent: options.silent, requestStartedAt });
      void refreshSessionStatuses(sessions, options);
      if (!options.silent) dispatch({ type: "usage-start" });
      void saveHome(userKey, { spaces, sessions, forks }).catch((error) => {
        console.warn("[mobile-cache] failed to save home", error);
      });
      if (!options.silent) {
        void withTimeout(activeClient.user.getActivity({ days: 7 }), "Loading activity")
          .then((activity) => {
            if (generation === homeRefreshGenerationRef.current) dispatch({ type: "usage", usage: activity.summary });
          })
          .catch((error) => {
            if (generation === homeRefreshGenerationRef.current) dispatch({ type: "usage-error", message: errorMessage(error, translate("data.activityRefreshFailed")) });
          });
      }
    } catch (error) {
      if (generation === homeRefreshGenerationRef.current) {
        dispatch({ type: "home-error", message: errorMessage(error, translate("data.loadCohubFailed")), silent: options.silent });
      }
      }
    })();
    homeRefreshRequestRef.current = request;
    void request.finally(() => {
      if (homeRefreshRequestRef.current === request) homeRefreshRequestRef.current = null;
    }).catch(() => undefined);
    return request;
  }, [createClient, dispatch, ensureInstallation, getAccessToken, refreshSessionStatuses, userKey, stateRef]);

  const refreshChats = useCallback((): Promise<void> => {
    if (homeRefreshRequestRef.current) return homeRefreshRequestRef.current;
    if (chatsRefreshRequestRef.current) return chatsRefreshRequestRef.current;
    if (!client) return Promise.resolve();
    const generation = homeRefreshGenerationRef.current;
    const requestStartedAt = Date.now();
    const request = (async () => {
      try {
        const response = await withTimeout(client.user.listSessions({ limit: 60, includeForks: true }), "Loading Chats");
        if (generation !== homeRefreshGenerationRef.current) return;
        const page = sessionPageState(response);
        const forks = response.forks ?? [];
        dispatch({ type: "sessions-head-success", sessions: response.sessions, forks, ...page, requestStartedAt });
        void saveSessions(userKey, response.sessions, forks).catch(() => undefined);
        // Status enrichment cannot hold or disable the independent list-discovery timer.
        void refreshSessionStatuses(response.sessions, { silent: true });
      } catch (error) {
        if (generation === homeRefreshGenerationRef.current) dispatch({ type: "sessions-head-error", message: errorMessage(error, translate("data.chatsLoadFailed")) });
        throw error;
      }
    })();
    chatsRefreshRequestRef.current = request;
    void request.finally(() => {
      if (chatsRefreshRequestRef.current === request) chatsRefreshRequestRef.current = null;
    }).catch(() => undefined);
    return request;
  }, [client, dispatch, refreshSessionStatuses, userKey]);

  const cancelRunningDiscovery = useCallback((source?: SessionSourceFilter) => {
    const sources = source ? [source] : [...runningDiscoveryControllers.current.keys()];
    for (const key of sources) {
      const controller = runningDiscoveryControllers.current.get(key);
      // Only a visible scan is worth cancelling; a silent one keeps reconciling older pages.
      if (!controller) continue;
      // Drop the identity before aborting so the run's finally block cannot clear a newer scan.
      runningDiscoveryControllers.current.delete(key);
      runningDiscoveryRequests.current.delete(key);
      dispatch({ type: "running-end", source: key });
      controller.abort();
    }
  }, [dispatch]);

  const discoverRunningSessions = useCallback((source: SessionSourceFilter = "all"): Promise<void> => {
    const pending = runningDiscoveryRequests.current.get(source);
    if (pending) return pending;
    if (!client || !isAppActive()) return Promise.resolve();
    const generation = statusGenerationRef.current;
    const revision = sessionEventRevision.current;
    const controller = new AbortController();
    runningDiscoveryControllers.current.set(source, controller);
    dispatch({ type: "running-start", source });
    const request = (async () => {
      try {
        const sessions = await loadRunningSessions(client, {
          source: sessionSourceFilterKeys(source) ?? undefined,
          signal: controller.signal,
          onPage: (page) => {
            if (generation !== statusGenerationRef.current || controller.signal.aborted) return;
            const changedSessionIds = [...sessionEventRevisions.current].filter(([, eventRevision]) => eventRevision > revision).map(([id]) => id);
            const changed = new Set(changedSessionIds);
            for (const session of page) if (!changed.has(session.id)) statusSessionsRef.current.set(session.id, session);
            dispatch({ type: "running-success", source, sessions: page, changedSessionIds, complete: false });
          },
        });
        if (generation !== statusGenerationRef.current || controller.signal.aborted) return;
        const changedSessionIds = [...sessionEventRevisions.current].filter(([, eventRevision]) => eventRevision > revision).map(([id]) => id);
        const changed = new Set(changedSessionIds);
        const unchanged = sessions.filter((session) => !changed.has(session.id));
        for (const session of unchanged) statusSessionsRef.current.set(session.id, session);
        dispatch({ type: "running-success", source, sessions, changedSessionIds });
        void saveRunningSessionCache(userKey, source, runningSessionsForCache(sessions)).catch((error) => {
          console.warn("[mobile-cache] failed to save Running Chats", error);
        });
      } catch (error) {
        if (generation === statusGenerationRef.current && !controller.signal.aborted) {
          dispatch({ type: "running-end", source, error: errorMessage(error, "Unable to discover running Chats. Check your connection and retry.") });
          throw error;
        }
      } finally {
        if (runningDiscoveryControllers.current.get(source) === controller) {
          runningDiscoveryControllers.current.delete(source);
          if (generation === statusGenerationRef.current && controller.signal.aborted) dispatch({ type: "running-end", source });
        }
      }
    })();
    runningDiscoveryRequests.current.set(source, request);
    void request.finally(() => {
      if (runningDiscoveryRequests.current.get(source) === request) runningDiscoveryRequests.current.delete(source);
    }).catch(() => undefined);
    return request;
  }, [client, dispatch, userKey]);

  /** The Chats screen asks for Running data only while its filter shows; each request restarts the check. */
  const requestRunningSessions = useCallback((source: SessionSourceFilter = "all"): Promise<void> => {
    runningDiscoveryRequestedAt.current.set(source, Date.now());
    return discoverRunningSessions(source);
  }, [discoverRunningSessions]);

  const releaseRunningSessions = useCallback((source: SessionSourceFilter = "all") => {
    const requestedAt = runningDiscoveryRequestedAt.current.get(source);
    runningDiscoveryRequestedAt.current.delete(source);
    if (!requestedAt || Date.now() - requestedAt < RUNNING_RELEASE_GRACE_MS) return;
    cancelRunningDiscovery(source);
  }, [cancelRunningDiscovery]);

  const loadMoreSessions = useCallback(async () => {
    if (sessionsMoreRequestRef.current) return sessionsMoreRequestRef.current;
    const current = stateRef.current;
    if (!client || current.refreshing || !current.sessionsHasMore || !current.sessionsCursor || current.sessionsLoadingMore) return;
    const generation = homeRefreshGenerationRef.current;
    const task = (async () => {
      dispatch({ type: "sessions-more-start" });
      try {
        const response = await withTimeout(client.user.listSessions({ limit: 60, cursor: current.sessionsCursor, includeForks: true }), "Loading more Chats");
        if (generation !== homeRefreshGenerationRef.current) return;
        const page = sessionPageState(response, current.sessionsCursor, current.sessionsPageBoundary);
        const nextSessions = response.sessions;
        const forks = response.forks ?? [];
        dispatch({ type: "sessions-more-success", sessions: nextSessions, forks, ...page });
        void refreshSessionStatuses(nextSessions);
        void saveSessions(userKey, nextSessions, forks).catch(() => undefined);
      } catch (error) {
        if (generation === homeRefreshGenerationRef.current) dispatch({ type: "sessions-more-error", message: errorMessage(error, translate("data.chatsLoadFailed")) });
      }
    })();
    sessionsMoreRequestRef.current = task;
    void task.finally(() => {
      if (sessionsMoreRequestRef.current === task) sessionsMoreRequestRef.current = null;
    }).catch(() => undefined);
    return task;
  }, [client, dispatch, refreshSessionStatuses, userKey, stateRef]);

  const applyCacheRetention = useCallback(async () => {
    const cutoff = cacheRetentionCutoff(await loadCacheRetention(), Date.now());
    if (cutoff !== null) await pruneUserCache(userKey, cutoff);
  }, [userKey]);

  useEffect(() => {
    let active = true;
    const activeSubscriptions = subscriptions.current;
    const activeSessionSpaces = sessionSpaces.current;
    const statusSessions = statusSessionsRef.current;
    const discoveryControllers = runningDiscoveryControllers.current;
    const discoveryRequests = runningDiscoveryRequests.current;
    const eventRevisions = sessionEventRevisions.current;
    const activeResyncCoordinator = resyncCoordinatorRef.current;
    const activeSessionLifecycle = sessionLifecycleRef.current;
    const hydrateRunningCache = async () => {
      for (const source of ["all", "web", "other"] as const) {
        try {
          const row = await loadRunningSessionCache(userKey, source);
          const cache = row ? parseCachedRunningSessions(row.payload, row.scannedAt) : null;
          if (active && cache) dispatch({ type: "running-cached", source, cache });
        } catch (error) {
          console.warn("[mobile-cache] failed to hydrate Running Chats", error);
        }
      }
    };
    void (async () => {
      try {
        await applyCacheRetention();
      } catch (error) {
        console.warn("[mobile-cache] failed to prune expired cache", error);
      }
      void hydrateBotCache(queryClient, userKey).catch((error) => console.warn("[mobile-cache] failed to hydrate Bots", error));
      try {
        const cached = await hydrateHome(userKey);
        if (active && (cached.spaces.length > 0 || cached.sessions.length > 0)) {
          dispatch({ type: "hydrate", ...cached });
        }
      } catch (error) {
        console.warn("[mobile-cache] failed to hydrate home", error);
      }
      void hydrateRunningCache();
      if (active) {
        await refreshHome();
      }
    })().catch((error) => {
      if (active) {
        dispatch({
          type: "home-error",
          message: errorMessage(error, translate("data.initFailed")),
        });
      }
    });
    return () => {
      active = false;
      homeRefreshGenerationRef.current += 1;
      statusGenerationRef.current += 1;
      dispatch({ type: "session-status-reset" });
      activeSessionLifecycle.clear();
      for (const sessionId of activeSubscriptions.keys()) activeResyncCoordinator.cancel(sessionId);
      for (const stop of activeSubscriptions.values()) stop();
      activeSubscriptions.clear();
      activeSessionSpaces.clear();
      statusSessions.clear();
      for (const controller of discoveryControllers.values()) controller.abort();
      discoveryControllers.clear();
      discoveryRequests.clear();
      eventRevisions.clear();
    };
  }, [applyCacheRetention, dispatch, queryClient, refreshHome, userKey]);

  useEffect(() => {
    if (!client) return;
    const recovery = createRealtimeRecovery({
      // The SDK exposes no reconnect; subscribing restarts a stopped socket.
      reconnect: () => client.onUserEvent(() => undefined)(),
      onUnavailableChange: setConnectionUnavailable,
      isActive: isAppActive,
      graceMs: REALTIME_UNAVAILABLE_GRACE_MS,
      retryBaseMs: REALTIME_RETRY_BASE_MS,
      retryMaxMs: REALTIME_RETRY_MAX_MS,
    });
    const stopAppActive = subscribeAppActive((active) => {
      if (active) recovery.foreground();
    });
    const stopConnection = client.onConnection((snapshot) => {
      const previous = connectionStateRef.current;
      connectionStateRef.current = snapshot.state;
      recordDebugEvent("net.realtime", {
        state: snapshot.state,
        previous,
        willReconnect: snapshot.willReconnect,
        attempt: snapshot.attempt ?? null,
        delayMs: snapshot.delayMs ?? null,
        recoverable: snapshot.recoverable ?? null,
      });
      const displayState = connectionDisplayState(snapshot);
      if (displayState) setConnectionState(displayState);
      recovery.update(snapshot);
      if (!isTransportRecovery(previous, snapshot.state)) return;
      for (const sessionId of subscriptions.current.keys()) resyncCoordinatorRef.current.request(sessionId, "transport-open");
      void queryClient.invalidateQueries();
    });
    return () => {
      stopConnection();
      stopAppActive();
      recovery.dispose();
      setConnectionUnavailable(false);
    };
  }, [client, queryClient, setConnectionState, setConnectionUnavailable]);

  useEffect(() => {
    return subscribeAppActive((active) => {
      if (!active) {
        for (const controller of runningDiscoveryControllers.current.values()) controller.abort();
        runningDiscoveryControllers.current.clear();
        runningDiscoveryRequests.current.clear();
        return;
      }
      // A suspended native socket can still report open after foregrounding.
      for (const sessionId of subscriptions.current.keys()) resyncCoordinatorRef.current.request(sessionId, "foreground");
      void queryClient.invalidateQueries();
    });
  }, [queryClient]);

  // These queries schedule reducer-owned reads; their data is only a completion stamp.
  const accountSyncEnabled = Boolean(client) && !booting;
  const connectionOpen = useStore(store, (snapshot) => snapshot.connectionState === "open");
  useQuery({ queryKey: ["chats"], queryFn: async () => { await refreshChats(); return Date.now(); }, enabled: accountSyncEnabled, staleTime: 2_000, refetchInterval: 60_000, notifyOnChangeProps: [] }, queryClient);
  useQuery({
    queryKey: ["chat-statuses"],
    enabled: accountSyncEnabled,
    notifyOnChangeProps: [],
    staleTime: 5_000,
    // User-room Turn projections carry live status; polling only reconciles missed events.
    refetchInterval: connectionOpen ? 30_000 : 5_000,
    queryFn: async () => {
      const sessions = new Map(statusSessionsRef.current);
      for (const session of stateRef.current.sessions) if (!sessions.has(session.id)) sessions.set(session.id, session);
      for (const query of Object.values(stateRef.current.runningSessions)) for (const session of query.sessions) sessions.set(session.id, session);
      for (const view of Object.values(stateRef.current.sessionViews)) if (view.session && !sessions.has(view.session.id)) sessions.set(view.session.id, view.session);
      const active = [...sessions.values()].filter((session) => {
        const turn = stateRef.current.sessionLatestTurns[session.id];
        return sessionListStatus(session, turn, stateRef.current.sessionTurnStatuses) === "running";
      });
      await refreshSessionStatuses(active, { silent: true, activeOnly: true });
      return Date.now();
    },
  }, queryClient);
  // Account-wide Running discovery is owned by the Chats screen while its Running filter is visible;
  // Turn projections keep membership current in between, so boot does not scan every Chat.
  useQuery({
    queryKey: ["spaces"],
    enabled: accountSyncEnabled,
    notifyOnChangeProps: [],
    staleTime: 120_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      if (!client) return Date.now();
      const generation = homeRefreshGenerationRef.current;
      try {
        const spaces = await withTimeout(listAllSpaces(client), "Loading Spaces");
        if (generation === homeRefreshGenerationRef.current) dispatch({ type: "spaces-sync", spaces });
      } catch (error) {
        if (generation === homeRefreshGenerationRef.current) dispatch({ type: "spaces-sync", error: errorMessage(error, "Unable to refresh Spaces") });
        throw error;
      }
      return Date.now();
    },
  }, queryClient);

  const applyRealtimeChange = useCallback((change: ReturnType<typeof spaceRealtimeChange>) => {
    if (change.sessionId) {
      sessionEventRevisions.current.set(change.sessionId, ++sessionEventRevision.current);
      if (change.session) dispatch({ type: "session-realtime-meta", sessionId: change.sessionId, session: change.session });
      if (change.fork) {
        const { spaceId, ...lineage } = change.fork;
        const parentTitle = stateRef.current.sessions.find((session) => session.id === lineage.parentSessionId)?.title ?? null;
        const fork = realtimeSessionFork(stateRef.current.sessionForks, spaceId, lineage, parentTitle);
        // Kept in memory only: the next list read persists the full edge.
        if (fork) dispatch({ type: "session-forks", forks: [fork] });
      }
      if (change.turn) dispatch({ type: "session-realtime-turn", sessionId: change.sessionId, turn: change.turn });
    }
    scopeInvalidator.add(change);
  }, [dispatch, scopeInvalidator, stateRef]);

  const handleSpaceEvent = useCallback((event: SpaceRealtimeEvent) => {
    recordDebugEvent("realtime.space_event", {
      type: event.type,
      space: typeof event.spaceId === "string" ? debugAlias("space", event.spaceId) : null,
      session: typeof event.sessionId === "string" ? debugAlias("session", event.sessionId) : null,
    });
    try {
      scopeInvalidator.add(spaceRealtimeChange(event));
    } catch (error) {
      dispatch({ type: "realtime-error", message: errorMessage(error, "Unable to synchronize Space events") });
    }
  }, [dispatch, scopeInvalidator]);

  // The socket also delivers watched Space rooms here; this is the one place their Session and Turn state is applied.
  useEffect(() => {
    if (!client) return;
    let disposed = false;
    const finding = new Set<string>();
    const isListed = (sessionId: string) => stateRef.current.sessions.some((session) => session.id === sessionId)
      || Object.values(stateRef.current.runningSessions).some((query) => query?.sessions.some((session) => session.id === sessionId));
    // One read admits a Chat that starts outside the loaded pages, instead of an account-wide scan.
    const findRunningSession = async (spaceId: string, sessionId: string) => {
      if (finding.has(sessionId)) return;
      finding.add(sessionId);
      try {
        const { space, session } = await withTimeout(client.space(spaceId).session(sessionId).get(), "Loading a running Chat");
        if (disposed) return;
        dispatch({ type: "running-session-found", session: { ...session, space: { id: space.id, name: space.name ?? "", slug: space.slug, publicProfile: space.publicProfile ?? null } } });
      } catch (error) {
        // The periodic Running scan reconciles a Chat this read missed.
        console.warn("[mobile-realtime] failed to load a running Chat", sessionId, error);
      } finally {
        finding.delete(sessionId);
      }
    };
    const stop = client.onUserEvent((event) => {
      recordDebugEvent("realtime.user_event", {
        type: event.type,
        space: typeof event.spaceId === "string" ? debugAlias("space", event.spaceId) : null,
        session: typeof event.sessionId === "string" ? debugAlias("session", event.sessionId) : null,
      });
      try {
        const listed = typeof event.sessionId === "string" && isListed(event.sessionId);
        const change = userSessionRealtimeChange(event, () => listed);
        applyRealtimeChange(change);
        if (!listed && change.sessionId && change.turn?.status && isActiveTurnStatus(change.turn.status) && typeof event.spaceId === "string") void findRunningSession(event.spaceId, change.sessionId);
      } catch (error) {
        // One malformed background event must not block the lists; status polling reconciles it.
        console.warn("[mobile-realtime] skipped user Session event", event.type, event.sessionId, error);
      }
    });
    return () => { disposed = true; stop(); };
  }, [applyRealtimeChange, client, dispatch, stateRef]);

  const spaceRealtime = useMemo(() => client ? createSpaceRealtime({
    subscribe: (spaceId, listener) => client.space(spaceId).subscribe(listener),
    event: handleSpaceEvent,
    error: (message) => dispatch({ type: "realtime-error", message }),
  }) : null, [client, dispatch, handleSpaceEvent]);

  useEffect(() => {
    if (!spaceRealtime) return;
    spaceRealtime.setActive(isAppActive());
    const stopAppActive = subscribeAppActive((active) => spaceRealtime.setActive(active));
    return () => { stopAppActive(); spaceRealtime.setActive(false); };
  }, [spaceRealtime]);

  useEffect(() => {
    const coordinator = resyncCoordinatorRef.current;
    return () => coordinator.dispose();
  }, []);

  const refreshSession = useCallback(
    async (sessionId: string, options: { silent?: boolean; throwOnError?: boolean; catchUp?: boolean; notesOnly?: boolean } = {}) => {
      if (!client) return;
      const view = stateRef.current.sessionViews[sessionId];
      // A failed initial detail read needs discovery and subscriptions, not just a history refresh.
      if (!view?.session || !view.space) {
        await sessionLoadRef.current(sessionId, { notesOnly: options.notesOnly });
        return;
      }
      const spaceId = view.session.spaceId;
      const openToken = openTokens.current.get(sessionId);
      const isCurrentRequest = () => openTokens.current.get(sessionId) === openToken;
      const key = `refresh:${sessionId}:${openToken}`;
      const pending = paginationRequestsRef.current.get(key);
      if (pending) return pending;
      const request = (async () => {
      markChatEntry("refresh.start", { silent: Boolean(options.silent) });
      // Recovery resyncs must not flash the pull-to-refresh spinner.
      dispatch({ type: "session-refresh-start", sessionId, ...(options.silent ? { silent: true } : {}), ...(options.catchUp ? { catchUp: true } : {}) });
      try {
        const before = stateRef.current.sessionViews[sessionId];
        const cachedRange = options.notesOnly ? cachedTurnRange(before?.messages ?? []) : { oldest: null, newest: null };
        const cursor = options.notesOnly ? before?.newestCursor ?? cachedRange.newest : null;
        // A Bot's page reads only the notes after the tail it already shows.
        const response = await withTimeout(client.space(spaceId).session(sessionId).turns.listPaginated(cursor !== null ? { cursor, direction: "newer", limit: 100 } : { limit: 30 }), "Loading Chat");
        if (!isCurrentRequest()) return;
        const current = stateRef.current.sessionViews[sessionId];
        const liveMessages = current?.messages.filter(isLiveMessage) ?? [];
        let turns: SessionTurnRecord[];
        let hasMoreOlder: boolean;
        let hasMoreNewer: boolean;
        let oldestCursor: number | null;
        let newestCursor: number | null;
        let messages: MessageRecord[];
        if (cursor !== null) {
          turns = mergeTurns(current?.turns ?? [], response.turns);
          hasMoreOlder = current?.hasMoreOlder ?? true;
          hasMoreNewer = response.hasMore;
          oldestCursor = current?.oldestCursor ?? cachedRange.oldest;
          newestCursor = turns.at(-1)?.sequence ?? cursor;
          messages = mergeDisplayMessages(current?.messages ?? [], messagesFromTurns(turns));
        } else {
          const loaded = { turns: current?.turns ?? [], hasMoreOlder: current?.hasMoreOlder ?? false, hasMoreNewer: current?.hasMoreNewer ?? false };
          const head = { turns: response.turns, hasMoreOlder: response.hasMore, hasMoreNewer: false };
          // A head that doesn't join replaces the loaded turns, except a detached window keeps the reader's place.
          ({ turns, hasMoreOlder, hasMoreNewer } = mergeTurnWindows(loaded, head) ?? (loaded.hasMoreNewer ? loaded : head));
          oldestCursor = turns[0]?.sequence ?? null;
          newestCursor = turns.at(-1)?.sequence ?? null;
          messages = mergeDisplayMessages(messagesFromTurns(turns), liveMessages);
        }
        const claimed = claimedFailedSends(liveMessages, messages);
        if (claimed.length > 0) void deleteMessages(userKey, sessionId, claimed).catch(() => undefined);
        dispatch({
          type: "session-refresh-end",
          sessionId,
          ...(options.silent ? { silent: true } : {}),
          session: response.session,
          messages,
          turns,
          hasMoreOlder,
          hasMoreNewer,
          oldestCursor,
          newestCursor,
        });
        queryClient.setQueryData([`chat:${sessionId}:tail`], Date.now());
        // In-flight sends own their rows; rewriting them here could revive one its send already removed.
        void saveMessages(userKey, sessionId, messages.filter((message) => message.meta?.optimistic !== true)).catch(() => undefined);
        markChatEntry("refresh.end", { turns: turns.length });
      } catch (error) {
        if (!isCurrentRequest()) return;
        dispatch({
          type: "session-refresh-end",
          sessionId,
          ...(options.silent ? { silent: true } : {}),
          error: error instanceof Error ? error.message : translate("data.refreshChatFailed"),
        });
        if (options.throwOnError) throw error;
      }
      })();
      paginationRequestsRef.current.set(key, request);
      try { await request; }
      finally { if (paginationRequestsRef.current.get(key) === request) paginationRequestsRef.current.delete(key); }
    },
    [client, dispatch, queryClient, userKey, stateRef],
  );

  const loadTurnIndex = useCallback(async (sessionId: string, options: { force?: boolean } = {}) => {
    const current = stateRef.current.sessionViews[sessionId];
    if (!options.force && current?.turnIndex.length) return;
    const sessionSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
    const spaceId = current?.session?.spaceId ?? sessionSummary?.spaceId;
    const activeClient = clientRef.current;
    if (!activeClient || !spaceId) return;
    markChatEntry("turnIndex.start");
    const key = `${sessionId}:index`;
    const pending = paginationRequestsRef.current.get(key);
    if (pending && !options.force) return pending;

    const task = (async () => {
      dispatch({ type: "turn-index-start", sessionId });
      try {
        let cursor: number | undefined;
        const collected: SessionTurnIndexItem[] = [];
        for (;;) {
          const response = await activeClient.space(spaceId).session(sessionId).turns.index({ cursor, limit: 500 });
          collected.push(...response.turns);
          if (!response.hasMore || response.nextCursor == null) break;
          cursor = response.nextCursor;
        }
        const bySequence = new Map<number, SessionTurnIndexItem>();
        for (const item of collected) bySequence.set(item.sequence, item);
        dispatch({ type: "turn-index", sessionId, turnIndex: [...bySequence.values()].sort((a, b) => a.sequence - b.sequence) });
        markChatEntry("turnIndex.end", { count: collected.length });
      } catch (error) {
        console.warn("[mobile-session] failed to load turn index", error);
      } finally {
        dispatch({ type: "turn-index-end", sessionId });
      }
    })();
    paginationRequestsRef.current.set(key, task);
    void task.finally(() => {
      if (paginationRequestsRef.current.get(key) === task) paginationRequestsRef.current.delete(key);
    }).catch(() => undefined);
    return task;
  }, [dispatch, stateRef]);

  const loadOlderTurns = useCallback(async (sessionId: string) => {
    const key = `${sessionId}:older`;
    const pending = paginationRequestsRef.current.get(key);
    if (pending) return pending;
    const task = (async () => {
      const view = stateRef.current.sessionViews[sessionId];
      const sessionSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
      const spaceId = view?.session?.spaceId ?? sessionSummary?.spaceId;
      const activeClient = clientRef.current;
      if (!activeClient || !spaceId || !view || !view.hasMoreOlder || view.loadingOlder) return;
      const openToken = openTokens.current.get(sessionId);
      const isCurrentRequest = () => openToken === undefined || openTokens.current.get(sessionId) === openToken;
      dispatch({ type: "session-page-start", sessionId, direction: "older" });
      try {
        const response = await activeClient.space(spaceId).session(sessionId).turns.listPaginated({ ...(view.oldestCursor != null ? { cursor: view.oldestCursor } : {}), direction: "older", limit: 30 });
        if (!isCurrentRequest()) {
          dispatch({ type: "session-page-end", sessionId, direction: "older" });
          return;
        }
        dispatch({ type: "session-page-success", sessionId, session: response.session, turns: response.turns, hasMore: response.hasMore, direction: "older" });
        const merged = mergeTurns(stateRef.current.sessionViews[sessionId]?.turns ?? [], response.turns);
        void saveMessages(userKey, sessionId, messagesFromTurns(merged)).catch(() => undefined);
      } catch (error) {
        if (!isCurrentRequest()) {
          dispatch({ type: "session-page-end", sessionId, direction: "older" });
          return;
        }
        dispatch({ type: "session-page-error", sessionId, message: errorMessage(error, translate("data.loadOlderFailed")) });
      }
    })();
    paginationRequestsRef.current.set(key, task);
    void task.finally(() => {
      if (paginationRequestsRef.current.get(key) === task) paginationRequestsRef.current.delete(key);
    }).catch(() => undefined);
    return task;
  }, [dispatch, userKey, stateRef]);

  const loadNewerTurns = useCallback(async (sessionId: string) => {
    const key = `${sessionId}:newer`;
    const pending = paginationRequestsRef.current.get(key);
    if (pending) return pending;
    const task = (async () => {
      const view = stateRef.current.sessionViews[sessionId];
      const sessionSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
      const spaceId = view?.session?.spaceId ?? sessionSummary?.spaceId;
      const activeClient = clientRef.current;
      if (!activeClient || !spaceId || !view || !view.hasMoreNewer || view.loadingNewer) return;
      const openToken = openTokens.current.get(sessionId);
      const isCurrentRequest = () => openToken === undefined || openTokens.current.get(sessionId) === openToken;
      dispatch({ type: "session-page-start", sessionId, direction: "newer" });
      try {
        const response = await activeClient.space(spaceId).session(sessionId).turns.listPaginated({ ...(view.newestCursor != null ? { cursor: view.newestCursor } : {}), direction: "newer", limit: 100 });
        if (!isCurrentRequest()) {
          dispatch({ type: "session-page-end", sessionId, direction: "newer" });
          return;
        }
        dispatch({ type: "session-page-success", sessionId, session: response.session, turns: response.turns, hasMore: response.hasMore, direction: "newer" });
        const merged = mergeTurns(stateRef.current.sessionViews[sessionId]?.turns ?? [], response.turns);
        void saveMessages(userKey, sessionId, messagesFromTurns(merged)).catch(() => undefined);
      } catch (error) {
        if (!isCurrentRequest()) {
          dispatch({ type: "session-page-end", sessionId, direction: "newer" });
          return;
        }
        dispatch({ type: "session-page-error", sessionId, message: errorMessage(error, translate("data.loadNewerFailed")) });
      }
    })();
    paginationRequestsRef.current.set(key, task);
    void task.finally(() => {
      if (paginationRequestsRef.current.get(key) === task) paginationRequestsRef.current.delete(key);
    }).catch(() => undefined);
    return task;
  }, [dispatch, userKey, stateRef]);

  const jumpToTurn = useCallback(async (sessionId: string, target: number | { turnId: string }) => {
    const view = stateRef.current.sessionViews[sessionId];
    const targetTurn = typeof target === "number"
      ? view?.turns.find((turn) => turn.sequence === target)
      : view?.turns.find((turn) => turn.id === target.turnId || turn.sourceTurnId === target.turnId);
    if (targetTurn) return targetTurn.sequence;
    const sessionSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
    const spaceId = view?.session?.spaceId ?? sessionSummary?.spaceId;
    const activeClient = clientRef.current;
    if (!activeClient || !spaceId) throw new Error(translate("data.chatContextUnavailable"));
    const response = await activeClient.space(spaceId).session(sessionId).turns.window({ ...(typeof target === "number" ? { sequence: target } : { turnId: target.turnId }), before: 10, after: 20 });
    const sequence = response.anchorSequence ?? response.turns.find((turn) => (typeof target === "number" && turn.sequence === target) || (typeof target !== "number" && (turn.id === target.turnId || turn.sourceTurnId === target.turnId)))?.sequence;
    if (sequence == null) throw new Error(translate("data.turnUnavailable"));
    dispatch({ type: "session-window-success", sessionId, session: response.session, turns: response.turns, hasMoreOlder: response.hasMoreOlder, hasMoreNewer: response.hasMoreNewer, oldestCursor: response.oldestCursor, newestCursor: response.newestCursor });
    void saveMessages(userKey, sessionId, messagesFromTurns(mergeTurns(view?.turns ?? [], response.turns))).catch(() => undefined);
    return sequence;
  }, [dispatch, userKey, stateRef]);

  /** One request for the newest page, instead of paging forward through everything between. */
  const loadLatestWindow = useCallback(async (sessionId: string): Promise<{ turns: SessionTurnRecord[]; replaced: boolean }> => {
    const view = stateRef.current.sessionViews[sessionId];
    if (!view?.hasMoreNewer) return { turns: view?.turns ?? [], replaced: false };
    const spaceId = view.session?.spaceId ?? stateRef.current.sessions.find((item) => item.id === sessionId)?.spaceId;
    const activeClient = clientRef.current;
    if (!activeClient || !spaceId) throw new Error(translate("data.chatContextUnavailable"));
    const openToken = openTokens.current.get(sessionId);
    const response = await withTimeout(activeClient.space(spaceId).session(sessionId).turns.listPaginated({ limit: 30 }), "Loading Chat");
    const current = stateRef.current.sessionViews[sessionId] ?? view;
    const head = { turns: response.turns, hasMoreOlder: response.hasMore, hasMoreNewer: false };
    const merged = mergeTurnWindows(current, head);
    if (openTokens.current.get(sessionId) !== openToken) return { turns: (merged ?? head).turns, replaced: merged === null };
    dispatch({ type: "session-window-success", sessionId, session: response.session, turns: response.turns, hasMoreOlder: response.hasMore, hasMoreNewer: false, newest: true });
    void saveMessages(userKey, sessionId, messagesFromTurns(response.turns)).catch(() => undefined);
    return { turns: (merged ?? head).turns, replaced: merged === null };
  }, [dispatch, userKey, stateRef]);

  const loadLatestTurns = useCallback(async (sessionId: string) => (await loadLatestWindow(sessionId)).replaced, [loadLatestWindow]);

  /**
   * (Re)attach realtime subscriptions for an open Chat. `recover: true` seeds the
   * stream reducer from the server snapshot, which is what lets a resubscribe pick
   * up mid-turn streaming after the socket dropped or the app was backgrounded.
   */
  const attachSessionRealtime = useCallback((client: CohubClient, spaceId: string, sessionId: string) => {
    subscriptions.current.get(sessionId)?.();
    sessionSpaces.current.set(sessionId, spaceId);
    markChatEntry("stream.subscribe");
    recordDebugEvent("chat.stream.attach", { session: debugAlias("session", sessionId), space: debugAlias("space", spaceId) });
    const sessionClient = client.space(spaceId).session(sessionId);
    const streamBatch = createStreamBatch<StreamView>((stream) => dispatch({ type: "stream-state", sessionId, stream }));
    let seeded = false;
    const stopGeneration = sessionClient.subscribeGeneration(
      {
        state: (event) => {
          if (!seeded) {
            seeded = true;
            markChatEntry("stream.seed", { blocks: event.state.contentBlocks?.length ?? 0, intermediate: event.intermediateMessages?.length ?? 0 });
            recordDebugEvent("chat.stream.seed", { session: debugAlias("session", sessionId), blocks: event.state.contentBlocks?.length ?? 0, intermediate: event.intermediateMessages?.length ?? 0 });
          }
          const status = liveStreamStatusFromPatch(event.state.status);
          if (!status) {
            streamBatch.cancel();
            dispatch({ type: "stream-clear", sessionId });
            return;
          }
          const stream: StreamView = {
            status,
            contentBlocks: event.state.contentBlocks,
            intermediateMessages: event.intermediateMessages,
            turnId: event.state.turnId,
            messageId: event.messageId,
            runtimePhase: null,
            runtimeProvider: null,
            runtimeModel: null,
            outputAt: event.state.contentBlocks.length || event.intermediateMessages.length ? new Date().toISOString() : null,
          };
          if (stream.status === "streaming") streamBatch.push(stream);
          else {
            streamBatch.cancel();
            dispatch({ type: "stream-state", sessionId, stream });
          }
        },
        commit: (event) => {
          if (event.commit.isFinal) streamBatch.cancel();
          else streamBatch.flush();
          dispatch({ type: "message-add", sessionId, message: event.commit.message });
          if (event.commit.isFinal) dispatch({ type: "stream-clear", sessionId });
        },
        finalized: (event) => {
          recordDebugEvent("chat.stream.finalized", { session: debugAlias("session", sessionId), turnSequence: event.turn.sequence, status: event.turn.status });
          streamBatch.cancel();
          dispatch({ type: "turn-upsert", sessionId, turn: event.turn });
          dispatch({ type: "stream-clear", sessionId });
          void refreshSession(sessionId);
        },
        turnUpdated: (event) => {
          dispatch({ type: "turn-patch", sessionId, turn: event.turn });
        },
        lifecycle: (event) => {
          if (event.phase !== "llm_call_started") return;
          recordDebugEvent("chat.stream.lifecycle", { session: debugAlias("session", sessionId), phase: event.phase, provider: event.provider ?? null, model: event.model ?? null });
          streamBatch.flush();
          dispatch({ type: "stream-lifecycle", sessionId, provider: event.provider, model: event.model });
        },
        error: (event) => {
          recordDebugEvent("chat.stream.error", { session: debugAlias("session", sessionId), message: event.message });
          streamBatch.flush();
          dispatch({ type: "session-error", sessionId, message: event.message });
        },
        outOfSync: (event) => {
          // Only a patch whose base sequence drifted needs a fresh snapshot-seeded
          // subscription; anything else just needs the turn tail reconciled.
          const drifted = event.reason === "version_mismatch" && event.source === "patch";
          recordDebugEvent("chat.stream.out_of_sync", { session: debugAlias("session", sessionId), reason: event.reason, source: event.source, drifted });
          if (!drifted || !resyncCoordinatorRef.current.request(sessionId, "out-of-sync")) {
            void refreshSession(sessionId, { silent: true });
          }
        },
      },
      { recover: true },
    );
    const stopPersisted = sessionClient.subscribe({
      event: (event) => {
        if (event.type === "session.turn.created") {
          // A note is complete when written and never finalizes, so only its creation brings its Turn (and the
          // origin that marks a Bot's `say`) to an open Chat. Before the first page lands the Turn would stand in
          // for the cached thread; that page brings it instead.
          const turn = (event.payload as { turn?: SessionTurnRecord }).turn;
          if (turn?.executionKind === "note" && typeof turn.id === "string" && Number.isSafeInteger(turn.sequence) && stateRef.current.sessionViews[sessionId]?.historyLoaded) dispatch({ type: "turn-upsert", sessionId, turn });
          return;
        }
        if (event.type !== "session.updated") return;
        const currentSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
        const current = stateRef.current.sessionViews[sessionId]?.session
          ?? currentSummary;
        if (!current) return;
        const payload = event.payload as { session?: Partial<SessionRecord> };
        if (!payload.session || payload.session.id !== sessionId) return;
        const updated = preferNewerSession(current, { ...current, ...payload.session });
        const nextSummary = {
          ...updated,
          space: currentSummary?.space ?? null,
        };
        dispatch({ type: "session-upsert", session: nextSummary });
        void saveSessions(userKey, [nextSummary]).catch(() => undefined);
        const currentView = stateRef.current.sessionViews[sessionId];
        if (currentView) dispatch({ type: "session-meta", sessionId, session: updated, space: currentView.space });
      },
      persisted: (event) => {
        if (event.type !== "session.message.persisted") return;
        const message = (event.payload as { message?: MessageRecord }).message;
        if (!message) return;
        const currentMessages = stateRef.current.sessionViews[sessionId]?.messages ?? [];
        dispatch({ type: "message-add", sessionId, message });
        void saveMessages(userKey, sessionId, mergeMessages(currentMessages, message).filter((row) => row.meta?.optimistic !== true)).catch(() => undefined);
      },
    });
    const stop = () => {
      streamBatch.cancel();
      stopGeneration();
      stopPersisted();
    };
    subscriptions.current.set(sessionId, stop);
  }, [dispatch, refreshSession, userKey, stateRef]);

  /**
   * Recover an open Chat after a transport/foreground gap: rebuild the generation
   * subscription (snapshot-seeded) so mid-turn streaming resumes, then reconcile the
   * turn tail so anything that finished while offline lands as history.
   */
  const resyncSession = useCallback(async (sessionId: string, _reason: SessionResyncReason) => {
    const activeClient = clientRef.current;
    const spaceId = sessionSpaces.current.get(sessionId);
    if (!activeClient || !spaceId || !subscriptions.current.has(sessionId)) return;
    attachSessionRealtime(activeClient, spaceId, sessionId);
    await refreshSession(sessionId, { silent: true, catchUp: true });
  }, [attachSessionRealtime, refreshSession]);

  useEffect(() => {
    resyncRunRef.current = resyncSession;
  }, [resyncSession]);

  const loadSession = useCallback(
    async (sessionId: string, options: SessionOpenOptions = {}) => {
      if (!client) return;
      const token = (openTokens.current.get(sessionId) ?? 0) + 1;
      openTokens.current.set(sessionId, token);
      const view = stateRef.current.sessionViews[sessionId];
      const summary = view?.session ?? stateRef.current.sessions.find((item) => item.id === sessionId);
      markChatEntry("load.start", { memory: Boolean(view?.historyLoaded && view.session && view.space), cachedMessages: view?.messages.length ?? 0 });
      if (view?.historyLoaded && view.session && view.space) {
        recordSpaceVisit(view.space.id);
        // Memory already owns the history window; disk hydration would replace newer live messages.
        attachSessionRealtime(client, view.space.id, sessionId);
        await refreshSession(sessionId, { silent: true, catchUp: true, ...(options.notesOnly ? { notesOnly: true } : {}) });
        return;
      }
      dispatch({ type: "session-start", sessionId, session: summary ?? null });

      // Rows of sends still queued in this process are not history to show from the cache.
      if (!view?.messages.some((message) => !isLocalSend(message) && !isFailedSend(message))) {
        try {
          markChatEntry("cache.start");
          const live = (message: MessageRecord) => typeof message.meta?.clientMessageId === "string" && sendQueueRef.current.has(sessionId, message.meta.clientMessageId);
          const cachedMessages = settleInterruptedSends((await loadMessages(userKey, sessionId)).filter((message) => !live(message)), translate("data.messageSendFailed"));
          markChatEntry("cache.end", { count: cachedMessages.length });
          const claimed = claimedFailedSends(cachedMessages, mergeDisplayMessages(cachedMessages, []));
          if (claimed.length > 0) void deleteMessages(userKey, sessionId, claimed).catch(() => undefined);
          if (openTokens.current.get(sessionId) === token && cachedMessages.length > 0) {
            dispatch({ type: "session-cache", sessionId, messages: cachedMessages });
          }
        } catch (error) {
          console.warn("[mobile-cache] failed to load Chat", error);
        }
      }
      if (openTokens.current.get(sessionId) !== token) return;

      let spaceId = summary?.spaceId;
      let space = view?.space ?? stateRef.current.spaces.find((item) => item.id === spaceId) ?? null;
      let session = summary as SessionRecord | undefined;
      try {
        if (!spaceId || !space || !session) {
          markChatEntry("session.start");
          const detail = await client.user.getSession(sessionId);
          markChatEntry("session.end");
          if (openTokens.current.get(sessionId) !== token) return;
          spaceId = detail.space.id;
          space = detail.space;
          session = detail.session;
          dispatch({
            type: "session-upsert",
            session: {
              ...detail.session,
              space: {
                id: detail.space.id,
                name: displaySpaceName(detail.space),
                slug: detail.space.slug,
                publicProfile: detail.space.publicProfile ?? null,
              },
            },
          });
        }
        if (!spaceId || !space || !session || openTokens.current.get(sessionId) !== token) return;
        recordSpaceVisit(spaceId);
        dispatch({ type: "session-start", sessionId, space, session });
        attachSessionRealtime(client, spaceId, sessionId);
        const sessionClient = client.space(spaceId).session(sessionId);
        const cachedMessages = stateRef.current.sessionViews[sessionId]?.messages ?? [];
        const cachedRange = options.notesOnly ? cachedTurnRange(cachedMessages) : { oldest: null, newest: null };
        // A Bot's page reads only the notes after the cached tail; anything older is already on screen.
        markChatEntry("turns.start");
        const response = await withTimeout(cachedRange.newest !== null
          ? sessionClient.turns.listPaginated({ cursor: cachedRange.newest, direction: "newer", limit: 100 })
          : sessionClient.turns.listPaginated({ limit: 30 }), "Loading Chat");
        markChatEntry("turns.end", { count: response.turns.length });
        if (openTokens.current.get(sessionId) !== token) return;
        const messages = messagesFromTurns(response.turns);
        const liveMessages = cachedMessages.filter(isLiveMessage);
        const shown = cachedRange.newest !== null ? mergeDisplayMessages(cachedMessages, messages) : mergeDisplayMessages(messages, liveMessages);
        const claimed = claimedFailedSends(liveMessages, shown);
        if (claimed.length > 0) void deleteMessages(userKey, sessionId, claimed).catch(() => undefined);
        dispatch({
          type: "session-success",
          sessionId,
          space,
          session: response.session ?? session,
          messages: shown,
          turns: response.turns,
          hasMoreOlder: cachedRange.newest !== null ? cachedRange.oldest !== null && cachedRange.oldest > 1 : response.hasMore,
          hasMoreNewer: false,
          oldestCursor: cachedRange.oldest ?? response.turns[0]?.sequence ?? null,
          newestCursor: Math.max(cachedRange.newest ?? 0, response.turns.at(-1)?.sequence ?? 0) || null,
        });
        // The open just read the tail; mark the poll fresh so it does not repeat the read at once.
        queryClient.setQueryData([`chat:${sessionId}:tail`], Date.now());
        // The turn index only feeds the turn navigator and marker colors; loading it eagerly made
        // every Chat open pay a second slow request plus a full re-render. It loads when opened.
        void saveMessages(userKey, sessionId, messages).catch(() => undefined);
      } catch (error) {
        if (openTokens.current.get(sessionId) !== token) return;
        dispatch({ type: "session-error", sessionId, message: error instanceof Error ? error.message : translate("data.openChatFailed") });
      }
    },
    [attachSessionRealtime, client, dispatch, queryClient, recordSpaceVisit, refreshSession, userKey, stateRef],
  );

  const releaseSession = useCallback((sessionId: string) => {
    resyncCoordinatorRef.current.cancel(sessionId);
    subscriptions.current.get(sessionId)?.();
    subscriptions.current.delete(sessionId);
    sessionSpaces.current.delete(sessionId);
    openTokens.current.set(sessionId, (openTokens.current.get(sessionId) ?? 0) + 1);
    dispatch({ type: "session-release", sessionId });
  }, [dispatch]);

  useLayoutEffect(() => {
    sessionLoadRef.current = loadSession;
    sessionReleaseRef.current = releaseSession;
  }, [loadSession, releaseSession]);

  const openSession = useCallback(async (sessionId: string, options?: SessionOpenOptions) => {
    if (!client) return;
    startChatEntry();
    await sessionLifecycleRef.current.open(sessionId, options);
  }, [client]);

  const prefetchSession = useCallback((sessionId: string, options?: SessionOpenOptions) => {
    if (!client || !sessionId || sessionId === "new") return;
    sessionLifecycleRef.current.prime(sessionId, options);
  }, [client]);

  const closeSession = useCallback((sessionId: string) => {
    sessionLifecycleRef.current.close(sessionId);
  }, []);

  const abortSession = useCallback(
    async (sessionId: string, options: { refresh?: boolean } = {}) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const view = stateRef.current.sessionViews[sessionId];
      const summary = stateRef.current.sessions.find((item) => item.id === sessionId);
      const spaceId = view?.session?.spaceId ?? summary?.spaceId;
      if (!spaceId) throw new Error(translate("data.chatContextUnavailable"));
      await client.space(spaceId).session(sessionId).abort({
        turnId: view?.stream?.turnId ?? null,
      });
      dispatch({ type: "stream-clear", sessionId });
      if (options.refresh !== false) await refreshSession(sessionId);
      void queryClient.invalidateQueries();
    },
    [client, dispatch, refreshSession, queryClient, stateRef],
  );

  /** Resolves once the Chat's history is loaded; a send's Turn number is only known against it. */
  const waitForSendHistory = useCallback((sessionId: string) => new Promise<SessionView>((resolve, reject) => {
    const activeClient = clientRef.current;
    const check = () => {
      const view = store.getState().state.sessionViews[sessionId];
      if (clientRef.current !== activeClient) reject(new Error(translate("data.stillConnecting")));
      else if (view?.historyLoaded) resolve(view);
      else if (view && !view.loading && view.error) reject(new Error(view.error));
      else return false;
      return true;
    };
    if (check()) return;
    const unsubscribe = store.subscribe(() => { if (check()) unsubscribe(); });
  }), [store]);

  /** Realtime can deliver a send's accepted Turn before the prompt response does; either one is the server accepting it. */
  const watchAcceptedTurn = useCallback((sessionId: string, clientMessageId: string) => {
    let unsubscribe: (() => void) | null = null;
    const promise = new Promise<void>((resolve) => {
      const check = () => {
        const accepted = (store.getState().state.sessionViews[sessionId]?.turns ?? []).some((turn) => turnClientMessageId(turn) === clientMessageId);
        if (accepted) resolve();
        return accepted;
      };
      if (check()) return;
      unsubscribe = store.subscribe(() => { if (check()) unsubscribe?.(); });
    });
    return { promise, cancel: () => unsubscribe?.() };
  }, [store]);

  const sendMessage = useCallback(
    async (
      sessionId: string,
      rawText: string,
      attachments: AttachmentDraft[] = [],
      options: { model?: ChatModelSelection | null; harness?: HarnessKind; execution?: LocalExecution; note?: boolean; relay?: (content: ContentBlock[]) => Promise<unknown>; retryOf?: MessageRecord; onOptimistic?: (message: MessageRecord) => void } = {},
    ) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const text = rawText.trim();
      if (!text && attachments.length === 0) return;
      const view = stateRef.current.sessionViews[sessionId];
      const messages = view?.messages ?? [];
      // A second tap on a retry that already replaced its row finds nothing left to resend.
      if (options.retryOf && !messages.some((message) => message.id === options.retryOf?.id && isFailedSend(message))) return;
      const clientMessageId = newId();
      const retried = options.retryOf ?? null;
      // A retry takes back its original place in the queue, ahead of the sends it was holding.
      const order = typeof retried?.meta?.sendOrder === "number" ? retried.meta.sendOrder : Math.max(Date.now(), lastSendOrderRef.current + 1);
      lastSendOrderRef.current = Math.max(lastSendOrderRef.current, order);
      const turnSequence = nextTurnSequence(view?.turns ?? [], messages);
      const optimistic = optimisticSend({
        sessionId, clientMessageId, text, attachments, model: options.model ?? null, harness: options.harness ?? null, authorUuid: userUuid, turnSequence,
        // Behind another unaccepted send, this one will find a Turn running.
        meta: { awaitingSubmit: true, sendOrder: order, queuedFollowup: shouldQueueFollowup(view?.turns ?? [], view?.stream) || messages.some((message) => isLocalSend(message) && message.id !== retried?.id), ...(retried?.meta?.relayed === true ? { relayed: true } : {}) },
      });
      const row = () => stateRef.current.sessionViews[sessionId]?.messages.find((message) => isLocalSend(message) && message.meta?.clientMessageId === clientMessageId) ?? null;
      recordDebugEvent("chat.send.optimistic_created", { sequence: optimistic.sequence, attachmentCount: attachments.length, hasText: Boolean(text), clientMessageIdPresent: true, retry: Boolean(retried) });
      dispatch({ type: "message-optimistic", sessionId, message: optimistic });

      const submit = async () => {
        let uploadTarget: UploadTarget | null = null;
        try {
          // A reader keeps the Chat loading while the send waits, so leaving the screen does not strand it.
          void sessionLifecycleRef.current.open(sessionId);
          const ready = await waitForSendHistory(sessionId).finally(() => sessionLifecycleRef.current.close(sessionId));
          // The send lands after the newest Turn, so a detached window comes back to it first.
          const latestTurns = ready.hasMoreNewer ? (await loadLatestWindow(sessionId)).turns : [];
          const current = stateRef.current.sessionViews[sessionId] ?? ready;
          if (!row()) return;
          const spaceId = current.session?.spaceId ?? stateRef.current.sessions.find((item) => item.id === sessionId)?.spaceId;
          if (!spaceId) throw new Error(translate("data.chatContextUnavailable"));
          dispatch({
            type: "send-submit",
            sessionId,
            clientMessageId,
            turnSequence: nextTurnSequence([...latestTurns, ...current.turns], current.messages.filter((message) => !isAwaitingSubmit(message))),
            queuedFollowup: shouldQueueFollowup(current.turns, current.stream),
          });
          const submitted = row() ?? optimistic;
          void saveMessages(userKey, sessionId, [submitted]).catch(() => undefined);
          uploadTarget = { spaceId, sessionId };
          const target = uploadTarget;
          const content = await buildPromptContent(text, attachments, (attachment) => claimAttachmentUpload(attachmentUploads, target, attachment));
          const withContent = { ...(row() ?? submitted), content, text: text || submitted.text };
          dispatch({ type: "message-optimistic", sessionId, message: withContent });
          void saveMessages(userKey, sessionId, [withContent]).catch(() => undefined);
          // A Bot gets the message before it is written to the user's Chat, so one recorded there was always
          // delivered. A retry of a message that only failed to be recorded does not deliver it twice.
          if (options.relay && withContent.meta?.relayed !== true) {
            await options.relay(content);
            const relayed = { ...(row() ?? withContent), meta: { ...(row() ?? withContent).meta, relayed: true } };
            dispatch({ type: "message-optimistic", sessionId, message: relayed });
            void saveMessages(userKey, sessionId, [relayed]).catch(() => undefined);
          }
          const request = client.space(spaceId).prompt({
            // A note is recorded without a reply (a Bot's page writes the user's words this way).
            mode: options.note ? "note" : "agent",
            sessionId,
            content,
            // First-party app sessions belong to the Web App source bucket; request provenance still reports via=mobile.
            source: "web",
            clientMessageId,
            accessMode: "full_access",
            intent: "followup",
            schedule: { mode: "immediate" },
            ...(options.model ? { model: options.model.id, provider: options.model.provider } : {}),
            ...(options.harness ? { harness: options.harness } : {}),
            ...(options.model?.thinkingLevel ? { thinkingLevel: options.model.thinkingLevel } : {}),
            ...options.execution,
          });
          const upsert = (response: Awaited<typeof request>) => {
            if (response.mode !== "immediate") throw new Error(translate("data.messageNotAccepted"));
            recordDebugEvent("chat.send.server_accepted", { turnSequence: response.turn.sequence, status: response.turn.status });
            dispatch({ type: "turn-upsert", sessionId, session: response.session, turn: withFallbackUserContent(response.turn, content, text) });
          };
          const accepted = watchAcceptedTurn(sessionId, clientMessageId);
          const first = await Promise.race([request.then((response) => ({ response })), accepted.promise.then(() => null)]).finally(accepted.cancel);
          if (first) upsert(first.response);
          // The Turn is in; the late response only repeats it, and its failure no longer means anything.
          else void request.then(upsert).catch(() => undefined);
          dispatch({ type: "send-accepted", sessionId, clientMessageId });
          // The accepted Turn owns this message now; a leftover local row would come back as a failed send.
          void deleteMessages(userKey, sessionId, [optimistic.id]).catch(() => undefined);
          attachmentUploads?.forget(target, attachments);
          void queryClient.invalidateQueries();
        } catch (error) {
          const message = error instanceof Error ? error.message : translate("data.messageSendFailed");
          const pending = row() ?? optimistic;
          dispatch({ type: "send-failed", sessionId, clientMessageId, message });
          void saveMessages(userKey, sessionId, [failedSendMessage(pending, message)]).catch(() => undefined);
          if (uploadTarget) attachmentUploads?.unclaim(uploadTarget, attachments);
          throw error;
        }
      };
      // Queued before the failed row goes: removing it releases the lane, and the retry must already hold its place.
      const sent = sendQueueRef.current.enqueue(sessionId, { id: clientMessageId, order, run: submit });
      if (retried) {
        dispatch({ type: "send-discard", sessionId, messageId: retried.id });
        void deleteMessages(userKey, sessionId, [retried.id]).catch(() => undefined);
      }
      options.onOptimistic?.(row() ?? optimistic);
      // Only the new row: the table upserts, and the view snapshot can still hold rows removed since,
      // such as the failed send a retry just discarded.
      void saveMessages(userKey, sessionId, [row() ?? optimistic]).catch(() => undefined);
      await sent;
    },
    [attachmentUploads, client, dispatch, loadLatestWindow, queryClient, userKey, userUuid, stateRef, waitForSendHistory, watchAcceptedTurn],
  );

  useEffect(() => store.subscribe(({ state }) => releaseSettledFailures(sendQueueRef.current, state)), [store]);

  const discardFailedSend = useCallback((sessionId: string, messageId: string) => {
    const failed = stateRef.current.sessionViews[sessionId]?.messages.find((message) => message.id === messageId && isFailedSend(message));
    dispatch({ type: "send-discard", sessionId, messageId });
    void deleteMessages(userKey, sessionId, [messageId]).catch(() => undefined);
    const clientMessageId = failed?.meta?.clientMessageId;
    if (typeof clientMessageId === "string") sendQueueRef.current.release(sessionId, clientMessageId);
  }, [dispatch, userKey, stateRef]);

  const sendNewMessage = useCallback(
    async (
      spaceId: string,
      rawText: string,
      attachments: AttachmentDraft[] = [],
      options: { model?: ChatModelSelection | null; harness?: HarnessKind; execution?: LocalExecution; onOptimistic?: (message: MessageRecord) => void } = {},
    ) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const text = rawText.trim();
      if (!spaceId) throw new Error(translate("data.spaceRequired"));
      if (!text && attachments.length === 0) throw new Error(translate("data.messageEmpty"));

      // There is no Chat yet: the screen holds this bubble until the accepted Turn takes its place.
      const clientMessageId = newId();
      options.onOptimistic?.(optimisticSend({ sessionId: "", clientMessageId, text, attachments, model: options.model ?? null, harness: options.harness ?? null, authorUuid: userUuid, turnSequence: 1 }));
      const uploadTarget = { spaceId };
      // A failed send keeps its finished uploads for the retry from the composer.
      const unclaim = (error: unknown): never => {
        attachmentUploads?.unclaim(uploadTarget, attachments);
        throw error;
      };
      const content = await buildPromptContent(text, attachments, (attachment) => claimAttachmentUpload(attachmentUploads, uploadTarget, attachment)).catch(unclaim);
      const result = await client.space(spaceId).prompt({
        mode: "agent",
        content,
        source: "web",
        clientMessageId,
        accessMode: "full_access",
        intent: "followup",
        schedule: { mode: "immediate" },
        ...(options.model ? { model: options.model.id, provider: options.model.provider } : {}),
        ...(options.harness ? { harness: options.harness } : {}),
        ...(options.model?.thinkingLevel ? { thinkingLevel: options.model.thinkingLevel } : {}),
        ...options.execution,
      }).catch(unclaim);
      attachmentUploads?.forget(uploadTarget, attachments);
      if (result.mode !== "immediate" || !result.session) {
        throw new Error(translate("data.newChatNotCreated"));
      }

      const space = stateRef.current.spaces.find((item) => item.id === spaceId) ?? null;
      const session = {
        ...result.session,
        space: space
          ? {
              id: space.id,
              name: displaySpaceName(space),
              slug: space.slug,
              publicProfile: space.publicProfile ?? null,
            }
          : null,
      };
      const turn = withFallbackUserContent(result.turn, content, text);
      const messages = messagesFromTurns([turn]);
      const message = messages.find((item) => item.role === "user");
      if (!message) throw new Error(translate("data.newChatNotCreated"));
      dispatch({ type: "session-upsert", session });
      if (space) {
        dispatch({
          type: "session-success",
          sessionId: result.session.id,
          space,
          session: result.session,
          messages,
          turns: [turn],
          hasMoreOlder: false,
          hasMoreNewer: false,
          oldestCursor: turn.sequence,
          newestCursor: turn.sequence,
        });
      } else {
        dispatch({ type: "session-start", sessionId: result.session.id, session: result.session });
      }
      // Seed the accepted turn before the new-chat surface mounts. The reducer derives a
      // pending stream for active turns, so the first reply can continue in place without
      // a route transition or a blank loading screen.
      dispatch({ type: "turn-upsert", sessionId: result.session.id, session: result.session, turn });
      void saveSessions(userKey, [session]).catch(() => undefined);
      void saveMessages(userKey, result.session.id, messages).catch(() => undefined);
      void queryClient.invalidateQueries();
      return { session: result.session, turn, message };
    },
    [attachmentUploads, client, dispatch, queryClient, userKey, userUuid, stateRef],
  );

  const loadComposerDraftForUser = useCallback(
    (spaceId: string, scope: ComposerDraftScope) => loadLocalComposerDraft(userKey, spaceId, scope),
    [userKey],
  );

  const saveComposerDraftForUser = useCallback(
    (spaceId: string, scope: ComposerDraftScope, text: string) => saveLocalComposerDraft(userKey, spaceId, scope, text),
    [userKey],
  );

  const clearComposerDraftForUser = useCallback(
    (spaceId: string, scope: ComposerDraftScope, expected?: string) => expected === undefined ? clearLocalComposerDraft(userKey, spaceId, scope) : clearLocalComposerDraftIf(userKey, spaceId, scope, expected),
    [userKey],
  );

  const createSpace = useCallback(
    async (name: string, description?: string, options: { onDevice?: boolean } = {}) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(translate("data.spaceNameRequired"));
      const result = await client.spaces.create({
        name: trimmedName,
        description: description?.trim() || null,
        source: "mobile",
        ...(options.onDevice ? { config: { sandbox: { provider: "local" as const } } } : {}),
      });
      dispatch({ type: "space-upsert", space: result.space });
      void saveSpaces(userKey, [result.space]).catch(() => undefined);
      return result.space;
    },
    [client, dispatch, userKey],
  );

  const refreshSpacePin = useCallback(async (spaceId: string) => {
    if (!client) throw new Error(translate("data.stillConnecting"));
    const currentBeforeRequest = stateRef.current.spaces.find((space) => space.id === spaceId);
    if (spacePinPendingMutationsRef.current.has(spaceId)) return currentBeforeRequest?.isPinned ?? false;
    const requestVersion = spacePinMutationVersionsRef.current.get(spaceId) ?? 0;
    const pinned = await getResourcePinState(client, "space", spaceId, { force: true });
    if (spacePinPendingMutationsRef.current.has(spaceId)) {
      return stateRef.current.spaces.find((space) => space.id === spaceId)?.isPinned ?? pinned;
    }
    if ((spacePinMutationVersionsRef.current.get(spaceId) ?? 0) !== requestVersion) {
      return stateRef.current.spaces.find((space) => space.id === spaceId)?.isPinned ?? pinned;
    }
    const current = stateRef.current.spaces.find((space) => space.id === spaceId);
    if (current) {
      const next = { ...current, isPinned: pinned };
      dispatch({ type: "space-upsert", space: next });
      void saveSpaces(userKey, [next]).catch(() => undefined);
    }
    return pinned;
  }, [client, dispatch, userKey, stateRef]);

  const toggleSpacePin = useCallback(async (spaceId: string) => {
    if (!client) throw new Error(translate("data.stillConnecting"));
    const mutationVersion = ++spacePinMutationSequenceRef.current;
    spacePinMutationVersionsRef.current.set(spaceId, mutationVersion);
    spacePinPendingMutationsRef.current.set(spaceId, mutationVersion);
    let current: SpaceRecord | null = null;
    let wasPinned = false;
    try {
      current = stateRef.current.spaces.find((space) => space.id === spaceId) ?? null;
      wasPinned = current?.isPinned ?? await getResourcePinState(client, "space", spaceId, { force: true });
      if ((spacePinMutationVersionsRef.current.get(spaceId) ?? 0) !== mutationVersion) {
        return stateRef.current.spaces.find((space) => space.id === spaceId)?.isPinned ?? wasPinned;
      }
      if (current) dispatch({ type: "space-upsert", space: { ...current, isPinned: !wasPinned } });
      const pinned = await toggleResourcePin(client, "space", spaceId, wasPinned);
      if ((spacePinMutationVersionsRef.current.get(spaceId) ?? 0) !== mutationVersion) {
        return stateRef.current.spaces.find((space) => space.id === spaceId)?.isPinned ?? pinned;
      }
      const latest = stateRef.current.spaces.find((space) => space.id === spaceId) ?? current;
      if (latest) {
        const next = { ...latest, isPinned: pinned };
        dispatch({ type: "space-upsert", space: next });
        void saveSpaces(userKey, [next]).catch(() => undefined);
      }
      return pinned;
    } catch (error) {
      if ((spacePinMutationVersionsRef.current.get(spaceId) ?? 0) !== mutationVersion) {
        return stateRef.current.spaces.find((space) => space.id === spaceId)?.isPinned ?? !wasPinned;
      }
      if (current) dispatch({ type: "space-upsert", space: current });
      throw error;
    } finally {
      if (spacePinPendingMutationsRef.current.get(spaceId) === mutationVersion) {
        spacePinPendingMutationsRef.current.delete(spaceId);
      }
    }
  }, [client, dispatch, userKey, stateRef]);

  useEffect(() => {
    if (!client) return;
    return client.onUserEvent((event) => {
      if (event.type !== "label.assignments.updated") return;
      const payload = event.payload as {
        resourceType?: unknown;
        resourceRef?: unknown;
        assignments?: unknown;
      };
      if (payload.resourceType !== "space" || typeof payload.resourceRef !== "string" || !Array.isArray(payload.assignments)) return;
      const current = stateRef.current.spaces.find((space) => space.id === payload.resourceRef);
      if (!current) return;
      const pinned = isResourcePinned(payload.assignments as { labelSystemKey?: string | null }[]);
      const next = { ...current, isPinned: pinned };
      dispatch({ type: "space-upsert", space: next });
      void saveSpaces(userKey, [next]).catch(() => undefined);
    });
  }, [client, dispatch, userKey, stateRef]);

  const upsertSpace = useCallback((space: SpaceRecord) => {
    const cachedSessions = stateRef.current.sessions;
    dispatch({ type: "space-upsert", space });
    void saveSpaces(userKey, [space]).catch(() => undefined);
    const sessions = applySpaceToSessionSummaries(cachedSessions, space);
    if (sessions !== cachedSessions) {
      void saveSessions(userKey, sessions.filter((session) => session.space?.id === space.id)).catch(() => undefined);
    }
  }, [dispatch, stateRef, userKey]);

  const forkSession = useCallback(async (spaceId: string, sessionId: string, turn: Pick<SessionTurnRecord, "id" | "sourceTurnId">) => {
    if (!client) throw new Error(translate("data.stillConnecting"));
    const result = await forkSessionTurn(client, spaceId, sessionId, turn);
    const parent = stateRef.current.sessions.find((item) => item.id === sessionId);
    const session = { ...result.session, space: parent?.space ?? null };
    const fork: SessionListFork = { ...result.fork, parentTitle: parent?.title ?? null, firstUserTextAfterFork: null };
    dispatch({ type: "session-upsert", session });
    dispatch({ type: "session-forks", forks: [fork] });
    void saveSessions(userKey, [session], [fork]).catch(() => undefined);
    void queryClient.invalidateQueries();
    return result.session;
  }, [client, dispatch, queryClient, userKey, stateRef]);

  const rememberSessionForks = useCallback((forks: SessionListFork[]) => {
    if (forks.length === 0) return;
    dispatch({ type: "session-forks", forks });
    void saveSessions(userKey, [], forks).catch(() => undefined);
  }, [dispatch, userKey]);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const view = stateRef.current.sessionViews[sessionId];
      const summary = stateRef.current.sessions.find((item) => item.id === sessionId);
      const spaceId = view?.session?.spaceId ?? summary?.spaceId;
      if (!spaceId) throw new Error(translate("data.chatContextUnavailable"));
      const result = await client.space(spaceId).session(sessionId).rename(title.trim() || null);
      dispatch({ type: "session-upsert", session: { ...result.session, space: summary?.space ?? null } });
      const currentView = stateRef.current.sessionViews[sessionId];
      if (currentView) dispatch({ type: "session-meta", sessionId, session: result.session, space: currentView.space });
      void queryClient.invalidateQueries();
    },
    [client, dispatch, queryClient, stateRef],
  );

  const setSessionArchived = useCallback(
    async (target: SessionRecord & { space?: UserSessionListItem["space"] }, archived: boolean) => {
      if (!client) throw new Error(translate("data.stillConnecting"));
      const sessionId = target.id;
      const previousView = stateRef.current.sessionViews[sessionId];
      const previousSummary = stateRef.current.sessions.find((item) => item.id === sessionId);
      const viewSpace = previousView?.space;
      const space = previousSummary?.space ?? target.space ?? (viewSpace ? { id: viewSpace.id, name: displaySpaceName(viewSpace), slug: viewSpace.slug, publicProfile: viewSpace.publicProfile ?? null } : null);
      const apply = (session: SessionRecord) => {
        dispatch({ type: "session-upsert", session: { ...session, space } });
        if (stateRef.current.sessionViews[sessionId]?.session) dispatch({ type: "session-meta", sessionId, session, space: stateRef.current.sessionViews[sessionId]?.space });
      };
      const base = previousView?.session ?? previousSummary ?? target;
      const stamp = archived ? new Date().toISOString() : null;
      apply({ ...base, archivedAt: stamp });
      // Archiving moves a Chat between these lists either way, so it leaves the one it is in; the refetch below settles them.
      queryClient.setQueriesData<{ sessions?: UserSessionListItem[]; items?: UserSessionListItem[] }>(
        { predicate: (query) => { const key = String(query.queryKey[0]); return key.startsWith("chats:source:") || key.endsWith(":chat-panel") || key.endsWith(":archived-chats"); } },
        (data) => data && {
          ...data,
          ...(data.sessions ? { sessions: data.sessions.filter((item) => item.id !== sessionId) } : {}),
          ...(data.items ? { items: data.items.filter((item) => item.id !== sessionId) } : {}),
        },
      );
      try {
        const sessionClient = client.space(target.spaceId).session(sessionId);
        const result = await (archived ? sessionClient.archive() : sessionClient.unarchive());
        const session = result.session.archivedAt === undefined ? { ...result.session, archivedAt: stamp } : result.session;
        apply(session);
        void saveSessions(userKey, [{ ...session, space }]).catch(() => undefined);
      } catch (error) {
        dispatch({ type: "session-upsert", session: previousSummary ?? { ...base, space } });
        if (previousView?.session) dispatch({ type: "session-meta", sessionId, session: previousView.session, space: previousView.space });
        throw error;
      } finally {
        void queryClient.invalidateQueries();
      }
    },
    [client, dispatch, queryClient, stateRef, userKey],
  );

  const loadSessionReadSequenceForUser = useCallback(
    (sessionId: string) => loadSessionReadSequence(userKey, sessionId),
    [userKey],
  );

  const saveSessionReadSequenceForUser = useCallback(
    (sessionId: string, sequence: number) => saveSessionReadSequence(userKey, sessionId, sequence),
    [userKey],
  );

  const clearCache = useCallback(async () => {
    homeRefreshGenerationRef.current += 1;
    statusGenerationRef.current += 1;
    for (const controller of runningDiscoveryControllers.current.values()) controller.abort();
    runningDiscoveryControllers.current.clear();
    runningDiscoveryRequests.current.clear();
    statusSessionsRef.current.clear();
    resetSpaceList();
    await clearUserCache(userKey);
    // A fresh baseline keeps every cleared Chat read instead of marking them all unread.
    await reloadSessionSeen().catch(() => undefined);
    paginationRequestsRef.current.clear();
    spacePinMutationVersionsRef.current.clear();
    spacePinPendingMutationsRef.current.clear();
    store.setState({ state: { ...initialState, booting: false, refreshing: false } });
    void queryClient.resetQueries();
  }, [queryClient, reloadSessionSeen, resetSpaceList, store, userKey]);

  const actions = useMemo<AppActions>(
    () => ({
      client,
      userUuid,
      userKey,
      spaceRealtime,
      refreshChats,
      discoverRunningSessions,
      requestRunningSessions,
      releaseRunningSessions,
      installationId,
      getAccessToken,
      refreshHome,
      refreshSessionStatuses,
      loadMoreSessions,
      openSession,
      prefetchSession,
      closeSession,
      refreshSession,
      loadOlderTurns,
      loadNewerTurns,
      loadTurnIndex,
      jumpToTurn,
      loadLatestTurns,
      sendMessage,
      sendNewMessage,
      discardFailedSend,
      loadComposerDraft: loadComposerDraftForUser,
      saveComposerDraft: saveComposerDraftForUser,
      clearComposerDraft: clearComposerDraftForUser,
      abortSession,
      loadModels,
      loadModelStatus,
      loadSpaceOverview,
      recordSpaceVisit,
      createSpace,
      refreshSpacePin,
      toggleSpacePin,
      upsertSpace,
      renameSession,
      setSessionArchived,
      forkSession,
      rememberSessionForks,
      clearCache,
      applyCacheRetention,
      loadSessionReadSequence: loadSessionReadSequenceForUser,
      saveSessionReadSequence: saveSessionReadSequenceForUser,
      markSessionSeen,
      markSessionUnread,
      markAllSessionsSeen,
      prepareAttachments: (target, attachments) => attachmentUploads?.prepare(target, attachments),
      releaseAttachments: (target, attachments) => attachmentUploads?.release(target, attachments),
      attachmentUploadState: (target, attachment) => attachmentUploads?.state(target, attachment) ?? null,
      subscribeAttachmentUploads: (listener) => attachmentUploads?.subscribe(listener) ?? (() => undefined),
    }),
    [
      attachmentUploads,
      markSessionSeen,
      markSessionUnread,
      markAllSessionsSeen,
      spaceRealtime,
      refreshChats,
      discoverRunningSessions,
      requestRunningSessions,
      releaseRunningSessions,
      abortSession,
      applyCacheRetention,
      clearCache,
      client,
      loadSessionReadSequenceForUser,
      saveSessionReadSequenceForUser,
      closeSession,
      createSpace,
      getAccessToken,
      refreshSpacePin,
      toggleSpacePin,
      installationId,
      jumpToTurn,
      loadLatestTurns,
      loadModelStatus,
      loadModels,
      loadSpaceOverview,
      recordSpaceVisit,
      loadMoreSessions,
      loadNewerTurns,
      loadOlderTurns,
      loadTurnIndex,
      openSession,
      prefetchSession,
      refreshHome,
      refreshSessionStatuses,
      refreshSession,
      renameSession,
      setSessionArchived,
      forkSession,
      rememberSessionForks,
      sendMessage,
      sendNewMessage,
      discardFailedSend,
      loadComposerDraftForUser,
      saveComposerDraftForUser,
      clearComposerDraftForUser,
      upsertSpace,
      userUuid,
      userKey,
    ],
  );

  return <QueryClientProvider client={queryClient}><AppActionsContext.Provider value={actions}><AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider></AppActionsContext.Provider></QueryClientProvider>;
}

function useAppStore() {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error(translate("data.useAppProvider"));
  return store;
}

export function useAppActions() {
  const actions = useContext(AppActionsContext);
  if (!actions) throw new Error(translate("data.useAppProvider"));
  return actions;
}

export function shallowEqual<T>(a: T, b: T) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

/** Holds the last committed selection so a new selector (inline closures change per render) can reuse an equal value. */
function createSelectionCache<T>() {
  let committed: { value: T } | null = null;
  return {
    reader(selector: (snapshot: AppSnapshot) => T, isEqual: (a: T, b: T) => boolean) {
      let memo: { snapshot: AppSnapshot; value: T } | null = null;
      return (snapshot: AppSnapshot) => {
        if (memo?.snapshot === snapshot) return memo.value;
        const next = selector(snapshot);
        const previous = memo ?? committed;
        const value = previous && isEqual(previous.value, next) ? previous.value : next;
        memo = { snapshot, value };
        return value;
      };
    },
    commit(value: T) {
      committed = { value };
    },
  };
}

/**
 * Subscribes to one derived slice of the app snapshot. The component re-renders only when
 * `isEqual` rejects the new selection; an equal selection keeps the previous reference, so
 * object-returning selectors stay stable with `shallowEqual`. Selectors run on every store
 * update, so keep them cheap and move heavy derivation into `useMemo` over the selected inputs.
 */
export function useAppSelector<T>(selector: (snapshot: AppSnapshot) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useAppStore();
  const [cache] = useState(() => createSelectionCache<T>());
  const getSelection = useMemo(() => cache.reader(selector, isEqual), [cache, isEqual, selector]);
  const value = useStore(store, getSelection);
  useLayoutEffect(() => {
    cache.commit(value);
  }, [cache, value]);
  return value;
}

/** Latest committed state for event handlers and callbacks that must not subscribe. */
export function useAppStateGetter() {
  const store = useAppStore();
  return useCallback(() => store.getState().state, [store]);
}

/** The main Chat body tracks only the stream's identity and phase; token content stays in `useSessionStream`. */
export type SessionViewSummary = Omit<SessionView, "stream"> & { stream: Pick<StreamView, "status" | "turnId"> | null };

const LOADING_VIEW: SessionViewSummary = { ...emptyView(), loading: true };
/** A new Chat before the server creates it: nothing to load. */
const NEW_CHAT_VIEW: SessionViewSummary = emptyView();

function summarizeSessionView(view: SessionView | undefined): SessionViewSummary {
  if (!view) return LOADING_VIEW;
  const { stream, ...rest } = view;
  return { ...rest, stream: stream ? { status: stream.status, turnId: stream.turnId } : null };
}

function sameSessionViewSummary(a: SessionViewSummary, b: SessionViewSummary) {
  if (a === b) return true;
  const { stream: left, ...leftRest } = a;
  const { stream: right, ...rightRest } = b;
  return shallowEqual(leftRest, rightRest) && left?.status === right?.status && left?.turnId === right?.turnId && !left === !right;
}

export function useSession(sessionId: string, options?: SessionOpenOptions) {
  const { openSession, closeSession } = useAppActions();
  const notesOnly = options?.notesOnly === true;
  // Layout so a press-in prefetch can land in sessionViews before the first paint.
  useLayoutEffect(() => {
    // "" is a new Chat the server has not created yet.
    if (!sessionId) return;
    void openSession(sessionId, { notesOnly });
    return () => closeSession(sessionId);
  }, [closeSession, notesOnly, openSession, sessionId]);
  return useAppSelector((app) => (sessionId ? summarizeSessionView(app.state.sessionViews[sessionId]) : NEW_CHAT_VIEW), sameSessionViewSummary);
}

/** The open Chat's live stream; changes on every token batch, so subscribe from the smallest component. */
export function useSessionStream(sessionId: string) {
  return useAppSelector((app) => app.state.sessionViews[sessionId]?.stream ?? null);
}

function sameViewHistories(a: Record<string, SessionView>, b: Record<string, SessionView>) {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && a[key]!.session === b[key]!.session && a[key]!.turns === b[key]!.turns);
}

/** Latest own-Turn time per Space from loaded Chats; ignores stream batches, which never change turn history. */
export function usePersonalSpaceActivity(userUuid: string) {
  // Equal selections keep the previous map, whose sessions and turns are the ones read below.
  const views = useAppSelector((app) => app.state.sessionViews, sameViewHistories);
  return useMemo(() => personalSpaceActivity(Object.values(views), userUuid), [userUuid, views]);
}

/** Reads the catalog `loadModels`/`loadModelStatus` fill; it never fetches on its own. */
export function useModelCatalog() {
  const models = useQuery<ChatModelCatalogItem[]>({ queryKey: MODELS_KEY, enabled: false });
  const status = useQuery<ModelStatusResponse | null>({ queryKey: MODEL_STATUS_KEY, enabled: false });
  return {
    models: models.data ?? [],
    modelsLoading: models.isFetching,
    modelsError: models.error ? errorMessage(models.error, "Unable to load models") : null,
    modelStatus: status.data ?? null,
    modelStatusLoading: status.isFetching,
    modelStatusError: status.error ? errorMessage(status.error, "Unable to load model status") : null,
  };
}

/** Recent Space visits and the server overview; refreshes while mounted when `enabled`. */
export function useSpaceList(options: { enabled?: boolean; intervalMs?: number } = {}) {
  const { loadSpaceOverview } = useAppActions();
  const { spaceVisits, spaceVisitsError } = useAppSelector((app) => ({ spaceVisits: app.spaceVisits, spaceVisitsError: app.spaceVisitsError }), shallowEqual);
  return useSpaceListQuery(loadSpaceOverview, spaceVisits, spaceVisitsError, options.enabled ?? true, options.intervalMs);
}
