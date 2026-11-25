import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, parseAllDocuments } from "yaml";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFlow, buildMotionFlow, buildTabletFlow, expectedOutputs, launchMaestro, MOTIONS, planShards, runFlowWithRetries, SCREENS, TABLET_SCREENS } from "./ui-snapshots.mjs";
import { clampToLastFrame, frameTimes, lastTimeIn, recordingClock } from "./ui-snapshots-frames.mjs";

// iOS asks "Open in Cohub?" once per simulator, on the flow's first link, and the question can arrive after the
// link returns. The first link waits for the question or the screen, answers the question, then waits for the screen.
const [first, second] = SCREENS;
const flow = (platform, screens) => buildFlow({ platform, session: true, screens, target: "phone", orientation: "portrait" });
const ios = flow("ios", [first, second]);
const firstLink = ios.indexOf(`- openLink: ${JSON.stringify(first.link)}`);
const secondLink = ios.indexOf(`- openLink: ${JSON.stringify(second.link)}`);
const firstBlock = ios.slice(firstLink, secondLink);
const ask = firstBlock.indexOf("Open in .*Cohub");
const answer = firstBlock.indexOf("tapOn: \"^Open$\"");
const screenAfter = firstBlock.indexOf(`.*${first.ready}.*`, answer);
assert.ok(ask > 0 && answer > ask && screenAfter > answer, "the first link waits for the question, answers it, then waits for the screen");
assert.equal((firstBlock.match(/timeout: 60000/g) ?? []).length, 2, "the first link's waits allow a cold Metro (60 s)");
assert.ok(!ios.slice(secondLink).includes("Open in .*Cohub"), "later links do not check for the question");
assert.ok(!flow("android", [first]).includes(`"(Open in`), "Android does not wait for the question with the screen");

// A landscape flow answers the once-per-simulator link question on a portrait launch, then launches the app in landscape.
const landscapeFlow = buildFlow({ platform: "ios", session: true, screens: TABLET_SCREENS.slice(0, 1), target: "tablet", orientation: "landscape" });
const portraitLaunch = landscapeFlow.indexOf("- setOrientation: PORTRAIT");
const firstLaunch = landscapeFlow.indexOf("- launchApp:");
const questionAnswer = landscapeFlow.indexOf("tapOn: \"^Open$\"");
const landscapeLaunch = landscapeFlow.lastIndexOf("- launchApp:");
assert.ok(portraitLaunch > 0 && portraitLaunch < firstLaunch && firstLaunch < questionAnswer, "the landscape flow launches in portrait and answers the link question there");
assert.ok(landscapeFlow.lastIndexOf("- setOrientation: LANDSCAPE_LEFT", landscapeLaunch) > questionAnswer && landscapeLaunch > questionAnswer, "the landscape flow turns the device before its screens' launch");
assert.equal(landscapeFlow.indexOf("- setOrientation: PORTRAIT", firstLaunch), -1, "the landscape flow stays in portrait only for the question");
const portraitFlow = buildFlow({ platform: "ios", session: true, screens: TABLET_SCREENS.slice(0, 1), target: "tablet", orientation: "portrait" });
assert.ok(portraitFlow.indexOf("- setOrientation: PORTRAIT") > 0 && portraitFlow.indexOf("- setOrientation: PORTRAIT") < portraitFlow.indexOf("- launchApp:"), "the portrait flow turns the device before it launches the app");
assert.equal(portraitFlow.includes("LANDSCAPE_LEFT"), false, "the portrait flow does not ask the link question on a landscape launch");
assert.equal(buildFlow({ platform: "ios", session: true, screens: SCREENS.slice(0, 1), target: "phone", orientation: "portrait" }).includes("setOrientation"), false, "a phone flow does not turn the device");
const tabletFlowLandscape = buildTabletFlow({ platform: "ios", session: true, maestroOrientation: (orientation) => (orientation === "landscape" ? "LANDSCAPE_LEFT" : "PORTRAIT") });
assert.ok(tabletFlowLandscape.indexOf("- setOrientation: PORTRAIT") < tabletFlowLandscape.indexOf("- launchApp:"), "the split-flow run turns the device before it launches the app");

