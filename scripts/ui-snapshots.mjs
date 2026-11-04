import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * Captures the same screens on iOS and Android and pairs them side by side, so the drawn Android
 * UI can be compared with the iOS system UI without a local simulator.
 *
 *   capture --platform android|ios --app <apk|.app|.zip> [--out dir] [--screens a,b] [--themes light,dark] [--no-metro]
 *   compare --ios <dir> --android <dir> [--out dir]
 *   redact --dir <dir>   (replaces E2E_ACCOUNT_* values in text files before an upload)
 *
 * Capture runs a debug binary against a local Metro, so a JS-only change needs no native rebuild.
 */

const PACKAGE_ID = "io.github.markbang.cohubmobile";
const METRO_PORT = 8081;
const LOGIN_FLOWS = { android: "e2e/auth/login.yaml", ios: "e2e/auth/login.ios.yaml" };
// iPhone 16 Pro width; the Android emulator's density is set so both lay out at the same width.
const LOGICAL_WIDTH = 393;
const IOS_DEVICES = ["iPhone 16 Pro", "iPhone 17 Pro", "iPhone 16", "iPhone 17"];
const PAIR_HEIGHT = 1400;
const DEV_SERVER_ERROR = "Could not connect to development server";

export const SCREENS = [
  { name: "catalog-type", link: "cohub://debug/ui?section=type" },
  { name: "catalog-rows", link: "cohub://debug/ui?section=rows" },
  { name: "catalog-controls", link: "cohub://debug/ui?section=controls" },
  { name: "catalog-states", link: "cohub://debug/ui?section=states" },
  { name: "catalog-menu", link: "cohub://debug/ui?section=menu", steps: [{ tapOn: "Open menu" }] },
  { name: "catalog-sheet", link: "cohub://debug/ui?section=sheet" },
  { name: "catalog-confirm", link: "cohub://debug/ui?section=confirm" },
  { name: "chats", link: "cohub://settings", steps: [{ tapOn: "Chats" }] },
  { name: "spaces", link: "cohub://spaces" },
  { name: "activity", link: "cohub://activity" },
  { name: "settings", link: "cohub://settings" },
  { name: "appearance", link: "cohub://appearance" },
  { name: "about", link: "cohub://about" },
];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, themes: ["light", "dark"], screens: null, metro: true };
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
    else if (flag === "--dir") options.dir = resolve(value());
    else throw new Error(`Unknown argument "${flag}".`);
  }
  if (command === "capture") {
    if (options.platform !== "android" && options.platform !== "ios") throw new Error("--platform must be android or ios.");
    if (!options.app || !existsSync(options.app)) throw new Error("--app must point to a built debug APK (Android) or simulator .app/.zip (iOS).");
    for (const theme of options.themes) if (theme !== "light" && theme !== "dark") throw new Error(`Unknown theme "${theme}". Use light and/or dark.`);
    const known = new Set(SCREENS.map((screen) => screen.name));
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

async function startMetro() {
  const metro = spawn("npx", ["expo", "start", "--port", String(METRO_PORT)], {
    env: { ...process.env, CI: "1", EXPO_PUBLIC_UI_SNAPSHOTS: "1", EXPO_PUBLIC_COHUB_ENV: process.env.EXPO_PUBLIC_COHUB_ENV || "dev" },
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

/** One Maestro run per theme: sign in if needed, then visit and capture each screen. */
function buildFlow({ platform, screens }) {
  const login = resolve(LOGIN_FLOWS[platform]);
  const lines = [
    `appId: ${PACKAGE_ID}`,
    "---",
    "- launchApp:",
    "    stopApp: true",
    "    permissions:",
    "      all: allow",
    // A debug binary fetches its first bundle from Metro, which can take minutes on a cold cache.
    "- extendedWaitUntil:",
    `    visible: ${yamlString(`(Continue with Cohub|Chats|${DEV_SERVER_ERROR}.*)`)}`,
    "    timeout: 600000",
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
  ];
  for (const screen of screens) {
    lines.push(`- openLink: ${yamlString(screen.link)}`);
    lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
    for (const step of screen.steps ?? []) {
      lines.push(`- tapOn: ${yamlString(step.tapOn)}`);
      lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
    }
    // Maestro only writes screenshots inside its test output directory, so the path stays relative.
    lines.push("- takeScreenshot:", `    path: ${yamlString(screen.name)}`);
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

function runMaestro({ device, flowPath, out, testOutput }) {
  const credentials = ["E2E_ACCOUNT_EMAIL", "E2E_ACCOUNT_PASSWORD"].map((key) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`${key} is required: every screen renders AuthScreen until a session exists (dev tenant account).`);
    return `${key}=${value}`;
  });
  // Kept inside the uploaded directory so a failed run carries Maestro's own screenshots and view hierarchy.
  const debugOutput = join(out, "maestro-debug", basename(flowPath, ".yaml"));
  const args = ["test", "--device", device, "--debug-output", debugOutput, "--test-output-dir", testOutput, ...credentials.flatMap((pair) => ["-e", pair]), flowPath];
  let result = spawnSync("maestro", args, { cwd: out, stdio: "inherit" });
  // Maestro's on-device driver dies mid-run often enough that one retry is worth it (as in scripts/e2e/android.mjs).
  if (!result.error && result.status !== 0) {
    process.stdout.write(`Maestro failed on ${basename(flowPath)}; retrying once.\n`);
    rmSync(testOutput, { recursive: true, force: true });
    result = spawnSync("maestro", args, { cwd: out, stdio: "inherit" });
  }
  // Maestro records `-e` values verbatim in commands.json and its logs, and this directory is uploaded.
  const secrets = credentials.map((pair) => pair.slice(pair.indexOf("=") + 1));
  redact(debugOutput, secrets);
  redact(testOutput, secrets);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Maestro failed on ${basename(flowPath)}. Its screenshots and view hierarchy are in ${debugOutput}.`);
}

function redact(root, secrets) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      redact(path, secrets);
    } else if (/\.(json|log|txt|yaml|xml)$/.test(entry)) {
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

const android = {
  prepare(app) {
    requireCommand("adb", ["version"], "Install Android platform-tools.");
    const serial = androidDevice();
    const adb = (...args) => run("adb", ["-s", serial, ...args]);
    adb("install", "-r", "-d", app);
    adb("reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`);
    for (const scale of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) adb("shell", "settings", "put", "global", scale, "0");
    const size = /(\d+)x(\d+)/.exec(adb("shell", "wm", "size"));
    if (!size) throw new Error("Could not read the emulator's screen size from `wm size`.");
    adb("shell", "wm", "density", String(Math.round((Number(size[1]) / LOGICAL_WIDTH) * 160)));
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1");
    const demo = (...extra) => adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", ...extra);
    demo("-e", "command", "enter");
    demo("-e", "command", "clock", "-e", "hhmm", "0941");
    demo("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
    demo("-e", "command", "notifications", "-e", "visible", "false");
    return {
      device: serial,
      setTheme: (theme) => adb("shell", "cmd", "uimode", "night", theme === "dark" ? "yes" : "no"),
      restore() {
        run("adb", ["-s", serial, "shell", "wm", "density", "reset"], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"], { allowFailure: true });
      },
    };
  },
};

const ios = {
  prepare(app, out) {
    requireCommand("xcrun", ["--version"], "iOS capture needs macOS with Xcode.");
    const devices = Object.values(JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "-j"])).devices).flat();
    const device = IOS_DEVICES.map((name) => devices.find((candidate) => candidate.name === name)).find(Boolean)
      ?? devices.find((candidate) => candidate.name.startsWith("iPhone"));
    if (!device) throw new Error("No available iPhone simulator. Install one in Xcode > Settings > Components.");
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
      restore: () => run("xcrun", ["simctl", "status_bar", device.udid, "clear"], { allowFailure: true }),
    };
  },
};

