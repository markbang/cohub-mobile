import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

/**
 * Captures the same screens on iOS and Android and pairs them side by side, so the drawn Android
 * UI can be compared with the iOS system UI without a local simulator.
 *
 *   capture --platform android|ios --app <apk|.app|.zip> [--target phone|tablet] [--orientations portrait,landscape]
 *           [--out dir] [--screens a,b] [--themes light,dark] [--no-metro] [--no-motion] [--perf runs]
 *   compare --ios <dir> --android <dir> [--out dir]
 *   redact --dir <dir>   (replaces E2E_ACCOUNT_* values in text files before an upload)
 *
 * Capture runs a debug binary against a local Metro, so a JS-only change needs no native rebuild.
 * After the screenshots it records each of MOTIONS as a video (light theme, animations on); compare
 * pairs those too, so motion can be tuned frame by frame.
 *
 * `--target tablet` runs on an iPad simulator or a tablet emulator at its own density, in each of
 * `--orientations`, and writes `<target>-<orientation>/<theme>/`; the phone keeps `<theme>/`. It
 * then runs the split-layout interaction flow (e2e/tablet/split.yaml). `--perf <runs>` repeats one
 * operation sequence with the frame probe on and writes its raw stall records to `perf/<group>.json`.
 */

const PACKAGE_ID = "io.github.markbang.cohubmobile";
const METRO_PORT = 8081;
const LOGIN_FLOWS = { android: "e2e/auth/login.yaml", ios: "e2e/auth/login.ios.yaml" };
// iPhone 17 Pro width; the Android emulator's density is set so both lay out at the same width.
const LOGICAL_WIDTH = 402;
// Logical portrait sizes in points; capture asserts the device it got lays out in its target's band.
const IOS_DEVICES = {
  phone: { "iPhone 17 Pro": [402, 874], "iPhone 16 Pro": [402, 874], "iPhone 17": [402, 874], "iPhone 16": [393, 852] },
  tablet: { "iPad Air 11-inch (M3)": [820, 1180], "iPad Air 11-inch (M2)": [820, 1180], "iPad (A16)": [820, 1180], "iPad Pro 11-inch (M4)": [834, 1210] },
};
// The split layout starts at 700 × 500 (src/data/split-navigation.ts); each band sits clear of that edge.
const SIZE_BANDS = {
  "phone-portrait": { width: [375, 440], height: [800, 960] },
  "tablet-portrait": { width: [744, 1000], height: [1000, 1400] },
  "tablet-landscape": { width: [1000, 1400], height: [744, 1000] },
};
const TABLET_FLOW = "e2e/tablet/split.yaml";
const PAIR_HEIGHT = 1400;
const DEV_SERVER_ERROR = "Could not connect to development server";
const NOT_RESPONDING = ".* isn't responding";
const OPEN_IN_APP = "Open in .*Cohub.*\\?";

// Screens that leave an overlay open come last; `fresh` relaunches first, because a UIKit sheet or
// alert survives the route change and would cover the next screen.
// The first list row under a tab root's search field at 402 pt wide; iOS's native Large Title and
// search field sit lower than Android's drawn ones.
const FIRST_ROW = { ios: "50%, 40%", android: "50%, 26%" };

