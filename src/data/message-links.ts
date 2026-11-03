/**
 * Origins serving the Cohub web app, as a group-free RegExp source. cohub.live is
 * primary; cohub.run links from before the domain migration still resolve. Kept in
 * sync with space-mentions.ts, which parses the same links in the composer.
 */
export const COHUB_WEB_ORIGIN_SOURCE = "(?:https?:\\/\\/(?:dev\\.|www\\.)?cohub\\.(?:live|run)|https?:\\/\\/localhost(?::\\d+)?)";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const COHUB_SPACE_URI = new RegExp(`^cohub://spaces/(${UUID})(?:/sessions/(${UUID}))?/?$`);
const COHUB_WEB_SPACE = new RegExp(`^${COHUB_WEB_ORIGIN_SOURCE}?/spaces/(${UUID})(?:/sessions/(${UUID}))?(?:[?#].*)?$`);
const COHUB_APP_URI = /^cohub:\/\/apps\/([^/?#\s]+)\/([^/?#\s]+)\/([^/?#\s]+)([?#]\S*)?$/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "heif"]);

/** A link target that names a file on the agent's machine rather than a URL or an anchor. */
function localTarget(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || SCHEME.test(trimmed)) return null;
  if ([...trimmed].some((char) => char === "\\" || char.charCodeAt(0) <= 0x1f || char.charCodeAt(0) === 0x7f)) return null;
  const first = trimmed.split("/", 1)[0]!;
  // md4c hands permissive autolinks over without a scheme (`www.example.com`, `name@example.com`).
  if (/^www\./i.test(first) || first.includes("@")) return null;
  return trimmed;
}

/**
 * The Space file a link target names, as the files API takes it: relative to the workspace, with
 * `.` and `..` resolved. `/workspace/…` and relative paths qualify; other absolute paths and `~/…`
 * are outside the Space's files and do not.
 */
export function workspaceFilePath(url: string): string | null {
  const target = localTarget(url);
  if (!target || target.startsWith("~")) return null;
  const prefix = /^\/?workspace\/+/.exec(target)?.[0];
  if (!prefix && target.startsWith("/")) return null;
  const relative = target.slice(prefix?.length ?? 0);
  const parts: string[] = [];
  for (const segment of relative.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment !== "..") parts.push(segment);
    else if (!parts.pop()) return null;
  }
  return parts.length ? parts.join("/") : null;
}

function isImagePath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export type ResolvedMessageLink =
  | { kind: "session"; spaceId: string; sessionId: string }
  | { kind: "space"; spaceId: string }
  | { kind: "file"; path: string }
  | { kind: "external"; url: string };

/**
 * Message markdown mixes three URL families: Cohub mentions (`cohub://spaces/…`, `cohub://apps/…`),
 * Cohub web URLs, and sandbox paths (`/workspace/...`) that only make sense
 * inside the Space that produced them. Anything else opens in the system browser.
 */
export function resolveMessageLink(url: string): ResolvedMessageLink | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const uri = COHUB_SPACE_URI.exec(trimmed) ?? COHUB_WEB_SPACE.exec(trimmed);
  if (uri) {
    const [, spaceId, sessionId] = uri;
    return sessionId ? { kind: "session", spaceId: spaceId!, sessionId } : { kind: "space", spaceId: spaceId! };
  }
  // Work mentions have no native slug route; open the published page instead.
  const app = COHUB_APP_URI.exec(trimmed);
  if (app) return { kind: "external", url: `https://cohub.live/${app[1]}/${app[2]}/w/${app[3]}${app[4] ?? ""}` };
  if (trimmed.startsWith("/")) return { kind: "file", path: workspaceFilePath(trimmed) ?? trimmed };
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return { kind: "external", url: trimmed };
  return null;
}