// The question's Open button: a landscape window's question is tapped by position, every other one by its text.
const openTaps = (flowText) => ({ text: flowText.split("tapOn: \"^Open$\"").length - 1, point: flowText.split("point: \"56%, 51%\"").length - 1 });
const landscapeQuestions = openTaps(landscapeFlow);
assert.deepEqual(landscapeQuestions, { text: 1, point: 2 }, "the landscape flow taps the question by its text only in the portrait launch, and by position in the landscape launch and the split check");
assert.deepEqual(openTaps(portraitFlow), { text: 2, point: 0 }, "a portrait flow taps the question by its text");
assert.deepEqual(openTaps(buildFlow({ platform: "ios", session: true, screens: SCREENS.slice(0, 1), target: "phone", orientation: "portrait" })), { text: 2, point: 0 }, "a phone flow taps the question by its text");
for (const flowText of [landscapeFlow, portraitFlow, buildTabletFlow({ platform: "ios", session: true, maestroOrientation: (orientation) => (orientation === "landscape" ? "LANDSCAPE_LEFT" : "PORTRAIT") })]) {
  const documents = parseAllDocuments(flowText);
  assert.deepEqual(documents.flatMap((document) => document.errors.map(String)), [], "a generated flow is valid YAML");
}

const all = { targets: ["phone", "tablet"], orientations: null, screens: null, scope: "full", themes: ["light"], textSizes: ["default"], motion: false, perf: 0 };
const defaults = planShards(all);
assert.equal(defaults.length, 5, "the default list (light, phone and tablet, no motion) is five jobs, the most GitHub runs at once: phone 2, tablet portrait 1, tablet landscape 1, split flows 1");
assert.equal(new Set(defaults.map((entry) => entry.artifact)).size, defaults.length, "every job uploads under its own artifact name");
assert.ok(defaults.every((entry) => entry.part === "flow" || entry.screens.length > 0), "no job is empty");

const covered = (target, orientation) => defaults.filter((entry) => entry.part === "screens" && entry.target === target && entry.orientations.includes(orientation)).flatMap((entry) => entry.screens);
assert.deepEqual(covered("phone", "portrait"), SCREENS.map((screen) => screen.name), "the phone's screens are covered once each, in order");
assert.deepEqual(covered("tablet", "portrait"), TABLET_SCREENS.map((screen) => screen.name), "tablet portrait is covered once each, in order");
assert.deepEqual(covered("tablet", "landscape"), TABLET_SCREENS.map((screen) => screen.name), "tablet landscape is covered once each, in order");
const flows = defaults.filter((entry) => entry.part === "flow");
assert.equal(flows.length, 1, "the split flows are one job");
assert.equal(flows[0].target, "tablet", "the split flows run on the tablet");
assert.ok(!defaults.some((entry) => entry.part === "motion" || entry.part === "perf"), "no motion or perf job unless asked");

const single = planShards({ ...all, targets: ["phone"], screens: ["catalog-rows"] });
assert.deepEqual(single.map((entry) => [entry.artifact, entry.part, entry.screens]), [["ui-snapshots-ios-0", "screens", ["catalog-rows"]]], "one screen on one target is one job");
const landscape = planShards({ ...all, targets: ["tablet"], orientations: ["landscape"], screens: ["split-space"] });
assert.deepEqual(landscape.map((entry) => [entry.orientations.join("/"), entry.part, entry.screens]), [["landscape", "screens", ["split-space"]]], "a tablet orientation with one screen has no flow job");
assert.deepEqual(planShards({ ...all, targets: ["phone"], screens: ["split-space"] }), [], "a run naming only tablet screens has no phone job");