export const SCREENS = [
  { name: "catalog-type", ready: "Display.*", link: "cohub://debug/ui?section=type" },
  { name: "catalog-rows", ready: "Settings rows", link: "cohub://debug/ui?section=rows" },
  { name: "catalog-controls", ready: "Buttons", link: "cohub://debug/ui?section=controls" },
  { name: "catalog-states", ready: "No files yet", link: "cohub://debug/ui?section=states" },
  { name: "chats", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }] },
  { name: "spaces", link: "cohub://spaces" },
  { name: "activity", ready: "Usage details", link: "cohub://activity", steps: [{ waitGone: "Loading" }] },
  { name: "settings", ready: "Appearance", link: "cohub://settings" },
  { name: "appearance", ready: "Accent color", link: "cohub://appearance" },
  { name: "about", ready: "Cohub Mobile", link: "cohub://about" },
  // The tab roots scrolled: the Large Title collapsed into the bar.
  // Released part-way through the collapse, the bar settles: here on the search field hidden. Before
  // chats-scrolled, so Chats is still at its top.
  { name: "chats-snap", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { swipe: "nudge" }] },
  { name: "chats-scrolled", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { swipe: "up" }] },
  { name: "spaces-scrolled", link: "cohub://spaces", steps: [{ swipe: "up" }] },
  { name: "activity-scrolled", ready: "Usage details", link: "cohub://activity", steps: [{ waitGone: "Loading" }, { swipe: "up" }] },
  { name: "settings-scrolled", ready: "Appearance", link: "cohub://settings", steps: [{ swipe: "up" }] },
  // The Chat screen's chrome and native timeline over fixed conversations, then a real Chat.
  { name: "chat-conversation", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  { name: "chat-tools", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=tools" },
  { name: "chat-long", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long" },
  { name: "chat-states", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=states" },
  // The native timeline on the same fixtures, on iOS too, where the Chat screen draws the JS list.
  { name: "chat-native", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&native=1", steps: [{ waitFor: "setRows" }] },
  // The first row, by position: the test account's newest Chat changes from run to run.
  { name: "chat-real", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { tapPoint: FIRST_ROW }, { waitGone: "Opening Chat" }] },
  { name: "catalog-menu", ready: "Menu", link: "cohub://debug/ui?section=menu", steps: [{ tapOnId: "ui-catalog-menu-button" }, { waitFor: "Pin" }] },
  { name: "catalog-sheet", ready: "Sheet title", link: "cohub://debug/ui?section=sheet", fresh: true },
  { name: "catalog-page", ready: "New Space", link: "cohub://debug/ui?section=page", fresh: true },
  { name: "catalog-confirm", ready: "Delete this chat\\?", link: "cohub://debug/ui?section=confirm", fresh: true },
];

// The left pane's first and a later Chat or Space row in a split window.
const LEFT_FIRST_ROW = { ios: "12%, 35%", android: "12%, 35%" };
const LEFT_SECOND_ROW = { ios: "12%, 44%", android: "12%, 44%" };

/** Split-window screens: the right pane empty, a Chat, a Space, a settings page, the Chat's panel, and an overlay. */
export const TABLET_SCREENS = [
  { name: "split-empty", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { waitFor: "New Chat" }] },
  { name: "split-chat-real", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { tapPoint: LEFT_FIRST_ROW }, { waitGone: "Opening Chat" }] },
  { name: "split-chat-panel", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { tapPoint: LEFT_FIRST_ROW }, { waitGone: "Opening Chat" }, { swipe: "right" }] },
  { name: "split-chat-conversation", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  { name: "split-chat-native", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&native=1", steps: [{ waitFor: "setRows" }] },
  { name: "split-chat-long", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long" },
  { name: "split-chat-media", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=media" },
  { name: "split-chat-media-native", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=media&native=1", steps: [{ waitFor: "setRows" }] },
  { name: "split-chat-stream", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=stream" },
  { name: "split-space", link: "cohub://spaces", steps: [{ tapPoint: LEFT_FIRST_ROW }] },
  { name: "split-settings-page", ready: "Accent color", link: "cohub://appearance" },
  { name: "split-new-chat", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: "Chats" }, { tapOn: "New Chat" }, { waitFor: "Find a Space" }] },
];

/** The same operations on every target, timed by the frame probe: a long fixture, a real Chat, and the tabs. */
const perfSteps = (row) => [{ open: "cohub://debug/chat?fixture=long", ready: "Fix the Android sheet height" }, { swipe: "down" }, { swipe: "up" }, { swipe: "down" }, { swipe: "up" }, { open: "cohub://settings", ready: "Appearance" }, { tapOn: "Chats" }, { tapPoint: row }, { waitGone: "Opening Chat" }, { swipe: "down" }, { swipe: "up" }, { open: "cohub://settings", ready: "Appearance" }, { tapOn: "Spaces" }, { tapOn: "Activity" }, { tapOn: "Chats" }];
const PERF_STEPS = { phone: perfSteps(FIRST_ROW), tablet: perfSteps(LEFT_FIRST_ROW) };

/**
 * Interactions recorded as video, the same on both platforms. `setup` runs before the recording
 * starts. `back` is the system back on Android and the edge swipe on iOS, which has no back key.
 */
export const MOTIONS = [
  { name: "motion-tabs", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Chats" }, { tapOn: "Spaces" }, { tapOn: "Activity" }, { tapOn: "Me" }] },
  { name: "motion-push", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: "Appearance" }, { back: true }] },
  { name: "motion-controls", ready: "Buttons", link: "cohub://debug/ui?section=controls", steps: [{ tapOn: "Switch on" }, { tapOn: "Mine" }, { tapOn: "Shared" }, { tapOn: "Pinned" }] },
  { name: "motion-menu", ready: "Menu", link: "cohub://debug/ui?section=menu", steps: [{ tapOnId: "ui-catalog-menu-button" }, { tapOn: "Pin" }] },
  { name: "motion-sheet", ready: "Open sheet", link: "cohub://debug/ui?section=sheet&open=0", steps: [{ tapOn: "Open sheet" }, { tapOn: "Close.*" }] },
  { name: "motion-confirm", ready: "Open confirm", link: "cohub://debug/ui?section=confirm&open=0", steps: [{ tapOn: "Open confirm" }, { tapOn: "Cancel" }] },
  { name: "motion-scroll-chats", ready: "Appearance", link: "cohub://settings", setup: [{ tapOn: "Chats" }], steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-spaces", link: "cohub://spaces", steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-activity", ready: "Usage details", link: "cohub://activity", setup: [{ waitGone: "Loading" }], steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-settings", ready: "Appearance", link: "cohub://settings", steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-chat", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long", steps: [{ swipe: "down" }, { swipe: "up" }] },
  { name: "motion-space", link: "cohub://spaces", setup: [{ tapPoint: FIRST_ROW }], steps: [{ swipe: "up" }, { swipe: "down" }] },
];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, themes: ["light", "dark"], screens: null, metro: true, motion: true, target: "phone", orientations: null, perf: 0 };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = () => {
      const next = rest[++index];
      if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return next;
    };
    if (flag === "--platform") options.platform = value();
    else if (flag === "--app") options.app = resolve(value());
    else if (flag === "--out") options.out = resolve(value());
    else if (flag === "--screens") options.screens = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (flag === "--themes") options.themes = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (flag === "--ios") options.ios = resolve(value());
    else if (flag === "--android") options.android = resolve(value());
    else if (flag === "--no-metro") options.metro = false;
    else if (flag === "--no-motion") options.motion = false;
    else if (flag === "--target") options.target = value();
    else if (flag === "--orientations") options.orientations = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (flag === "--perf") options.perf = Number(value());
    else if (flag === "--dir") options.dir = resolve(value());
    else throw new Error(`Unknown argument "${flag}".`);
  }
  if (command === "capture") {
    if (options.platform !== "android" && options.platform !== "ios") throw new Error("--platform must be android or ios.");
    if (!options.app || !existsSync(options.app)) throw new Error("--app must point to a built debug APK (Android) or simulator .app/.zip (iOS).");
    for (const theme of options.themes) if (theme !== "light" && theme !== "dark") throw new Error(`Unknown theme "${theme}". Use light and/or dark.`);
    if (options.target !== "phone" && options.target !== "tablet") throw new Error("--target must be phone or tablet.");
    options.orientations ??= options.target === "tablet" ? ["portrait", "landscape"] : ["portrait"];
    for (const orientation of options.orientations) if (!SIZE_BANDS[`${options.target}-${orientation}`]) throw new Error(`The ${options.target} target has no ${orientation} orientation. Known: ${Object.keys(SIZE_BANDS).join(", ")}.`);
    if (!Number.isInteger(options.perf) || options.perf < 0) throw new Error("--perf must be a whole number of runs.");
    if (options.perf > 0 && !options.metro) throw new Error("--perf starts its own Metro with the frame probe forced on; drop --no-metro.");
    const known = new Set((options.target === "tablet" ? TABLET_SCREENS : SCREENS).map((screen) => screen.name));
    for (const name of options.screens ?? []) if (!known.has(name)) throw new Error(`Unknown screen "${name}". Known: ${[...known].join(", ")}.`);
    options.out ??= resolve("dist/ui-snapshots", options.platform);
  } else if (command === "compare") {
    if (!options.ios || !options.android) throw new Error("compare needs --ios <dir> and --android <dir>.");
    options.out ??= resolve("dist/ui-snapshots/pairs");
  } else if (command === "redact") {
    if (!options.dir) throw new Error("redact needs --dir <dir>.");
  } else {
    throw new Error("Usage: node scripts/ui-snapshots.mjs capture|compare|redact [options]. See the header of this file.");
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").at(-1);
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout ?? "";
}

function requireCommand(command, args, hint) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  if (probe.error) throw new Error(`${command} is required. ${hint}`);
}

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

async function startMetro({ frameProbe }) {
  const metro = spawn("npx", ["expo", "start", "--port", String(METRO_PORT)], {
    env: { ...process.env, CI: "1", EXPO_PUBLIC_UI_SNAPSHOTS: "1", EXPO_PUBLIC_COHUB_ENV: process.env.EXPO_PUBLIC_COHUB_ENV || "dev", ...(frameProbe ? { EXPO_PUBLIC_FRAME_PROBE: "1" } : {}) },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (metro.exitCode !== null) throw new Error(`Metro exited with code ${metro.exitCode} before it was ready.`);
    try {
      const response = await fetch(`http://localhost:${METRO_PORT}/status`);
      if ((await response.text()).includes("packager-status:running")) return metro;
    } catch {
      // Not listening yet.
    }
    await sleep(1000);
  }
  stopMetro(metro);
  throw new Error(`Metro did not answer on port ${METRO_PORT} within two minutes.`);
}

function stopMetro(metro) {
  if (!metro || metro.exitCode !== null) return;
  try {
    process.kill(-metro.pid, "SIGTERM");
  } catch {
    metro.kill("SIGTERM");
  }
}

function yamlString(value) {
  return JSON.stringify(value);
}

const MAESTRO_ORIENTATION = { portrait: "PORTRAIT", landscape: "LANDSCAPE_LEFT" };

/**
 * Launches fresh, waits out a cold Metro and system dialogs, and signs in if needed. An iPad turns
 * here, through Maestro; Android turns from the host before the run (`android.setOrientation`).
 */
function preamble(platform, orientation = null) {
  const login = resolve(LOGIN_FLOWS[platform]);
  return [
    `appId: ${PACKAGE_ID}`,
    "---",
    "- launchApp:",
    "    stopApp: true",
    "    permissions:",
    "      all: allow",
    // A debug binary fetches its first bundle from Metro, which can take minutes on a cold cache.
    "- extendedWaitUntil:",
    `    visible: ${yamlString(`(Continue with Cohub|Chats|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING}|${OPEN_IN_APP})`)}`,
    "    timeout: 600000",
    "- runFlow:",
    "    when:",
    `      visible: ${yamlString(OPEN_IN_APP)}`,
    "    commands:",
    "      - tapOn: \"^Open$\"",
    "      - extendedWaitUntil:",
    `          visible: ${yamlString(`(Continue with Cohub|Chats|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING})`)}`,
    "          timeout: 300000",
    "- repeat:",
    "    while:",
    `      visible: ${yamlString(NOT_RESPONDING)}`,
    "    times: 3",
    "    commands:",
    "      - tapOn: \"Wait\"",
    "      - extendedWaitUntil:",
    `          visible: ${yamlString(`(Continue with Cohub|Chats|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING})`)}`,
    "          timeout: 300000",
    // A cold Metro can build the first bundle slower than the app waits for it. Metro keeps building,
    // so a later reload gets the finished bundle.
    "- repeat:",
    "    while:",
    `      visible: ${yamlString(`${DEV_SERVER_ERROR}.*`)}`,
    "    times: 4",
    "    commands:",
    "      - tapOn: \"(Reload|RELOAD).*\"",
    "      - extendedWaitUntil:",
    `          visible: ${yamlString(`(Continue with Cohub|Chats|${DEV_SERVER_ERROR}.*)`)}`,
    "          timeout: 300000",
    "- runFlow:",
    "    when:",
    "      visible: \"Continue with Cohub\"",
    `    file: ${yamlString(login)}`,
    // A cached debug APK predates the latest release, so Android offers it; "Not now" snoozes it across launches.
    ...(platform === "android" ? [
      "- extendedWaitUntil:",
      "    visible: \"Update available.*\"",
      "    timeout: 15000",
      "    optional: true",
      "- runFlow:",
      "    when:",
      "      visible: \"Update available.*\"",
      "    commands:",
      "      - runFlow:",
      "          when:",
      "            notVisible: \"^Not now$\"",
      "          commands:",
      "            - tapOn: \"Update available.*\"",
      "      - tapOn: \"^Not now$\"",
      "      - waitForAnimationToEnd:",
      "          timeout: 5000",
    ] : []),
    ...(platform === "ios" && orientation ? [`- setOrientation: ${MAESTRO_ORIENTATION[orientation]}`, "- waitForAnimationToEnd:", "    timeout: 5000"] : []),
  ];
}