// A fence may sit inside list items and block quotes, so container markers may precede it.
const FENCE = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*(`{3,}|~{3,})(.*)$/;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;

export type MessageMarkdownImages = { markdown: string; images: string[] };

/** End of an inline link destination starting at `from` (CommonMark: `<…>`, or balanced parentheses), or -1. */
function destinationEnd(text: string, from: number) {
  if (text[from] === "<") {
    for (let at = from + 1; at < text.length; at += 1) {
      if (text[at] === "\\") at += 1;
      else if (text[at] === ">") return at + 1;
      else if (text[at] === "<" || text[at] === "\n") return -1;
    }
    return -1;
  }
  let depth = 0;
  let at = from;
  for (; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "\\" && at + 1 < text.length) at += 1;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/.test(char) || char.charCodeAt(0) <= 0x1f) break;
  }
  return depth === 0 && at > from ? at : -1;
}

/** End of the `(destination "title")` part of an inline link starting at the `(`, or -1. */
function linkTargetEnd(text: string, open: number): { start: number; end: number; close: number } | -1 {
  let at = open + 1;
  while (text[at] === " " || text[at] === "\t") at += 1;
  const start = at;
  const end = destinationEnd(text, start);
  if (end < 0) return -1;
  at = end;
  while (text[at] === " " || text[at] === "\t") at += 1;
  const quote = text[at];
  if (at > end && (quote === "\"" || quote === "'" || quote === "(")) {
    const closer = quote === "(" ? ")" : quote;
    for (at += 1; at < text.length && text[at] !== closer; at += 1) if (text[at] === "\\") at += 1;
    if (at >= text.length) return -1;
    at += 1;
    while (text[at] === " " || text[at] === "\t") at += 1;
  }
  return text[at] === ")" ? { start, end, close: at } : -1;
}

function isEscaped(text: string, at: number) {
  let slashes = 0;
  for (let before = at - 1; before >= 0 && text[before] === "\\"; before -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** Code spans in a paragraph as `[start, end)` ranges: a backtick run closes on the next run of the same length. */
function codeSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let open = text.indexOf("`"); open >= 0;) {
    let end = open;
    while (text[end] === "`") end += 1;
    if (isEscaped(text, open)) {
      open = text.indexOf("`", open + 1);
      continue;
    }
    let close = -1;
    for (let at = text.indexOf("`", end); at >= 0;) {
      let runEnd = at;
      while (text[runEnd] === "`") runEnd += 1;
      if (runEnd - at === end - open) {
        close = runEnd;
        break;
      }
      at = text.indexOf("`", runEnd);
    }
    if (close < 0) {
      open = text.indexOf("`", end);
      continue;
    }
    spans.push([open, close]);
    open = text.indexOf("`", close);
  }
  return spans;
}

/**
 * Rewrites one paragraph's sandbox images. Brackets and targets inside code spans are text, so a
 * span may hide an image across the paragraph's lines but never splits an image's own label.
 * `asText` is for a label that becomes link text, where an image cannot become a link.
 */