async function capture(options) {
  requireCommand("maestro", ["--version"], "Install Maestro: curl -Ls https://get.maestro.mobile.dev | bash");
  const screens = options.screens ? SCREENS.filter((screen) => options.screens.includes(screen.name)) : SCREENS;
  mkdirSync(options.out, { recursive: true });
  const target = (options.platform === "android" ? android : ios).prepare(options.app, options.out);
  const metro = options.metro ? await startMetro() : null;
  const missing = [];
  try {
    for (const theme of options.themes) {
      const directory = join(options.out, theme);
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      target.setTheme(theme);
      const flowPath = join(options.out, `${theme}.yaml`);
      writeFileSync(flowPath, buildFlow({ platform: options.platform, screens }));
      const testOutput = join(options.out, "maestro-output", theme);
      rmSync(testOutput, { recursive: true, force: true });
      runMaestro({ device: target.device, flowPath, out: options.out, testOutput });
      for (const screen of screens) {
        const file = `${screen.name}.png`;
        // Maestro may nest screenshots in a per-run folder under its test output directory.
        const found = findFile(testOutput, file);
        if (found) run("mv", [found, join(directory, file)]);
        else missing.push(`${theme}/${file}`);
      }
    }
  } finally {
    stopMetro(metro);
    target.restore();
  }
  if (missing.length) throw new Error(`Maestro finished but these screenshots are missing: ${missing.join(", ")}.`);
  process.stdout.write(`Captured ${screens.length} screens × ${options.themes.length} themes in ${options.out}\n`);
}

function compare(options) {
  const magick = spawnSync("magick", ["-version"], { stdio: "ignore" }).error ? "convert" : "magick";
  requireCommand(magick, ["-version"], "Install ImageMagick (apt-get install imagemagick / brew install imagemagick).");
  mkdirSync(options.out, { recursive: true });
  const paired = [];
  const unmatched = [];
  for (const theme of ["light", "dark"]) {
    const iosDirectory = join(options.ios, theme);
    const androidDirectory = join(options.android, theme);
    if (!existsSync(iosDirectory) && !existsSync(androidDirectory)) continue;
    const names = new Set([...(existsSync(iosDirectory) ? readdirSync(iosDirectory) : []), ...(existsSync(androidDirectory) ? readdirSync(androidDirectory) : [])].filter((name) => name.endsWith(".png")));
    for (const name of [...names].sort()) {
      const left = join(iosDirectory, name);
      const right = join(androidDirectory, name);
      if (!existsSync(left) || !existsSync(right)) {
        unmatched.push(`${theme}/${name}`);
        continue;
      }
      const output = join(options.out, `${name.replace(/\.png$/, "")}.${theme}.png`);
      // iOS on the left, Android on the right, both scaled to one height with a gutter between.
      run(magick, [left, "-resize", `x${PAIR_HEIGHT}`, "(", "-size", `24x${PAIR_HEIGHT}`, "xc:#808080", ")", "(", right, "-resize", `x${PAIR_HEIGHT}`, ")", "+append", "+repage", output]);
      paired.push(output);
    }
  }
  if (paired.length === 0) throw new Error(`No screen exists on both platforms under ${options.ios} and ${options.android}.`);
  if (unmatched.length) process.stdout.write(`Captured on one platform only: ${unmatched.join(", ")}\n`);
  process.stdout.write(`Paired ${paired.length} screenshots (left iOS, right Android) in ${options.out}\n`);
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