const doubled = planShards({ ...all, targets: ["phone"], themes: ["light", "dark"] });
assert.equal(doubled.length, 4, "both themes double the phone's work into four jobs");
assert.deepEqual(doubled.flatMap((entry) => entry.screens), SCREENS.map((screen) => screen.name), "both themes still cover each phone screen once");
assert.ok(doubled.every((entry) => entry.screens.length <= 12), "no doubled phone job holds more than twelve screens");

const motionPlan = planShards({ ...all, targets: ["phone"], motion: true });
const motions = motionPlan.filter((entry) => entry.part === "motion");
assert.deepEqual(motions.flatMap((entry) => entry.screens), MOTIONS.map((motion) => motion.name), "the motion recordings are covered once each");
assert.ok(motions.every((entry) => entry.target === "phone" && entry.orientations.join() === "portrait"), "motion is a phone job");
assert.equal(planShards({ ...all, targets: ["phone"], motion: true, textSizes: ["accessibility-large"] }).filter((entry) => entry.part === "motion").length, 0, "motion runs at the default text size only");
assert.equal(planShards({ ...all, targets: ["tablet"], perf: 2 }).filter((entry) => entry.part === "perf").length, 1, "perf is one job per target");

const expected = (plan, options) => plan.flatMap((entry) => expectedOutputs(entry, options));
const outputs = expected(defaults, { themes: ["light"] });
assert.equal(new Set(outputs).size, outputs.length, "no two jobs write the same file");
const interactionOnly = planShards({ ...all, targets: ["phone"], screens: ["motion-stripes"], themes: ["light"], motion: true, motionThemes: ["light", "dark"] });
assert.deepEqual(interactionOnly.map((entry) => [entry.part, entry.screens]), [["motion", ["motion-stripes"]]], "naming only an interaction plans its motion job, with no screen job");
const bothThemes = planShards({ ...all, targets: ["phone"], motion: true, themes: ["light"], motionThemes: ["light", "dark"] }).filter((entry) => entry.part === "motion");
const bothOutputs = expected(bothThemes, { themes: ["light"], motionThemes: ["light", "dark"] });
assert.ok(MOTIONS.every((motion) => ["light", "dark"].every((theme) => bothOutputs.includes(`motion/${theme}/${motion.name}.mp4`))), "each motion theme writes every video under motion/<theme>/");
assert.ok(!bothOutputs.some((path) => /^motion\/[^/]+\.mp4$/.test(path)), "no video is written at the top of motion/");
const stripesOnly = planShards({ ...all, targets: ["phone"], screens: ["chat-stripes", "motion-stripes"], themes: ["light", "dark"], motion: true, motionThemes: ["light", "dark"] });
assert.deepEqual(stripesOnly.map((entry) => [entry.part, entry.screens]), [["screens", ["chat-stripes"]], ["motion", ["motion-stripes"]]], "--screens names a screen and an interaction, and each job takes its own");
const stripesFiles = expected(stripesOnly.filter((entry) => entry.part === "motion"), { themes: ["light", "dark"], motionThemes: ["light", "dark"] });
const stripesFrames = ["tab-edge", "tab-halfway", "tab-hold", "back-edge", "back-halfway", "back-hold"];
assert.deepEqual([...stripesFiles].sort(), ["light", "dark"].flatMap((theme) => [`motion/${theme}/motion-stripes.json`, `motion/${theme}/motion-stripes.mp4`, ...stripesFrames.map((label) => `motion/${theme}/motion-stripes-${label}.png`)]).sort(), "the stripes recording writes its video, sidecar and six PNG frames in each theme");
assert.ok(outputs.includes("light/catalog-type.png") && outputs.includes("tablet-portrait/light/split-empty.png") && outputs.includes("tablet-landscape/light/split-empty.png"), "the expected paths match the layout compare reads");
assert.ok(outputs.includes("tablet-flow/"), "the split flows' directory is expected");
const sized = expected(planShards({ ...all, targets: ["phone"], screens: ["catalog-rows"], themes: ["light", "dark"], textSizes: ["default", "accessibility-large"] }), { themes: ["light", "dark"] });
assert.deepEqual(sized, ["light/catalog-rows.png", "dark/catalog-rows.png", "light-accessibility-large/catalog-rows.png", "dark-accessibility-large/catalog-rows.png"], "text sizes get suffixed theme directories");

