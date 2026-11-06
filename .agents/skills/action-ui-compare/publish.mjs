#!/usr/bin/env node
// Builds the iOS-vs-Android report from two UI Snapshots runs, publishes it to the Space's public
// files, and records it in the registry that the `ui-compare` Cohub App lists.
//
//   node .agents/skills/action-ui-compare/publish.mjs --ios <run-id> --android <run-id> [--note text] [--dry-run]
//
// Run from the repository root; needs gh, cohub, ImageMagick and ffmpeg.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "markbang/cohub-mobile";
const PUBLIC_ROOT = "ui-compare";
const REGISTRY = `${PUBLIC_ROOT}/reports.json`;
const APP_URL = "https://cohub.live/bangwu/cohub-mobile/w/ui-compare";
const SKILL_DIR = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`action-ui-compare: ${message}\n`);
  process.exit(1);
}

function sh(command, args, { capture = true, allowFail = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail(`${command} is not available: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) fail(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr ?? ""}`);
  return result;
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--dry-run") options.dryRun = true;
    else if (key === "--ios" || key === "--android" || key === "--note") options[key.slice(2)] = argv[++index];
    else fail(`unknown option ${key}. Usage: publish.mjs --ios <run-id> --android <run-id> [--note text] [--dry-run]`);
  }
  for (const key of ["ios", "android"]) if (!/^\d+$/.test(options[key] ?? "")) fail(`--${key} needs a GitHub Actions run id (gh run list --workflow ui-snapshots-${key}.yml).`);
  return options;
}

function runInfo(id, platform) {
  const info = JSON.parse(sh("gh", ["run", "view", id, "-R", REPO, "--json", "databaseId,headSha,headBranch,conclusion,status,workflowName,createdAt"]).stdout);
  if (!info.workflowName.toLowerCase().includes(platform)) fail(`run ${id} is "${info.workflowName}", not the ${platform} UI Snapshots workflow.`);
  if (info.status !== "completed") fail(`run ${id} is still ${info.status}; wait with: gh run watch ${id} -R ${REPO}`);
  return { id: String(info.databaseId), sha: info.headSha, branch: info.headBranch, conclusion: info.conclusion, createdAt: info.createdAt };
}

function download(id, platform, directory) {
  rmSync(directory, { recursive: true, force: true });
  const result = sh("gh", ["run", "download", id, "-R", REPO, "-n", `ui-snapshots-${platform}`, "-D", directory], { allowFail: true });
  if (result.status !== 0) fail(`run ${id} has no ui-snapshots-${platform} artifact (expired after 7 days, or the capture never uploaded).\n${result.stderr}`);
}

const pngs = (directory) => (existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)) : []);

function buildSite({ iosDir, androidDir, pairsDir, siteDir }) {
  rmSync(siteDir, { recursive: true, force: true });
  mkdirSync(join(siteDir, "shots"), { recursive: true });
  const magick = spawnSync("magick", ["-version"], { stdio: "ignore" }).error ? "convert" : "magick";
  const screens = new Set();
  const themes = [];
  for (const theme of ["light", "dark"]) {
    const android = new Set(pngs(join(androidDir, theme)));
    const both = pngs(join(iosDir, theme)).filter((name) => android.has(name));
    if (!both.length) continue;
    themes.push(theme);
    for (const name of both) {
      screens.add(name);
      for (const [platform, root] of [["ios", iosDir], ["android", androidDir]]) {
        sh(magick, [join(root, theme, `${name}.png`), "-resize", "720x", "-quality", "82", join(siteDir, "shots", `${name}.${theme}.${platform}.webp`)]);
      }
    }
  }
  const motions = [];
  const pairedMotion = join(pairsDir, "motion");
  if (existsSync(pairedMotion)) {
    mkdirSync(join(siteDir, "motion"), { recursive: true });
    for (const file of readdirSync(pairedMotion).filter((name) => name.endsWith(".mp4")).sort()) {
      // The paired 1280 px masters are too heavy to stream; 960 px at CRF 28 keeps them legible.
      sh("ffmpeg", ["-loglevel", "error", "-y", "-i", join(pairedMotion, file), "-vf", "scale=-2:960", "-c:v", "libx264", "-crf", "28", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(siteDir, "motion", file)]);
      motions.push(file.slice(0, -4));
    }
  }
  if (!screens.size && !motions.length) fail("the two runs share no screen or recording. Re-run both with the same screens/themes inputs.");
  return { screens: [...screens].sort(), themes, motions };
}

