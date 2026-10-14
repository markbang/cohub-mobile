import type { SessionListFork, SessionRecord } from "@neta-art/cohub";

export type SessionForks = Record<string, SessionListFork>;

export type SessionTreePosition = {
  depth: 0 | 1;
  hasChildren: boolean;
  lastInGroup: boolean;
};

export type SessionTreeRow<T> = {
  session: T;
  fork: SessionListFork | null;
  tree: SessionTreePosition;
};

type TreeSession = Pick<SessionRecord, "id" | "lastMessageAt" | "updatedAt">;

/** Server edges replace cached ones because visibility redaction can change. */
export function mergeSessionForks(current: SessionForks, incoming: readonly SessionListFork[] | undefined): SessionForks {
  const changed = (incoming ?? []).filter((fork) => {
    const known = current[fork.childSessionId];
    return !known || JSON.stringify(known) !== JSON.stringify(fork);
  });
  if (changed.length === 0) return current;
  const next = { ...current };
  for (const fork of changed) next[fork.childSessionId] = fork;
  return next;
}

function activityTime(session: TreeSession) {
  return new Date(session.lastMessageAt ?? session.updatedAt ?? 0).getTime();
}

/** Mirrors the web mobile list: one indent level, groups ordered by their latest member. */
export function buildSessionForkTree<T extends TreeSession>(sessions: readonly T[], forks: SessionForks): SessionTreeRow<T>[] {
  const listed = new Set(sessions.map((session) => session.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const session of sessions) {
    const parentId = forks[session.id]?.parentSessionId;
    if (!parentId || parentId === session.id || !listed.has(parentId)) {
      roots.push(session);
      continue;
    }
    const siblings = children.get(parentId);
    if (siblings) siblings.push(session);
    else children.set(parentId, [session]);
  }

  const groupTimes = new Map<string, number>();
  const groupTime = (session: T, trail: Set<string>): number => {
    const cached = groupTimes.get(session.id);
    if (cached !== undefined) return cached;
    let time = activityTime(session);
    if (!trail.has(session.id)) {
      trail.add(session.id);
      for (const child of children.get(session.id) ?? []) time = Math.max(time, groupTime(child, trail));
      trail.delete(session.id);
    }
    groupTimes.set(session.id, time);
    return time;
  };
  const byGroupTime = (a: T, b: T) => groupTime(b, new Set()) - groupTime(a, new Set());

  const rows: SessionTreeRow<T>[] = [];
  const placed = new Set<string>();
  const append = (session: T, depth: number) => {
    if (placed.has(session.id)) return;
    placed.add(session.id);
    const kids = [...(children.get(session.id) ?? [])].sort(byGroupTime);
    rows.push({ session, fork: forks[session.id] ?? null, tree: { depth: depth > 0 ? 1 : 0, hasChildren: depth === 0 && kids.length > 0, lastInGroup: false } });
    for (const kid of kids) append(kid, depth + 1);
  };
  for (const root of [...roots].sort(byGroupTime)) append(root, 0);
  for (const session of sessions) append(session, 0);
  rows.forEach((row, index) => { row.tree.lastInGroup = rows[index + 1]?.tree.depth !== 1; });
  return rows;
}