// The core scope: the states that regressed, each in the plan once per target (and per orientation on the tablet).
const PHONE_CORE = ["chats", "chats-scrolled", "chat-conversation", "chat-real", "chat-draft-empty", "chat-draft", "chat-draft-long", "chat-unread", "chat-unread-end", "chat-delivered", "chat-states", "chat-arrival"];
const PHONE_COMPOSER_LARGE = ["chat-draft-empty", "chat-draft", "chat-draft-long"];
const TABLET_CORE = ["split-chat-real", "split-chat-panel", "split-chat-draft-empty", "split-chat-draft", "split-chat-draft-long", "split-space", "split-settings-page", "split-empty"];
const TABLET_COMPOSER_LARGE = ["split-chat-draft-long"];
const sorted = (names) => [...names].sort();
const core = planShards({ ...all, scope: "core", textSizes: null, targets: ["phone", "tablet"] });
const coreAt = (target, textSize, orientation = null) => core.filter((entry) => entry.target === target && entry.textSize === textSize && (orientation === null || entry.orientations.includes(orientation)));
assert.deepEqual(core.map((entry) => [entry.target, entry.orientations.join("/"), entry.textSize, entry.screens.length]), [["phone", "portrait", "default", 12], ["phone", "portrait", "accessibility-large", 3], ["tablet", "portrait", "default", 8], ["tablet", "landscape", "default", 8], ["tablet", "portrait/landscape", "accessibility-large", 1]], "the core set is five jobs, and the large text size has its own job per target");
assert.deepEqual(sorted(coreAt("phone", "default").flatMap((entry) => entry.screens)), sorted(PHONE_CORE), "the phone's core states are each in the plan once");
for (const orientation of ["portrait", "landscape"]) assert.deepEqual(sorted(coreAt("tablet", "default", orientation).flatMap((entry) => entry.screens)), sorted(TABLET_CORE), `the tablet's core states are each in the ${orientation} plan once`);
assert.deepEqual(sorted(coreAt("phone", "accessibility-large").flatMap((entry) => entry.screens)), sorted(PHONE_COMPOSER_LARGE), "the phone's composer is captured at accessibility-large");
assert.deepEqual(sorted(coreAt("tablet", "accessibility-large").flatMap((entry) => entry.screens)), sorted(TABLET_COMPOSER_LARGE), "the tablet's composer is captured at accessibility-large");
assert.ok(core.filter((entry) => entry.textSize !== "default").every((entry) => entry.screens.every((name) => [...PHONE_COMPOSER_LARGE, ...TABLET_COMPOSER_LARGE].includes(name))), "a large-text job carries only composer screens");
assert.ok(core.every((entry) => entry.part === "screens"), "core has no split-flow job: the flows are part of the full list");
assert.deepEqual(sorted(planShards({ ...all, scope: "core", textSizes: ["default"], targets: ["phone"] }).flatMap((entry) => entry.screens)), sorted(PHONE_CORE), "a default-only core run has no composer-large job");
const fullLarge = planShards({ ...all, scope: "full", textSizes: ["accessibility-large"], targets: ["phone"] });
assert.deepEqual(sorted(fullLarge.flatMap((entry) => entry.screens)), sorted(SCREENS.map((screen) => screen.name)), "the full scope captures every screen at a requested large size");