function readRegistry(url) {
  // The public CDN caches for 5 minutes; a unique query reads the stored copy.
  const result = sh("curl", ["-sS", "-w", "\n%{http_code}", `${url}?t=${Date.now()}`]);
  const body = result.stdout.slice(0, result.stdout.lastIndexOf("\n"));
  const status = result.stdout.slice(result.stdout.lastIndexOf("\n") + 1);
  if (status === "404") return [];
  if (status !== "200") fail(`reading ${url} returned HTTP ${status}; not overwriting the registry.`);
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed.reports)) throw new Error("missing reports[]");
    return parsed.reports;
  } catch (error) {
    fail(`${url} is not a valid registry (${error.message}); fix or remove it before publishing.`);
  }
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync("scripts/ui-snapshots.mjs")) fail("run from the cohub-mobile repository root.");

const runs = { ios: runInfo(options.ios, "ios"), android: runInfo(options.android, "android") };
if (runs.ios.sha !== runs.android.sha) process.stdout.write(`note: iOS ran ${runs.ios.sha.slice(0, 7)} and Android ran ${runs.android.sha.slice(0, 7)}; the report shows both.\n`);

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const id = `${stamp}-${runs.android.sha.slice(0, 7)}`;
const work = resolve("dist/ui-compare", id);
const iosDir = join(work, "ios");
const androidDir = join(work, "android");
const pairsDir = join(work, "pairs");
const siteDir = join(work, "site");
download(runs.ios.id, "ios", iosDir);
download(runs.android.id, "android", androidDir);
// Reuses the repository's pairing so recordings stay aligned on each side's first change.
sh("node", ["scripts/ui-snapshots.mjs", "compare", "--ios", iosDir, "--android", androidDir, "--out", pairsDir], { capture: false });
const contents = buildSite({ iosDir, androidDir, pairsDir, siteDir });

const destination = `${PUBLIC_ROOT}/${id}`;
const url = sh("cohub", ["public", "url", `${destination}/index.html`]).stdout.trim();
const registryUrl = sh("cohub", ["public", "url", REGISTRY]).stdout.trim();
const entry = {
  id,
  url,
  date: [runs.ios.createdAt, runs.android.createdAt].sort().at(-1),
  ...(options.note ? { note: options.note } : {}),
  runs,
  themes: contents.themes,
  screens: contents.screens,
  motions: contents.motions,
};
const report = { ...entry, repo: `https://github.com/${REPO}`, indexUrl: APP_URL };
const template = readFileSync(join(SKILL_DIR, "report.html"), "utf8");
// `<` is escaped so a note cannot close the JSON script element.
writeFileSync(join(siteDir, "index.html"), template.replace("__REPORT__", () => JSON.stringify(report).replace(/</g, "\\u003c")));

process.stdout.write(`Built ${contents.screens.length} screens × ${contents.themes.join("+")} and ${contents.motions.length} recordings in ${siteDir}\n`);
if (options.dryRun) process.exit(0);

sh("cohub", ["public", "upload", siteDir, destination], { capture: false });
const reports = readRegistry(registryUrl).filter((existing) => existing.id !== id);
writeFileSync(join(work, "reports.json"), `${JSON.stringify({ reports: [entry, ...reports] }, null, 2)}\n`);
sh("cohub", ["public", "upload", join(work, "reports.json"), REGISTRY, "--overwrite"], { capture: false });
process.stdout.write(`Report: ${url}\nRegistry: ${registryUrl} (${reports.length + 1} reports)\n`);