/**
 * A deep link navigates after `openLink` returns, so an animation wait can return before the screen
 * changes. A screen names text that shows it is ready; without one it gets a short settle.
 */
function openScreen(lines, platform, link, first, ready) {
  lines.push(`- openLink: ${yamlString(link)}`);
  // iOS asks once per simulator before handing a custom-scheme link to the app. An absent match
  // costs Maestro's ~7 s optional lookup, so only a flow's first link checks.
  if (platform === "ios" && first) lines.push("- runFlow:", "    when:", `      visible: ${yamlString(OPEN_IN_APP)}`, "    commands:", "      - tapOn: \"^Open$\"");
  // Matched inside the element's text: iOS and Android often merge a card or row into one element.
  if (ready) lines.push("- extendedWaitUntil:", `    visible: ${yamlString(`.*${ready}.*`)}`, "    timeout: 20000");
  else lines.push("- extendedWaitUntil:", "    visible: \"^__settle__$\"", "    timeout: 1500", "    optional: true");
  lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
}

// A tap waits for the screen to settle, which never happens beside a spinner; a second is enough here.
const SETTLE = "    waitToSettleTimeoutMs: 1000";
// iOS 26 minimizes the tab bar to the current tab on scroll, and a tab root keeps its offset across deep links.
const TAB_LABELS = new Set(["Chats", "Spaces", "Activity", "Me"]);