const cli = (args) => spawnSync("node", [fileURLToPath(new URL("./ui-snapshots.mjs", import.meta.url)), "plan", ...args], { encoding: "utf8" });
const cliCore = cli(["--target", "phone,tablet", "--themes", "light", "--no-motion"]);
assert.equal(cliCore.status, 0, cliCore.stderr);
assert.equal(JSON.parse(cliCore.stdout).length, 5, "plan's default scope is core: five jobs");
const cliFull = JSON.parse(cli(["--target", "phone,tablet", "--themes", "light", "--no-motion", "--scope", "full"]).stdout);
assert.equal(cliFull.length, 5, "plan --scope full is the old list: five jobs");
assert.ok(cliFull.some((entry) => entry.part === "flow"), "plan --scope full keeps the split flows");
const named = cli(["--target", "phone", "--themes", "light", "--screens", "chat-stripes,motion-stripes", "--motion-themes", "light,dark"]);
assert.equal(named.status, 0, named.stderr);
assert.deepEqual(JSON.parse(named.stdout).map((entry) => [entry.part, entry.screens]), [["screens", ["chat-stripes"]], ["motion", ["motion-stripes"]]], "plan names a screen and an interaction together, as the workflow passes them");
const unknown = cli(["--target", "phone", "--themes", "light", "--screens", "motion-nope"]);
assert.equal(unknown.status, 1, "an unknown name fails the plan");
assert.match(unknown.stderr, /Unknown screen or interaction "motion-nope"/, "the refusal names the unknown screen or interaction");
const refused = cli(["--target", "phone", "--themes", "light", "--no-motion", "--text-size", "extra-large"]);
assert.deepEqual([refused.status, refused.stdout], [1, ""], "core refuses a text size it does not carry, and names the scope to use");
assert.match(refused.stderr, /use --scope full for extra-large/, "the refusal says which scope takes the size");

const scripted = (results) => {
  const calls = [];
  const launch = async () => {
    calls.push(results.shift());
    return calls.at(-1);
  };
  return { launch, calls };
};
const driverDown = { status: null, timedOut: false, driverHung: false, started: false, output: "iOS driver not ready in time", seconds: 300 };
const flowFailed = { status: 1, timedOut: false, driverHung: false, started: true, output: "Running on iPad", seconds: 600 };
const passed = { status: 0, timedOut: false, driverHung: false, started: true, output: "Running on iPad", seconds: 900 };
const quiet = { pauseMs: 0, pause: async () => {}, log: () => {}, describe: "flow.yaml" };

const drivers = scripted([driverDown, driverDown, passed]);
assert.deepEqual(await runFlowWithRetries(drivers.launch, quiet).then((outcome) => [outcome.ok, drivers.calls.length]), [true, 3], "a driver that starts on its third try runs the flow once");
const flowsRetried = scripted([flowFailed, passed]);
assert.deepEqual(await runFlowWithRetries(flowsRetried.launch, quiet).then((outcome) => [outcome.ok, flowsRetried.calls.length]), [true, 2], "a flow that fails after its driver started is retried");
const dead = scripted([driverDown, driverDown, driverDown]);
const deadOutcome = await runFlowWithRetries(dead.launch, quiet);
assert.deepEqual([deadOutcome.ok, deadOutcome.reason, dead.calls.length], [false, "driver", 3], "a driver that never starts stops after its own three tries");
const firstStart = scripted([{ ...driverDown, output: "iOS driver not ready in time: FIRST START LINE" }, { ...driverDown, output: "iOS driver not ready in time: SECOND START LINE" }, { ...driverDown, output: "iOS driver not ready in time: LAST START LINE" }]);
let driverLogReads = 0;
const firstOutcome = await runFlowWithRetries(firstStart.launch, { ...quiet, driverLog: (attempt) => (driverLogReads += 1, attempt.output) });
assert.deepEqual([firstOutcome.reason, firstOutcome.driverLog, driverLogReads], ["driver", "iOS driver not ready in time: FIRST START LINE", 1], "a driver that never starts keeps the first start's log, read once, not the last start's");
const mixed = scripted([driverDown, flowFailed, driverDown, flowFailed, passed]);
assert.deepEqual(await runFlowWithRetries(mixed.launch, quiet).then((outcome) => [outcome.ok, mixed.calls.length]), [true, 5], "driver starts and flow retries have their own budgets");
const failing = scripted([flowFailed, flowFailed, flowFailed]);
const failingOutcome = await runFlowWithRetries(failing.launch, quiet);
assert.deepEqual([failingOutcome.ok, failingOutcome.reason, failing.calls.length], [false, "flow", 3], "a flow that keeps failing stops after three tries");
const hung = scripted([{ ...driverDown, output: "", driverHung: true }, passed]);
assert.deepEqual(await runFlowWithRetries(hung.launch, quiet).then((outcome) => [outcome.ok, hung.calls.length]), [true, 2], "a start the watchdog killed is a driver start, not a flow failure");