function rewriteParagraph(text: string, images: string[], asText = false) {
  const spans = codeSpans(text);
  const inCode = (at: number) => spans.some(([start, end]) => at >= start && at < end);
  const structural = (at: number) => !isEscaped(text, at) && !inCode(at);
  const labelEnd = (open: number) => {
    let depth = 0;
    for (let at = open + 1; at < text.length; at += 1) {
      if (!structural(at)) continue;
      if (text[at] === "[") depth += 1;
      else if (text[at] === "]") {
        if (depth === 0) return at;
        depth -= 1;
      }
    }
    return -1;
  };
  // Text ranges of the links found so far; an image inside one cannot become a link itself.
  const linkTexts: [number, number][] = [];
  // Destinations and titles of the links found so far, which are not Markdown content.
  const targets: [number, number][] = [];
  let out = "";
  let copied = 0;
  for (let open = text.indexOf("["); open >= 0; open = text.indexOf("[", open + 1)) {
    if (open < copied || !structural(open) || targets.some(([start, end]) => open > start && open < end)) continue;
    const close = labelEnd(open);
    if (close < 0 || text[close + 1] !== "(") continue;
    const target = linkTargetEnd(text, close + 1);
    // A code span that opens in the target and runs past its `)` breaks the link, as in md4c.
    if (target === -1 || spans.some(([start, end]) => start > close && start <= target.close && end > target.close)) continue;
    targets.push([close + 1, target.close]);
    const bang = open - 1;
    const image = text[bang] === "!" && structural(bang);
    if (!image) linkTexts.push([open, close]);
    const raw = text.slice(target.start, target.end);
    const local = localTarget((raw.startsWith("<") ? raw.slice(1, -1) : raw).replace(ESCAPED_PUNCTUATION, "$1"));
    if (!local) continue;
    const path = workspaceFilePath(local);
    if (path && isImagePath(path) && !images.includes(path)) images.push(path);
    if (!image) continue;
    // The device cannot load a local path, and the native renderer draws such an image as an
    // empty box. As a link it keeps its text and opens the file; a resolved image renders below.
    const label = rewriteParagraph(text.slice(open + 1, close), images, true);
    const name = label.trim() || local.slice(local.lastIndexOf("/") + 1).replace(/[[\]\\`]/g, "\\$&");
    // A relative target would not open as a link, so the link names the workspace file instead.
    const destination = path && !local.startsWith("/") ? `</workspace/${path.replace(/[<>\\]/g, "\\$&")}>` : null;
    // Links cannot nest: an image inside another link's text becomes that text.
    if (asText || linkTexts.some(([start, end]) => bang > start && bang < end)) {
      out += `${text.slice(copied, bang)}${name}`;
      copied = target.close + 1;
    } else {
      out += `${text.slice(copied, bang)}[${name}]`;
      copied = close + 1;
      if (destination) {
        out += `(${destination}${text.slice(target.end, target.close + 1)}`;
        copied = target.close + 1;
      }
    }
    open = target.close;
  }
  return out + text.slice(copied);
}

const LIST_ITEM = /^ *(?:[-*+]|\d{1,9}[.)])(?: +|$)/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

function indentWidth(line: string) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * Workspace images a message references through `![…](path)` or `[…](path)`, outside code, in
 * order and relative to the workspace. The returned Markdown has every image with a local path
 * rewritten as a link to that file.
 */
export function messageMarkdownImages(markdown: string): MessageMarkdownImages {
  const images: string[] = [];
  if (!markdown.includes("](")) return { markdown, images };
  const out: string[] = [];
  // Code spans are paragraph-level, so prose lines collect into one paragraph before rewriting.
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(rewriteParagraph(paragraph.join("\n"), images));
    paragraph = [];
  };
  let fence: string | null = null;
  // Indented code is a line block context decides, so this tracks just enough of it: the open list
  // item's content column, whether the previous line was blank, and whether code is running.
  let listColumn = 0;
  let previousBlank = true;
  let indentedCode = false;
  for (const line of markdown.split("\n")) {
    const [, marker, rest = ""] = FENCE.exec(line) ?? [];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !rest.trim()) fence = null;
      out.push(line);
      continue;
    }
    const body = line.replace(/^(?: {0,3}>)+ ?/, "");
    if (!body.trim()) {
      flush();
      previousBlank = true;
      out.push(line);
      continue;
    }
    const indent = indentWidth(body);
    const wasBlank = previousBlank;
    previousBlank = false;
    if ((indentedCode || wasBlank) && indent >= listColumn + 4) {
      flush();
      indentedCode = true;
      out.push(line);
      continue;
    }
    indentedCode = false;
    const item = LIST_ITEM.exec(body);
    if (item) listColumn = item[0].length;
    else if (wasBlank && indent < listColumn) listColumn = 0;
    // A backtick fence's info string cannot hold a backtick; such a line is an inline code span.
    if (marker && !(marker[0] === "`" && rest.includes("`"))) {
      flush();
      fence = marker;
      out.push(line);
      continue;
    }
    if (item || HEADING.test(body)) flush();
    paragraph.push(line);
    if (HEADING.test(body)) flush();
  }
  flush();
  return { markdown: out.join("\n"), images };
}