function pushSteps(lines, platform, steps = []) {
  for (const step of steps) {
    // What a tap opens can take a moment to draw; `waitFor` holds the capture until it has.
    if (step.waitFor) lines.push("- extendedWaitUntil:", `    visible: ${yamlString(`.*${step.waitFor}.*`)}`, "    timeout: 20000");
    // For a loading state: the screen counts as ready once it has gone.
    else if (step.waitGone) lines.push("- extendedWaitUntil:", `    notVisible: ${yamlString(`.*${step.waitGone}.*`)}`, "    timeout: 60000");
    else if (step.tapOnId) lines.push("- tapOn:", `    id: ${yamlString(step.tapOnId)}`, SETTLE);
    else if (step.open) {
      openScreen(lines, platform, step.open, false, step.ready);
      continue;
    }
    else if (step.tapPoint) lines.push("- tapOn:", `    point: ${yamlString(step.tapPoint[platform])}`, SETTLE);
    else if (step.back && platform === "android") lines.push("- back");
    else if (step.back) lines.push("- swipe:", "    start: 2%, 50%", "    end: 85%, 50%", "    duration: 400");
    // A deliberate drag, slow enough that the content follows the finger and then coasts.
    else if (step.swipe === "up") lines.push("- swipe:", "    start: 50%, 72%", "    end: 50%, 32%", "    duration: 700");
    else if (step.swipe === "nudge") lines.push("- swipe:", "    start: 50%, 60%", "    end: 50%, 55%", "    duration: 900");
    else if (step.swipe === "down") lines.push("- swipe:", "    start: 50%, 32%", "    end: 50%, 72%", "    duration: 700");
    // Across the right pane, which opens the Chat's Space panel.
    else if (step.swipe === "right") lines.push("- swipe:", "    start: 55%, 50%", "    end: 95%, 50%", "    duration: 400");
    else {
      // Tapping the minimized bar (the current tab's bubble, bottom leading) expands it again.
      if (platform === "ios" && TAB_LABELS.has(step.tapOn)) lines.push("- runFlow:", "    when:", `      notVisible: ${yamlString(step.tapOn)}`, "    commands:", "      - tapOn:", "          point: 13%, 94%", "      - waitForAnimationToEnd:", "          timeout: 5000");
      lines.push("- tapOn:", `    text: ${yamlString(step.tapOn)}`, SETTLE);
    }
    lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
  }
}

/** The app's own word on its layout: a tablet run must draw the split panes before anything is captured. */
function checkSplit(lines, platform) {
  openScreen(lines, platform, "cohub://settings", true, "Appearance");
  lines.push("- assertVisible:", "    id: \"split-right-pane\"");
}