const fakeBin = mkdtempSync(join(tmpdir(), "fake-maestro-"));
writeFileSync(join(fakeBin, "maestro"), `#!/bin/sh
count=$(cat "$FAKE_MAESTRO_COUNT" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$FAKE_MAESTRO_COUNT"
if [ "$count" -le 2 ]; then
  echo "iOS driver not ready in time, consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT env variable"
  exit 1
fi
echo "Running on iPad (A16) - iOS 27.0 - FAKE"
echo " > Flow fake"
exit 0
`);
chmodSync(join(fakeBin, "maestro"), 0o755);
const previousPath = process.env.PATH;
process.env.PATH = `${fakeBin}:${previousPath}`;
process.env.FAKE_MAESTRO_COUNT = join(fakeBin, "count");
const quietLog = [];
const outcome = await runFlowWithRetries(() => launchMaestro([], fakeBin, "FAKE-UDID"), { describe: "fake.yaml", pauseMs: 0, pause: async () => {}, log: (text) => quietLog.push(text) });
process.env.PATH = previousPath;
assert.deepEqual([outcome.ok, outcome.attempt.started, outcome.attempt.status], [true, true, 0], "a real Maestro process whose driver starts on its third try passes through the launcher");
assert.equal(quietLog.length, 2, "each failed driver start is logged");
assert.ok(quietLog.every((line) => line.startsWith("Driver start ") && line.includes("no step ran")), "the log names each failed start and that no step ran");
rmSync(fakeBin, { recursive: true, force: true });

// Capture jobs restore what prepare saved and install nothing: a miss fails the job, and no capture job saves a cache.
const iosWorkflow = parse(readFileSync(new URL("../.github/workflows/ui-snapshots-ios.yml", import.meta.url), "utf8"), { uniqueKeys: true });
const captureSteps = iosWorkflow.jobs.capture.steps;
const usesOf = (steps) => steps.map((step) => String(step.uses ?? ""));
assert.equal(usesOf(captureSteps).some((uses) => uses.includes("install-dependencies")), false, "capture jobs run no install step");
assert.equal(usesOf(captureSteps).some((uses) => uses.startsWith("actions/cache/save") || uses.startsWith("actions/cache@")), false, "capture jobs save no cache");
assert.ok(iosWorkflow.jobs.prepare.outputs["modules-key"], "prepare reports the node_modules key it saved");
assert.ok(captureSteps.some((step) => step.uses === "./.github/actions/restore-dependencies" && step.with?.["cache-key"] === "${{ needs.prepare.outputs.modules-key }}"), "capture restores the modules under prepare's key");
const restoreAction = parse(readFileSync(new URL("../.github/actions/restore-dependencies/action.yml", import.meta.url), "utf8"), { uniqueKeys: true });
const restoreModules = restoreAction.runs.steps.find((step) => String(step.uses).startsWith("actions/cache/restore"));
assert.equal(restoreModules?.with?.["fail-on-cache-miss"], true, "a node_modules miss fails the capture job");
const maestroRestore = captureSteps.find((step) => String(step.uses ?? "").startsWith("actions/cache/restore") && step.with?.path === "~/.maestro");
assert.ok(maestroRestore && maestroRestore.with["fail-on-cache-miss"] !== true, "a Maestro restore miss or failure installs Maestro instead of failing the shard");
assert.ok(captureSteps.some((step) => step.name === "Install Maestro" && step.if === "steps.maestro.outputs.cache-hit != 'true'"), "capture installs Maestro when its restore does not hit");

