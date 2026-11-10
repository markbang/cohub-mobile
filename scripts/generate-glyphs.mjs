/**
 * Generates src/ui/glyph-paths.android.ts: Framework7 Icons (MIT, by Vladimir Kharlampidi), an open set
 * drawn after SF Symbols, for the IconNames whose SF Symbol it covers. Android draws these in place of
 * Lucide so its glyphs match iOS; names it lacks keep Lucide. The package is fetched at a pinned
 * version rather than installed, so the app's dependencies (and native fingerprint) stay unchanged.
 *
 *   node scripts/generate-glyphs.mjs [--check]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = "5.0.5";
const TARGET = new URL("../src/ui/glyph-paths.android.ts", import.meta.url);

// IconName → Framework7 icon, chosen from each name's SF Symbol in src/sf-symbols.ts.
const GLYPHS = {
  activity: "waveform_path_ecg",
  alert: "exclamationmark_circle",
  archive: "archivebox",
  "arrow-down": "arrow_down",
  "arrow-left": "chevron_left",
  "arrow-right": "arrow_right",
  "arrow-up": "arrow_up",
  bell: "bell",
  "book-open": "book",
  bookmark: "bookmark",
  box: "shippingbox",
  camera: "camera",
  check: "checkmark",
  "check-check": "checkmark_circle",
  "check-circle": "checkmark_circle",
  "chevron-down": "chevron_down",
  "chevron-left": "chevron_left",
  "chevron-right": "chevron_right",
  "chevron-up": "chevron_up",
  "chevrons-down": "chevron_down",
  "chevrons-up": "chevron_up",
  "chevrons-up-down": "chevron_up_chevron_down",
  "circle-x": "xmark_circle",
  clock: "clock",
  cloud: "cloud",
  code: "chevron_left_slash_chevron_right",
  compass: "compass",
  copy: "doc_on_doc",
  download: "square_arrow_down",
  "external-link": "arrow_up_right_square",
  eye: "eye",
  "eye-off": "eye_slash",
  "file-text": "doc_text",
  filter: "line_horizontal_3_decrease",
  folder: "folder",
  "folder-open": "folder",
  gift: "gift",
  "git-compare": "arrow_right_arrow_left",
  "git-fork": "arrow_branch",
  globe: "globe",
  heart: "heart",
  "heart-fill": "heart_fill",
  history: "arrow_counterclockwise",
  images: "photo_on_rectangle",
  info: "info_circle",
  layers: "square_stack_3d_up",
  link: "link",
  "list-tree": "list_bullet_indent",
  maximize: "arrow_up_left_arrow_down_right",
  "message-square": "bubble_left",
  messages: "bubble_left_bubble_right",
  mic: "mic",
  minimize: "arrow_down_right_arrow_up_left",
  monitor: "desktopcomputer",
  moon: "moon",
  more: "ellipsis",
  paperclip: "paperclip",
  pin: "pin",
  "pin-off": "pin_slash",
  play: "play",
  plus: "plus",
  refresh: "arrow_clockwise",
  rocket: "paperplane",
  search: "search",
  settings: "gear_alt",
  share: "square_arrow_up",
  shield: "shield",
  smartphone: "device_phone_portrait",
  sparkles: "sparkles",
  "square-pen": "square_pencil",
  stop: "stop_fill",
  sun: "sun_max",
  sync: "arrow_2_circlepath",
  tag: "tag",
  trash: "trash",
  type: "textformat",
  upload: "tray_arrow_up",
  user: "person",
  "user-circle": "person_crop_circle",
  wallet: "creditcard",
  wifi: "wifi",
  wrench: "wrench",
  x: "xmark",
  zap: "bolt",
};

// SF Symbols' measure at a given point size, from iOS 26 screenshots: a glyph's longer side spans
// about 0.85 of it; chevrons are drawn smaller. iOS 27's disclosure chevron spans 0.8 of it.
const EXTENT = 0.85;
const EXTENT_OVERRIDES = { "chevron-left": 0.7, "chevron-right": 0.8, "chevron-down": 0.8, "chevrons-up-down": 0.8 };
// Where Framework7 draws thinner than SF: an outline stroke, as a fraction of the glyph's size, thickens it.
// A disclosure turns chevron-right into chevron-down, so the two match.
const WEIGHT_OVERRIDES = { "chevron-right": 0.045, "chevron-down": 0.045 };

/** The bounds of a path's points, control points included, so a glyph can be centred and sized. */
function bounds(d, box) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const add = (px, py) => { box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py); };
  const counts = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  for (let index = 0; index < tokens.length;) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const lower = command.toLowerCase();
    const relative = command !== command.toUpperCase();
    if (lower === "z") { x = startX; y = startY; continue; }
    const args = tokens.slice(index, index + counts[lower]).map(Number);
    index += counts[lower];
    const point = (px, py) => [relative ? x + px : px, relative ? y + py : py];
    if (lower === "h") { x = relative ? x + args[0] : args[0]; add(x, y); continue; }
    if (lower === "v") { y = relative ? y + args[0] : args[0]; add(x, y); continue; }
    const pairs = lower === "a" ? [[args[5], args[6]]] : Array.from({ length: args.length / 2 }, (_, pair) => [args[pair * 2], args[pair * 2 + 1]]);
    for (const [px, py] of pairs) add(...point(px, py));
    [x, y] = point(...pairs.at(-1));
    if (lower === "m") { startX = x; startY = y; command = relative ? "l" : "L"; }
  }
}