/** One Maestro run per theme: sign in if needed, then visit and capture each screen. */
function buildFlow({ platform, screens, target, orientation }) {
  const lines = preamble(platform, target === "tablet" ? orientation : null);
  if (target === "tablet") checkSplit(lines, platform);
  for (const [index, screen] of screens.entries()) {
    if (screen.fresh) lines.push("- launchApp:", "    stopApp: true", "- extendedWaitUntil:", "    visible: \"Chats\"", "    timeout: 120000");
    openScreen(lines, platform, screen.link, index === 0 && target !== "tablet", screen.ready);
    pushSteps(lines, platform, screen.steps);
    // Maestro only writes screenshots inside its test output directory, so the path stays relative.
    lines.push("- takeScreenshot:", `    path: ${yamlString(screen.name)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The split-layout interaction flow, after sign-in, with the rows it taps for this platform. */
function buildTabletFlow({ platform }) {
  const lines = preamble(platform, "portrait");
  checkSplit(lines, platform);
  return `${[...lines, "- runFlow:", `    file: ${yamlString(resolve(TABLET_FLOW))}`, "    env:", `      FIRST_ROW: ${yamlString(LEFT_FIRST_ROW[platform])}`, `      SECOND_ROW: ${yamlString(LEFT_SECOND_ROW[platform])}`].join("\n")}\n`;
}

/** One pass of the perf sequence from a fresh launch. */
function buildPerfFlow({ platform, target }) {
  const lines = preamble(platform, target === "tablet" ? "portrait" : null);
  openScreen(lines, platform, "cohub://settings", target !== "tablet", "Appearance");
  pushSteps(lines, platform, PERF_STEPS[target]);
  return `${lines.join("\n")}\n`;
}

/** Records each interaction from its settled start screen to its settled end. */
function buildMotionFlow({ platform, motions }) {
  const lines = preamble(platform);
  for (const [index, motion] of motions.entries()) {
    openScreen(lines, platform, motion.link, index === 0, motion.ready);
    pushSteps(lines, platform, motion.setup);
    lines.push(`- startRecording: ${yamlString(motion.name)}`);
    pushSteps(lines, platform, motion.steps);
    lines.push("- stopRecording");
  }
  return `${lines.join("\n")}\n`;
}

function findFile(root, name) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (entry === name) return path;
    if (statSync(path).isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    }
  }
  return null;
}

const MAESTRO_ATTEMPT_MS = 30 * 60 * 1000;

function runMaestro({ device, flowPath, out, testOutput }) {
  const credentials = ["E2E_ACCOUNT_EMAIL", "E2E_ACCOUNT_PASSWORD"].map((key) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`${key} is required: every screen renders AuthScreen until a session exists (dev tenant account).`);
    return `${key}=${value}`;
  });
  // Kept inside the uploaded directory so a failed run carries Maestro's own screenshots and view hierarchy.
  const debugOutput = join(out, "maestro-debug", basename(flowPath, ".yaml"));
  const args = ["test", "--device", device, "--debug-output", debugOutput, "--test-output-dir", testOutput, ...credentials.flatMap((pair) => ["-e", pair]), flowPath];
  // A failed iOS `viewHierarchy` request can leave Maestro hung instead of exiting, so each attempt is capped.
  const run = () => spawnSync("maestro", args, { cwd: out, stdio: "inherit", timeout: MAESTRO_ATTEMPT_MS, killSignal: "SIGKILL" });
  const timedOut = (value) => value.error?.code === "ETIMEDOUT";
  let result = run();
  // Maestro's on-device driver dies mid-run often enough on CI emulators that two retries are worth it,
  // after a pause for the device to settle (as in scripts/e2e/android.mjs).
  for (let attempt = 2; attempt <= 3 && (timedOut(result) || (!result.error && result.status !== 0)); attempt += 1) {
    process.stdout.write(`Maestro ${timedOut(result) ? "timed out" : "failed"} on ${basename(flowPath)}; retrying (attempt ${attempt} of 3).\n`);
    sleepSync(15_000);
    result = run();
  }
  // Maestro records `-e` values verbatim in commands.json and its logs, and this directory is uploaded.
  const secrets = credentials.map((pair) => pair.slice(pair.indexOf("=") + 1));
  redact(debugOutput, secrets);
  redact(testOutput, secrets);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Maestro failed on ${basename(flowPath)}. Its screenshots and view hierarchy are in ${debugOutput}.`);
}

const MAX_REDACTED_BYTES = 32 * 1024 * 1024;

function redact(root, secrets) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      redact(path, secrets);
    } else if (/\.(json|log|txt|yaml|xml)$/.test(entry)) {
      // Native diagnostics (`cohub-diag:` lines) go up beside the log, which is not uploaded.
      if (entry.endsWith(".log") && !entry.includes("cohub-diag")) {
        const found = spawnSync("grep", ["-h", "cohub-diag", path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        if (found.stdout) writeFileSync(`${path}.cohub-diag.txt`, found.stdout);
      }
      // The simulator's own log can pass the largest string Node can hold; nobody reads it, so it goes.
      if (statSync(path).size > MAX_REDACTED_BYTES) {
        rmSync(path);
        continue;
      }
      const source = readFileSync(path, "utf8");
      // XCTest types the first character on its own and logs the remaining text.
      const variants = secrets.flatMap((secret) => [secret, secret.slice(1)]).filter((value) => value.length >= 4).sort((a, b) => b.length - a.length);
      const clean = variants.reduce((text, secret) => text.split(secret).join("***"), source);
      if (clean !== source) writeFileSync(path, clean);
    }
  }
}

function androidDevice() {
  const serials = run("adb", ["devices"]).split("\n").slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
  if (serials.length === 0) throw new Error("No Android device or emulator is connected.");
  return serials[0];
}

function assertBand(group, [width, height], source) {
  const band = SIZE_BANDS[group];
  const inside = width >= band.width[0] && width <= band.width[1] && height >= band.height[0] && height <= band.height[1];
  if (!inside) throw new Error(`${source} lays out at ${width}×${height} pt, outside ${group} (${band.width.join("–")} × ${band.height.join("–")}). Pick a device for this target.`);
  process.stdout.write(`${group}: ${width}×${height} pt (${source})\n`);
}