// A frame's time in the video: the swipe it names, plus its offset, less the recording's own start on the host clock.
const timed = (metadata, command) => ({ command, metadata });
const commands = [
  timed({ timestamp: 1000, duration: 100 }, { openLinkCommand: { link: "cohub://settings" } }),
  timed({ timestamp: 2000, duration: 5 }, { startRecordingCommand: { path: "motion-stripes" } }),
  timed({ timestamp: 2500, duration: 4000 }, { swipeCommand: { start: "50%, 70%", end: "50%, 43%", duration: 4000 } }),
  timed({ timestamp: 9000, duration: 4000 }, { swipeCommand: { start: "50%, 85%", end: "50%, 5%", duration: 4000 } }),
];
const clock = recordingClock([[{ command: { applyConfigurationCommand: {} }, metadata: { timestamp: 500, duration: 1 } }], commands], "motion-stripes");
assert.deepEqual([clock.startedAtMs, clock.swipes.map((swipe) => swipe.startMs)], [2000, [2500, 9000]], "the recording starts at its startRecording command, and the swipes after it are counted from there");
assert.deepEqual(frameTimes(clock, [{ label: "tab-halfway", swipe: 0, ms: 3200 }, { label: "back-hold", swipe: 1, ms: 5000 }], { swipe: 0, seconds: 0.5 }).map((frame) => [frame.label, frame.videoSeconds]), [["tab-halfway", 3.7], ["back-hold", 12]], "a frame sits at its swipe's start plus its offset, on the video's clock anchored at the onset swipe");
assert.throws(() => recordingClock([commands.slice(0, 1)], "motion-stripes"), /No Maestro commands JSON starts a recording/, "a recording with no start in any command list fails and says what it saw");
assert.equal(recordingClock([commands.slice(0, 1), commands], "motion-stripes").startedAtMs, 2000, "the list that starts the recording is the one read, whichever file it is in");
assert.throws(() => frameTimes(clock, [{ label: "missing", swipe: 2, ms: 0 }], { swipe: 0, seconds: 0 }), /wants swipe 2/, "a frame naming a swipe the recording lacks fails clearly");
assert.deepEqual(clampToLastFrame([{ label: "edge", videoSeconds: 3 }, { label: "settled", videoSeconds: 9 }], 5).map((frame) => frame.videoSeconds), [3, 5], "a frame past the last stored frame shows that frame: the screen is still from there on");
assert.equal(lastTimeIn("0.000000\n4.250000\n14.161667\n"), 14.161667, "the last frame is the last time in ffprobe's output, and a trailing newline is no time");
assert.equal(lastTimeIn("\n"), null, "output with no times has no last frame");
assert.equal(lastTimeIn("0.000000\n14.161667,\n"), 14.161667, "ffprobe can end a line with a comma, which is no part of the time");

