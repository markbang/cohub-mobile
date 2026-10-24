import type { RealtimeSessionFork, SessionListFork, SessionRecord } from "@neta-art/cohub";

export type SessionForks = Record<string, SessionListFork>;

/** Deeper forks flatten into the third level, keeping titles wide on a phone. */
export const SESSION_TREE_MAX_DEPTH = 3;
/** A collapsed group shows its most recent forks plus any `keep` matches. */
export const SESSION_TREE_PREVIEW = 2;

export type SessionTreePosition = {
  depth: number;
  rails: boolean[];
  hasChildren: boolean;
  last: boolean;
  lastInGroup: boolean;
};

export type SessionTreeRow<T> = {
  session: T;
  fork: SessionListFork | null;
  tree: SessionTreePosition;
};

export type SessionTreeToggle = { rootId: string; hidden: number; expanded: boolean };

export type SessionTreeEntry<T> = ({ type: "row" } & SessionTreeRow<T>) | ({ type: "toggle" } & SessionTreeToggle);

export type SessionTreeOptions<T> = {
  expanded?: ReadonlySet<string>;
  keep?: (session: T) => boolean;
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

/**
 * Realtime creation events carry only the lineage, never titles. The edge nests a new fork
 * until the next list read replaces it with the full record; a known edge is never downgraded.
 */
export function realtimeSessionFork(current: SessionForks, spaceId: string, fork: RealtimeSessionFork, parentTitle: string | null): SessionListFork | null {
  if (current[fork.childSessionId]) return null;
  const parent = current[fork.parentSessionId];
  return {
    id: `realtime:${fork.childSessionId}`,
    spaceId,
    childSessionId: fork.childSessionId,
    parentSessionId: fork.parentSessionId,
    rootSessionId: parent?.rootSessionId ?? fork.parentSessionId,
    depth: fork.depth,
    anchorSourceSessionId: fork.parentSessionId,
    anchorTurnId: "",
    anchorSequence: fork.anchorSequence,
    ancestorSessionIds: [...(parent?.ancestorSessionIds ?? []), fork.parentSessionId],
    sessionPath: [],
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    parentTitle,
    firstUserTextAfterFork: null,
  };
}

function activityTime(session: TreeSession) {
  return new Date(session.lastMessageAt ?? session.updatedAt ?? 0).getTime();
}

type Node<T> = { session: T; parent: Node<T> | null; depth: number };

export function buildSessionForkTree<T extends TreeSession>(sessions: readonly T[], forks: SessionForks, options: SessionTreeOptions<T> = {}): SessionTreeEntry<T>[] {
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

  const entries: SessionTreeEntry<T>[] = [];
  const placed = new Set<string>();
  const collect = (session: T, parent: Node<T> | null, nodes: Node<T>[]) => {
    if (placed.has(session.id)) return;
    placed.add(session.id);
    const node: Node<T> = { session, parent, depth: parent ? parent.depth + 1 : 0 };
    nodes.push(node);
    for (const kid of [...(children.get(session.id) ?? [])].sort(byGroupTime)) collect(kid, node, nodes);
  };
  const emitGroup = (root: T) => {
    const nodes: Node<T>[] = [];
    collect(root, null, nodes);
    if (nodes.length === 0) return;
    const descendants = nodes.slice(1);
    const expanded = options.expanded?.has(root.id) ?? false;
    // Hiding a single fork behind a toggle saves nothing, so small groups stay open.
    const collapsible = descendants.length > SESSION_TREE_PREVIEW + 1;
    let shown = nodes;
    if (collapsible && !expanded) {
      const visible = new Set<Node<T>>([nodes[0]!]);
      const reveal = (node: Node<T>) => { for (let current: Node<T> | null = node; current; current = current.parent) visible.add(current); };
      [...descendants].sort((a, b) => activityTime(b.session) - activityTime(a.session)).slice(0, SESSION_TREE_PREVIEW).forEach(reveal);
      if (options.keep) for (const node of descendants) if (options.keep(node.session)) reveal(node);
      shown = nodes.filter((node) => visible.has(node));
    }
    const rows = layoutGroup(shown, forks);
    entries.push(...rows.map((row) => ({ type: "row" as const, ...row })));
    if (collapsible) {
      rows[rows.length - 1]!.tree.lastInGroup = false;
      entries.push({ type: "toggle", rootId: root.id, hidden: nodes.length - shown.length, expanded });
    }
  };
  for (const root of [...roots].sort(byGroupTime)) emitGroup(root);
  for (const session of sessions) if (!placed.has(session.id)) emitGroup(session);
  return entries;
}

function layoutGroup<T extends TreeSession>(nodes: readonly Node<T>[], forks: SessionForks): SessionTreeRow<T>[] {
  const depths = nodes.map((node) => Math.min(node.depth, SESSION_TREE_MAX_DEPTH));
  const visualParent = depths.map((depth, index) => {
    for (let previous = index - 1; previous >= 0; previous--) if (depths[previous] === depth - 1) return previous;
    return -1;
  });
  const isLast = depths.map((depth, index) => {
    for (let next = index + 1; next < depths.length; next++) {
      if (depths[next]! < depth) return true;
      if (depths[next] === depth && visualParent[next] === visualParent[index]) return false;
    }
    return true;
  });
  return nodes.map((node, index) => {
    const depth = depths[index]!;
    const rails: boolean[] = [];
    for (let ancestor = visualParent[index]!; ancestor > 0 && depths[ancestor]! >= 1; ancestor = visualParent[ancestor]!) rails.unshift(!isLast[ancestor]);
    return {
      session: node.session,
      fork: forks[node.session.id] ?? null,
      tree: { depth, rails, hasChildren: depths[index + 1] === depth + 1, last: isLast[index]!, lastInGroup: index === nodes.length - 1 },
    };
  });
}