const android = {
  prepare(app, out, target) {
    requireCommand("adb", ["version"], "Install Android platform-tools.");
    const serial = androidDevice();
    const adb = (...args) => run("adb", ["-s", serial, ...args]);
    adb("install", "-r", "-d", app);
    adb("reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`);
    const setAnimations = (on) => {
      for (const scale of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) adb("shell", "settings", "put", "global", scale, on ? "1" : "0");
    };
    setAnimations(false);
    const size = /(\d+)x(\d+)/.exec(adb("shell", "wm", "size"));
    if (!size) throw new Error("Could not read the emulator's screen size from `wm size`.");
    const [naturalWidth, naturalHeight] = [Number(size[1]), Number(size[2])];
    // A phone is set to the iPhone's width; a tablet keeps its own density.
    if (target === "phone") adb("shell", "wm", "density", String(Math.round((naturalWidth / LOGICAL_WIDTH) * 160)));
    const density = Number(/(\d+)\s*$/.exec(adb("shell", "wm", "density").trim())?.[1]);
    if (!density) throw new Error("Could not read the emulator's density from `wm density`.");
    // Rotation 0 is the panel's natural orientation, which is landscape on a tablet such as the Pixel Tablet.
    const naturalLandscape = naturalWidth > naturalHeight;
    const rotationFor = (orientation) => (orientation === "landscape") === naturalLandscape ? 0 : 1;
    // The software-rendered emulator often raises "isn't responding" dialogs over the app under test.
    adb("shell", "settings", "put", "global", "hide_error_dialogs", "1");
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1");
    const demo = (...extra) => adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", ...extra);
    // System UI can drop demo mode when it restarts (a density or night-mode change), so it is re-entered per run.
    const demoStatusBar = () => {
      demo("-e", "command", "enter");
      demo("-e", "command", "clock", "-e", "hhmm", "0941");
      demo("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
      demo("-e", "command", "notifications", "-e", "visible", "false");
    };
    return {
      device: serial,
      setTheme: (theme) => {
        adb("shell", "cmd", "uimode", "night", theme === "dark" ? "yes" : "no");
        demoStatusBar();
        // A night-mode switch restarts System UI and recreates activities; Maestro's first dump can time out meanwhile.
        sleepSync(5_000);
      },
      setAnimations,
      setOrientation: (orientation) => {
        adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
        adb("shell", "settings", "put", "system", "user_rotation", String(rotationFor(orientation)));
        sleepSync(2_000);
      },
      logicalSize: (orientation) => {
        const turned = rotationFor(orientation) % 2 === 1;
        const [width, height] = turned ? [naturalHeight, naturalWidth] : [naturalWidth, naturalHeight];
        return [Math.round((width * 160) / density), Math.round((height * 160) / density)];
      },
      pullDatabase: (directory) => {
        for (const suffix of ["", "-wal", "-shm"]) {
          const result = spawnSync("adb", ["-s", serial, "exec-out", "run-as", PACKAGE_ID, "cat", `files/SQLite/cohub-mobile.db${suffix}`], { maxBuffer: 256 * 1024 * 1024 });
          if (result.status === 0 && result.stdout.length > 0) writeFileSync(join(directory, `cohub-mobile.db${suffix}`), result.stdout);
          else if (!suffix) throw new Error("Could not read cohub-mobile.db from the debug app with `run-as`.");
        }
      },
      restore() {
        run("adb", ["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "1"], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "wm", "density", "reset"], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "settings", "put", "global", "hide_error_dialogs", "0"], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"], { allowFailure: true });
      },
    };
  },
};

const ios = {
  prepare(app, out, target) {
    requireCommand("xcrun", ["--version"], "iOS capture needs macOS with Xcode.");
    const devices = Object.values(JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "-j"])).devices).flat();
    const sizes = IOS_DEVICES[target];
    const device = Object.keys(sizes).map((name) => devices.find((candidate) => candidate.name === name)).find(Boolean);
    if (!device) throw new Error(`No ${target} simulator among ${Object.keys(sizes).join(", ")}. Install one in Xcode > Settings > Components, or add its logical size to IOS_DEVICES.`);
    const [portraitWidth, portraitHeight] = sizes[device.name];
    if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
    run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
    let appPath = app;
    if (app.endsWith(".zip")) {
      const unpacked = join(out, "app");
      rmSync(unpacked, { recursive: true, force: true });
      run("ditto", ["-x", "-k", app, unpacked]);
      const bundle = readdirSync(unpacked).find((entry) => entry.endsWith(".app"));
      if (!bundle) throw new Error(`${app} does not contain a .app bundle.`);
      appPath = join(unpacked, bundle);
    }
    run("xcrun", ["simctl", "install", device.udid, appPath]);
    run("xcrun", ["simctl", "status_bar", device.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"]);
    return {
      device: device.udid,
      setTheme: (theme) => run("xcrun", ["simctl", "ui", device.udid, "appearance", theme]),
      setAnimations: () => undefined,
      // Maestro turns the simulator in each flow's preamble.
      setOrientation: () => undefined,
      logicalSize: (orientation) => orientation === "landscape" ? [portraitHeight, portraitWidth] : [portraitWidth, portraitHeight],
      pullDatabase: (directory) => {
        const container = run("xcrun", ["simctl", "get_app_container", device.udid, PACKAGE_ID, "data"]).trim();
        const source = join(container, "Documents", "SQLite");
        for (const suffix of ["", "-wal", "-shm"]) {
          const path = join(source, `cohub-mobile.db${suffix}`);
          if (existsSync(path)) writeFileSync(join(directory, `cohub-mobile.db${suffix}`), readFileSync(path));
          else if (!suffix) throw new Error(`No cohub-mobile.db in ${source}.`);
        }
      },
      restore: () => run("xcrun", ["simctl", "status_bar", device.udid, "clear"], { allowFailure: true }),
    };
  },
};

async function capture(options) {
  requireCommand("maestro", ["--version"], "Install Maestro: curl -Ls https://get.maestro.mobile.dev | bash");
  const catalog = options.target === "tablet" ? TABLET_SCREENS : SCREENS;
  const screens = options.screens ? catalog.filter((screen) => options.screens.includes(screen.name)) : catalog;
  mkdirSync(options.out, { recursive: true });
  const device = (options.platform === "android" ? android : ios).prepare(options.app, options.out, options.target);
  const metro = options.metro ? await startMetro({ frameProbe: options.perf > 0 }) : null;
  const missing = [];
  // The phone keeps the original layout (`<theme>/`); other targets are grouped by device and orientation.
  const groupDirectory = (orientation) => options.target === "phone" ? options.out : join(options.out, `${options.target}-${orientation}`);
  try {
    for (const orientation of options.orientations) {
      const group = `${options.target}-${orientation}`;
      device.setOrientation(orientation);
      assertBand(group, device.logicalSize(orientation), options.platform === "android" ? "the emulator" : "the simulator");
      for (const theme of options.themes) {
        const directory = join(groupDirectory(orientation), theme);
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        device.setTheme(theme);
        const name = options.target === "phone" ? theme : `${group}-${theme}`;
        const flowPath = join(options.out, `${name}.yaml`);
        writeFileSync(flowPath, buildFlow({ platform: options.platform, screens, target: options.target, orientation }));
        const testOutput = join(options.out, "maestro-output", name);
        rmSync(testOutput, { recursive: true, force: true });
        runMaestro({ device: device.device, flowPath, out: options.out, testOutput });
        for (const screen of screens) {
          const file = `${screen.name}.png`;
          // Maestro may nest screenshots in a per-run folder under its test output directory.
          const found = findFile(testOutput, file);
          if (found) run("mv", [found, join(directory, file)]);
          else missing.push(`${relative(options.out, directory)}/${file}`);
        }
      }
    }
    if (options.target === "tablet") {
      const directory = join(options.out, "tablet-flow");
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      device.setTheme("light");
      device.setOrientation("portrait");
      const flowPath = join(options.out, "tablet-flow.yaml");
      writeFileSync(flowPath, buildTabletFlow({ platform: options.platform }));
      const testOutput = join(options.out, "maestro-output", "tablet-flow");
      rmSync(testOutput, { recursive: true, force: true });
      runMaestro({ device: device.device, flowPath, out: options.out, testOutput });
      for (const file of listFiles(testOutput).filter((path) => path.endsWith(".png"))) run("mv", [file, join(directory, basename(file))]);
    }
    if (options.motion && options.target === "phone") {
      const directory = join(options.out, "motion");
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      device.setTheme("light");
      device.setAnimations(true);
      const flowPath = join(options.out, "motion.yaml");
      writeFileSync(flowPath, buildMotionFlow({ platform: options.platform, motions: MOTIONS }));
      const testOutput = join(options.out, "maestro-output", "motion");
      rmSync(testOutput, { recursive: true, force: true });
      runMaestro({ device: device.device, flowPath, out: options.out, testOutput });
      device.setAnimations(false);
      for (const motion of MOTIONS) {
        const file = `${motion.name}.mp4`;
        const found = findFile(testOutput, file);
        if (found) run("mv", [found, join(directory, file)]);
        else missing.push(`motion/${file}`);
      }
    }
    if (options.perf > 0) await capturePerf(options, device);
  } finally {
    stopMetro(metro);
    device.restore();
  }
  if (missing.length) throw new Error(`Maestro finished but these captures are missing: ${missing.join(", ")}.`);
  process.stdout.write(`Captured ${screens.length} screens × ${options.themes.length} themes × ${options.orientations.length} orientations${options.motion && options.target === "phone" ? ` and ${MOTIONS.length} recordings` : ""} in ${options.out}\n`);
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * Runs the perf sequence `options.perf` times from fresh launches in portrait, animations on, and
 * keeps every frame-probe record inside each run's window. The probe only records UI frames over
 * 25 ms and JS stalls over 50 ms, so a quiet run has no rows at all.
 */
async function capturePerf(options, device) {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = join(options.out, "perf");
  mkdirSync(directory, { recursive: true });
  const group = `${options.target}-portrait`;
  device.setTheme("light");
  device.setOrientation("portrait");
  device.setAnimations(true);
  const flowPath = join(options.out, "perf.yaml");
  writeFileSync(flowPath, buildPerfFlow({ platform: options.platform, target: options.target }));
  const runs = [];
  try {
    for (let index = 1; index <= options.perf; index += 1) {
      const testOutput = join(options.out, "maestro-output", `perf-${index}`);
      rmSync(testOutput, { recursive: true, force: true });
      const startedAt = new Date().toISOString();
      runMaestro({ device: device.device, flowPath, out: options.out, testOutput });
      runs.push({ run: index, startedAt, endedAt: new Date().toISOString() });
    }
  } finally {
    device.setAnimations(false);
  }
  // The app flushes its log every 500 ms.
  sleepSync(2_000);
  const pulled = join(directory, `${group}-db`);
  rmSync(pulled, { recursive: true, force: true });
  mkdirSync(pulled, { recursive: true });
  device.pullDatabase(pulled);
  const database = new DatabaseSync(join(pulled, "cohub-mobile.db"), { readOnly: true });
  const rows = database.prepare("SELECT timestamp, name, payload FROM debug_events WHERE name LIKE 'perf.%' ORDER BY timestamp").all();
  database.close();
  rmSync(pulled, { recursive: true, force: true });
  const result = runs.map((entry) => ({ ...entry, events: rows.filter((row) => row.timestamp >= entry.startedAt && row.timestamp <= entry.endedAt).map((row) => ({ timestamp: row.timestamp, name: row.name, ...JSON.parse(row.payload) })) }));
  writeFileSync(join(directory, `${group}.json`), `${JSON.stringify({ platform: options.platform, group, steps: PERF_STEPS[options.target], runs: result }, null, 2)}\n`);
  for (const entry of result) {
    const count = (name) => entry.events.filter((event) => event.name === name).length;
    process.stdout.write(`perf ${group} run ${entry.run} (${entry.startedAt} → ${entry.endedAt}): ${count("perf.ui_jank")} ui_jank windows, ${count("perf.js_stall")} js_stall windows\n`);
  }
}

function compare(options) {
  const magick = spawnSync("magick", ["-version"], { stdio: "ignore" }).error ? "convert" : "magick";
  requireCommand(magick, ["-version"], "Install ImageMagick (apt-get install imagemagick / brew install imagemagick).");
  mkdirSync(options.out, { recursive: true });
  const paired = [];
  const unmatched = [];
  // The phone's screenshots sit at the top level; other targets in `<target>-<orientation>/`.
  const groups = new Set([""]);
  for (const root of [options.ios, options.android]) for (const entry of existsSync(root) ? readdirSync(root) : []) if (/^[a-z]+-(?:portrait|landscape)$/.test(entry)) groups.add(entry);
  for (const group of [...groups].sort()) for (const theme of ["light", "dark"]) {
    const iosDirectory = join(options.ios, group, theme);
    const androidDirectory = join(options.android, group, theme);
    if (!existsSync(iosDirectory) && !existsSync(androidDirectory)) continue;
    const names = new Set([...(existsSync(iosDirectory) ? readdirSync(iosDirectory) : []), ...(existsSync(androidDirectory) ? readdirSync(androidDirectory) : [])].filter((name) => name.endsWith(".png")));
    for (const name of [...names].sort()) {
      const left = join(iosDirectory, name);
      const right = join(androidDirectory, name);
      if (!existsSync(left) || !existsSync(right)) {
        unmatched.push(`${group ? `${group}/` : ""}${theme}/${name}`);
        continue;
      }
      const output = join(options.out, `${name.replace(/\.png$/, "")}${group ? `.${group}` : ""}.${theme}.png`);
      // iOS on the left, Android on the right, both scaled to one height with a gutter between.
      run(magick, [left, "-resize", `x${PAIR_HEIGHT}`, "(", "-size", `24x${PAIR_HEIGHT}`, "xc:#808080", ")", "(", right, "-resize", `x${PAIR_HEIGHT}`, ")", "+append", "+repage", output]);
      paired.push(output);
    }
  }
  const motionPairs = pairMotion(options, unmatched);
  if (paired.length === 0 && motionPairs === 0) throw new Error(`No screen exists on both platforms under ${options.ios} and ${options.android}.`);
  if (unmatched.length) process.stdout.write(`Captured on one platform only: ${unmatched.join(", ")}\n`);
  process.stdout.write(`Paired ${paired.length} screenshots and ${motionPairs} recordings (left iOS, right Android) in ${options.out}\n`);
}

/**
 * Seconds before the first change on screen. Each platform starts recording at its own moment, so
 * pairs are trimmed to start just before their first interaction and play in step.
 */
function firstChange(path) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-vf", "freezedetect=n=0.003:d=0.2", "-map", "0:v", "-f", "null", "-"], { encoding: "utf8" });
  const match = /freeze_start: 0(?:\.0+)?\b[\s\S]*?freeze_end: ([\d.]+)/.exec(result.stderr ?? "");
  return match ? Number(match[1]) : 0;
}

/** Recordings side by side at one height and frame rate, aligned on their first change; the shorter one holds its last frame. */
function pairMotion(options, unmatched) {
  const iosDirectory = join(options.ios, "motion");
  const androidDirectory = join(options.android, "motion");
  if (!existsSync(iosDirectory) || !existsSync(androidDirectory)) return 0;
  requireCommand("ffmpeg", ["-version"], "Install ffmpeg (apt-get install ffmpeg / brew install ffmpeg) to pair recordings.");
  const directory = join(options.out, "motion");
  mkdirSync(directory, { recursive: true });
  let count = 0;
  const names = new Set([...readdirSync(iosDirectory), ...readdirSync(androidDirectory)].filter((name) => name.endsWith(".mp4")));
  for (const name of [...names].sort()) {
    const left = join(iosDirectory, name);
    const right = join(androidDirectory, name);
    if (!existsSync(left) || !existsSync(right)) {
      unmatched.push(`motion/${name}`);
      continue;
    }
    const height = 1280;
    const lead = 0.3;
    const trim = (path) => String(Math.max(0, firstChange(path) - lead));
    run("ffmpeg", ["-y", "-loglevel", "error", "-ss", trim(left), "-i", left, "-ss", trim(right), "-i", right, "-filter_complex",
      `[0:v]fps=30,scale=-2:${height},setsar=1[a];[1:v]fps=30,scale=-2:${height},setsar=1[b];[a]pad=iw+24:ih:0:0:color=0x808080[ag];[ag][b]hstack=inputs=2`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(directory, name)]);
    count += 1;
  }
  return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "capture") await capture(options);
    else if (options.command === "redact") redact(options.dir, ["E2E_ACCOUNT_EMAIL", "E2E_ACCOUNT_PASSWORD"].map((key) => process.env[key]?.trim()).filter(Boolean));
    else compare(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