// The recorded gestures end where they are: no wait for animations follows a drag, so the gap Maestro leaves is the hold.
// Two drags, the second from above the composer to the top of the screen, then the back swipe; nothing else is recorded.
const stripesFlow = buildMotionFlow({ platform: "ios", session: true, motions: MOTIONS.filter((motion) => motion.name === "motion-stripes") }).split("\n");
const recorded = stripesFlow.slice(stripesFlow.indexOf("- startRecording: \"motion-stripes\""), stripesFlow.indexOf("- stopRecording"));
const firstDrag = recorded.indexOf("    duration: 4000");
const secondDrag = recorded.indexOf("    duration: 4000", firstDrag + 1);
assert.ok(firstDrag > 0 && secondDrag > firstDrag, "the recording has two 4 s drags");
assert.ok(recorded[firstDrag + 1] !== "- waitForAnimationToEnd:" && recorded[secondDrag + 1] !== "- waitForAnimationToEnd:", "no wait for animations follows a drag");
assert.equal(recorded.filter((line) => line.includes("__hold__")).length, 0, "the recording has no explicit holds: the gaps between commands are the holds");
assert.ok(recorded.includes('    start: "50%, 91%"') && recorded.includes('    end: "50%, 0%"'), "the second drag runs from above the composer to the top of the screen");
assert.equal(recorded.filter((line) => line.startsWith("- swipe:")).length, 3, "two drags and the back swipe, and nothing else");

// The list motion: a fresh start on the Chats root, a drag down and a drag up with a 2 s hold after each, and nothing
// tapped or searched while recording. Its holds press the title bar, where a press opens nothing, and its frames are
// list-<label>.png, each in the swipe it names.
const listMotion = MOTIONS.find((motion) => motion.name === "motion-chats-list");
const listFlow = buildMotionFlow({ platform: "ios", session: true, motions: [listMotion] }).split("\n");
const listRecording = listFlow.slice(listFlow.indexOf("- startRecording: \"motion-chats-list\""), listFlow.indexOf("- stopRecording"));
const listHold = ["- swipe:", '    start: "2%, 8%"', '    end: "2%, 8%"', "    duration: 2000"];
assert.ok(listFlow.indexOf("- launchApp:") < listFlow.indexOf("- openLink: \"cohub:///\""), "the list motion relaunches before it opens the Chats root");
assert.deepEqual(listRecording, [
  '- startRecording: "motion-chats-list"',
  "- swipe:", '    start: "50%, 30%"', '    end: "50%, 72%"', "    duration: 4000",
  ...listHold,
  "- swipe:", '    start: "50%, 75%"', '    end: "50%, 35%"', "    duration: 4000",
  ...listHold,
], "the list recording is a drag down, a 2 s hold, a drag up and a 2 s hold: nothing tapped, no search");
const listKinds = listMotion.steps.filter((step) => step.drag || step.hold).map((step) => (step.drag ? "drag" : "hold"));
const listLengths = listMotion.steps.filter((step) => step.drag || step.hold).map((step) => step.drag?.duration ?? step.hold);
assert.deepEqual(listMotion.frames.map((frame) => [frame.label, listKinds[frame.swipe]]), [["edge", "drag"], ["halfway", "drag"], ["hold", "hold"], ["settled", "hold"]], "each list frame sits in the swipe its label names: edge and halfway in the drag down, hold and settled in the holds");
assert.ok(listMotion.frames.every((frame) => frame.ms < listLengths[frame.swipe]), "each list frame falls inside its swipe");
assert.deepEqual(expectedOutputs({ part: "motion", screens: ["motion-chats-list"] }, { themes: ["light"], motionThemes: ["light", "dark"] }).filter((file) => file.endsWith(".png")), ["motion/light/list-edge.png", "motion/light/list-halfway.png", "motion/light/list-hold.png", "motion/light/list-settled.png", "motion/dark/list-edge.png", "motion/dark/list-halfway.png", "motion/dark/list-hold.png", "motion/dark/list-settled.png"], "the list frames are list-<label>.png in each theme's folder");
assert.equal(planShards({ ...all, targets: ["phone"], screens: ["motion-chats-list"], themes: ["light"], motion: true, motionThemes: ["light", "dark"] }).filter((entry) => entry.part === "motion").flatMap((entry) => entry.screens).join(), "motion-chats-list", "naming the list motion plans it alone");
