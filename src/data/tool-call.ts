/** One-line caption budget. Longer values are truncated before normalization. */
const PREVIEW_LIMIT = 400;

const PREFERRED_INPUT_KEYS = [
  "command",
  "skill",
  "skill_name",
  "query",
  "url",
  "path",
  "file_path",
  "pattern",
  "name",
  "description",
  "text",
  "content",
] as const;

function asPreviewText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Cap before normalizing: a large tool input (file contents, search text) would otherwise
  // pay a full whitespace pass per render, and the caption calls this twice.
  const text = value.slice(0, PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
  return text || null;
}

function commandPreview(value: unknown): string | null {
  const direct = asPreviewText(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return asPreviewText(record.preview) ?? asPreviewText(record.command);
}

export function toolCallPreview(name: string, input?: Record<string, unknown> | null) {
  if (!input) return "";
  const tool = name.trim().toLowerCase();
  if (tool === "bash" || tool === "terminal" || tool === "shell" || tool.includes("command")) {
    const command = commandPreview(input.command);
    if (command) return command;
  }
  for (const key of PREFERRED_INPUT_KEYS) {
    if (key === "command") {
      const command = commandPreview(input.command);
      if (command) return command;
      continue;
    }
    const value = asPreviewText(input[key]);
    if (value) return value;
  }
  const strings = Object.values(input).map(asPreviewText).filter((value): value is string => Boolean(value));
  if (strings.length === 1) return strings[0]!;
  try {
    const json = JSON.stringify(input);
    return json === "{}" ? "" : json.slice(0, PREVIEW_LIMIT).replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

export function formatToolCallCaption(name: string, input?: Record<string, unknown> | null) {
  const preview = toolCallPreview(name, input);
  return preview ? `${name}: "${preview}"` : name;
}

/** What a tool does, named for the row's verb; `other` keeps the tool's own name. */
export type ToolKind = "run" | "read" | "write" | "edit" | "search" | "find" | "list" | "fetch" | "skill" | "other";

export type LineDelta = { added: number; removed: number };

export type DiffLine = { sign: " " | "-" | "+"; text: string };

/** A tool call as its row draws it: a verb, the one thing it acts on, and its line delta when it changes a file. */
export type ToolCallSummary = { kind: ToolKind; target: string; path: string | null; delta: LineDelta | null };

/** Lines of unchanged context kept either side of an edit's change. */
const DIFF_CONTEXT = 3;

export function toolKind(name: string): ToolKind {
  const key = name.trim().toLowerCase();
  if (key.includes("skill")) return "skill";
  if (key.includes("bash") || key.includes("terminal") || key.includes("shell") || key.includes("command")) return "run";
  if (key.includes("edit") || key.includes("patch")) return "edit";
  if (key.includes("write")) return "write";
  if (key.includes("read")) return "read";
  if (key.includes("grep") || key.includes("search")) return "search";
  if (key.includes("find") || key.includes("glob")) return "find";
  if (key === "ls" || key.includes("list")) return "list";
  if (key.includes("web") || key.includes("fetch") || key.includes("http")) return "fetch";
  return "other";
}

/** Sandbox paths are absolute under `/workspace`; the Space's own files read better without it. */
export function workspacePath(path: string) {
  return path.startsWith("/workspace/") ? path.slice("/workspace/".length) || path : path;
}

function inputPath(input: Record<string, unknown>) {
  const value = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : null;
  return value?.trim() ? workspacePath(value.trim()) : null;
}

function fileName(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

function lines(value: string) {
  return value.length === 0 ? [] : value.split("\n");
}

type Edit = { oldText: string; newText: string };

export function toolEdits(input: Record<string, unknown> | null | undefined): Edit[] {
  const edits = input?.edits;
  if (Array.isArray(edits)) return edits.filter((edit): edit is Edit => typeof edit === "object" && edit !== null && typeof edit.oldText === "string" && typeof edit.newText === "string");
  return typeof input?.oldText === "string" && typeof input.newText === "string" ? [{ oldText: input.oldText, newText: input.newText }] : [];
}

/**
 * An edit as a unified diff. A replacement repeats the lines around its change, so the shared head
 * and tail become context, trimmed to a few lines either side.
 */
export function editDiffLines(oldText: string, newText: string): DiffLine[] {
  const before = lines(oldText);
  const after = lines(newText);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  const context = (values: string[]): DiffLine[] => values.map((text) => ({ sign: " ", text }));
  return [
    ...context(before.slice(Math.max(0, head - DIFF_CONTEXT), head)),
    ...before.slice(head, before.length - tail).map((text): DiffLine => ({ sign: "-", text })),
    ...after.slice(head, after.length - tail).map((text): DiffLine => ({ sign: "+", text })),
    ...context(before.slice(before.length - tail, before.length - tail + DIFF_CONTEXT)),
  ];
}

function diffDelta(diff: readonly DiffLine[]): LineDelta {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.sign === "+") added += 1;
    else if (line.sign === "-") removed += 1;
  }
  return { added, removed };
}

function toolDelta(kind: ToolKind, input: Record<string, unknown>): LineDelta | null {
  if (kind === "write") return typeof input.content === "string" ? { added: lines(input.content).length, removed: 0 } : null;
  const edits = toolEdits(input);
  if (kind !== "edit" || edits.length === 0) return null;
  return edits.reduce<LineDelta>((total, edit) => {
    const delta = diffDelta(editDiffLines(edit.oldText, edit.newText));
    return { added: total.added + delta.added, removed: total.removed + delta.removed };
  }, { added: 0, removed: 0 });
}

export function summarizeToolCall(name: string, input?: Record<string, unknown> | null): ToolCallSummary {
  const kind = toolKind(name);
  const record = input ?? {};
  const path = kind === "read" || kind === "write" || kind === "edit" || kind === "list" ? inputPath(record) : null;
  const pattern = kind === "search" || kind === "find" ? asPreviewText(record.pattern) ?? asPreviewText(record.query) : null;
  // A file is named by its file name; the full path is in the details and the spoken label.
  const target = path ? kind === "list" ? path : fileName(path) : pattern ?? toolCallPreview(name, record);
  return { kind, target, path, delta: toolDelta(kind, record) };
}

/** The input a tool call's details show: its main line, the diff or body it writes, and whatever input is left. */
export function toolInputDetails(name: string, input?: Record<string, unknown> | null) {
  const record = input ?? {};
  const kind = toolKind(name);
  const used = new Set<string>();
  let primary: string | null = null;
  if (kind === "run") {
    const command = commandPreview(record.command);
    if (command) {
      primary = `$ ${typeof record.command === "string" ? record.command : command}`;
      used.add("command");
    }
  } else if (kind === "read" || kind === "write" || kind === "edit" || kind === "list") {
    primary = inputPath(record);
    if (primary) used.add(typeof record.path === "string" ? "path" : "file_path");
  }
  const edits = kind === "edit" ? toolEdits(record) : [];
  if (edits.length) for (const key of ["edits", "oldText", "newText"]) used.add(key);
  const body = kind === "write" && typeof record.content === "string" ? record.content : null;
  if (body !== null) used.add("content");
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !used.has(key)));
  return { primary, diffs: edits.map((edit) => editDiffLines(edit.oldText, edit.newText)), body, rest: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : null };
}