function parse(svg, name, extent, weight) {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const tags = new Set([...inner.matchAll(/<(\w+)/g)].map((match) => match[1]));
  for (const tag of tags) if (tag !== "path" && tag !== "g") throw new Error(`${name}.svg has a <${tag}>; only paths are supported.`);
  const translates = [...inner.matchAll(/transform="translate\(([-\d.]+)[ ,]+([-\d.]+)\)"/g)].map((match) => `${match[1]},${match[2]}`);
  if (/transform="(?!translate)/.test(inner) || new Set(translates).size > 1) throw new Error(`${name}.svg has a transform other than one translate.`);
  const paths = [...inner.matchAll(/<path([^>]*)>/g)].map((match) => {
    const d = /\sd="([^"]+)"/.exec(match[1])?.[1];
    if (!d) throw new Error(`${name}.svg has a path without d.`);
    const evenOdd = /fill-rule="evenodd"/.test(match[1]) || /fill-rule="evenodd"/.test(inner.slice(0, match.index));
    return evenOdd ? { d: d.replace(/\s+/g, " ").trim(), evenOdd: true } : { d: d.replace(/\s+/g, " ").trim() };
  });
  // A square view box centred on the paths' own bounds, so a translate drops out, sized so the longer side spans `extent`.
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const path of paths) bounds(path.d, box);
  const side = Math.max(box[2] - box[0], box[3] - box[1]) / extent;
  const round = (value) => Math.round(value * 100) / 100;
  const viewBox = [round((box[0] + box[2]) / 2 - side / 2), round((box[1] + box[3]) / 2 - side / 2), round(side), round(side)];
  return weight ? { viewBox, paths, stroke: round(side * weight) } : { viewBox, paths };
}

const dir = mkdtempSync(join(tmpdir(), "f7-"));
try {
  execFileSync("npm", ["pack", `framework7-icons@${VERSION}`, "--silent"], { cwd: dir, stdio: ["ignore", "pipe", "inherit"] });
  execFileSync("tar", ["xzf", `framework7-icons-${VERSION}.tgz`], { cwd: dir });
  const read = (name) => { try { return readFileSync(join(dir, "package", "svg", `${name}.svg`), "utf8"); } catch { return null; } };
  const entries = Object.entries(GLYPHS).map(([icon, name]) => {
    const outline = read(name);
    if (!outline) throw new Error(`Framework7 Icons ${VERSION} has no ${name}.svg (for ${icon}).`);
    const fill = read(`${name}_fill`);
    const extent = EXTENT_OVERRIDES[icon] ?? EXTENT;
    const weight = WEIGHT_OVERRIDES[icon];
    return [icon, { outline: parse(outline, name, extent, weight), ...(fill ? { fill: parse(fill, `${name}_fill`, extent, weight) } : {}) }];
  });
  const body = entries.map(([icon, glyph]) => `  ${JSON.stringify(icon)}: ${JSON.stringify(glyph)},`).join("\n");
  const output = `// Generated by scripts/generate-glyphs.mjs from Framework7 Icons ${VERSION} (MIT). Do not edit.
import type { GlyphPaths } from "./glyph-paths";

export const GLYPH_PATHS: GlyphPaths = {
${body}
};
`;
  if (process.argv.includes("--check")) {
    if (readFileSync(TARGET, "utf8") !== output) { console.error("src/ui/glyph-paths.android.ts is stale. Run node scripts/generate-glyphs.mjs."); process.exit(1); }
    console.log("Glyph paths are up to date.");
  } else {
    writeFileSync(TARGET, output);
    console.log(`Wrote ${entries.length} glyphs to src/ui/glyph-paths.android.ts.`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