/** Diff lines grouped into runs of one sign, so a renderer draws each run as one block. */
export function diffRuns(diff: readonly DiffLine[]) {
  const runs: { sign: DiffLine["sign"]; text: string }[] = [];
  for (const line of diff) {
    const last = runs.at(-1);
    const text = `${line.sign} ${line.text}`;
    if (last && last.sign === line.sign) last.text += `\n${text}`;
    else runs.push({ sign: line.sign, text });
  }
  return runs;
}

type ToolBlock = { type: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean };

/** The files a run of steps wrote or edited, in first-touched order, with their summed line deltas. Failed calls changed nothing. */
export function changedFiles(blocks: readonly ToolBlock[]): { path: string; name: string; delta: LineDelta }[] {
  const failed = new Set<string>();
  for (const block of blocks) if (block.type === "tool_result" && block.is_error && block.tool_use_id) failed.add(block.tool_use_id);
  const files = new Map<string, LineDelta>();
  for (const block of blocks) {
    if (block.type !== "tool_use" || !block.name || (block.id && failed.has(block.id))) continue;
    const summary = summarizeToolCall(block.name, block.input);
    if (!summary.path || !summary.delta) continue;
    const total = files.get(summary.path) ?? { added: 0, removed: 0 };
    files.set(summary.path, { added: total.added + summary.delta.added, removed: total.removed + summary.delta.removed });
  }
  return [...files].map(([path, delta]) => ({ path, name: fileName(path), delta }));
}
