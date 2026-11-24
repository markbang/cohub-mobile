import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFlow, buildTabletFlow, expectedOutputs, launchMaestro, MOTIONS, planShards, runFlowWithRetries, SCREENS, TABLET_SCREENS } from "./ui-snapshots.mjs";

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

// A landscape flow asks for its orientation before the app launches, so it never relies on the state an earlier flow left.
const landscapeFlow = buildFlow({ platform: "ios", session: true, screens: TABLET_SCREENS.slice(0, 1), target: "tablet", orientation: "landscape" });
assert.ok(landscapeFlow.indexOf("- setOrientation: LANDSCAPE_LEFT") > 0 && landscapeFlow.indexOf("- setOrientation: LANDSCAPE_LEFT") < landscapeFlow.indexOf("- launchApp:"), "the landscape flow turns the device before it launches the app");
const portraitFlow = buildFlow({ platform: "ios", session: true, screens: TABLET_SCREENS.slice(0, 1), target: "tablet", orientation: "portrait" });
assert.ok(portraitFlow.indexOf("- setOrientation: PORTRAIT") > 0 && portraitFlow.indexOf("- setOrientation: PORTRAIT") < portraitFlow.indexOf("- launchApp:"), "the portrait flow turns the device before it launches the app");
assert.equal(buildFlow({ platform: "ios", session: true, screens: SCREENS.slice(0, 1), target: "phone", orientation: "portrait" }).includes("setOrientation"), false, "a phone flow does not turn the device");
const tabletFlowLandscape = buildTabletFlow({ platform: "ios", session: true, maestroOrientation: (orientation) => (orientation === "landscape" ? "LANDSCAPE_LEFT" : "PORTRAIT") });
assert.ok(tabletFlowLandscape.indexOf("- setOrientation: PORTRAIT") < tabletFlowLandscape.indexOf("- launchApp:"), "the split-flow run turns the device before it launches the app");

const all = { targets: ["phone", "tablet"], orientations: null, screens: null, themes: ["light"], textSizes: ["default"], motion: false, perf: 0 };
const defaults = planShards(all);
assert.equal(defaults.length, 5, "the default list (light, phone and tablet, no motion) is five jobs, the most GitHub runs at once: phone 2, tablet portrait 1, tablet landscape 1, split flows 1");
assert.equal(new Set(defaults.map((entry) => entry.artifact)).size, defaults.length, "every job uploads under its own artifact name");
assert.ok(defaults.every((entry) => entry.part === "flow" || entry.screens.length > 0), "no job is empty");

const covered = (target, orientation) => defaults.filter((entry) => entry.part === "screens" && entry.target === target && entry.orientation === orientation).flatMap((entry) => entry.screens);
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
assert.deepEqual(landscape.map((entry) => [entry.orientation, entry.part, entry.screens]), [["landscape", "screens", ["split-space"]]], "a tablet orientation with one screen has no flow job");
assert.deepEqual(planShards({ ...all, targets: ["phone"], screens: ["split-space"] }), [], "a run naming only tablet screens has no phone job");

const doubled = planShards({ ...all, targets: ["phone"], themes: ["light", "dark"] });
assert.equal(doubled.length, 4, "both themes double the phone's work into four jobs of eleven screens");
assert.deepEqual(doubled.flatMap((entry) => entry.screens), SCREENS.map((screen) => screen.name), "both themes still cover each phone screen once");
assert.ok(doubled.every((entry) => entry.screens.length === 11), "each doubled phone job holds eleven screens");

const motionPlan = planShards({ ...all, targets: ["phone"], motion: true });
const motions = motionPlan.filter((entry) => entry.part === "motion");
assert.deepEqual(motions.flatMap((entry) => entry.screens), MOTIONS.map((motion) => motion.name), "the motion recordings are covered once each");
assert.ok(motions.every((entry) => entry.target === "phone" && entry.orientation === "portrait"), "motion is a phone job");
assert.equal(planShards({ ...all, targets: ["phone"], motion: true, textSizes: ["accessibility-large"] }).filter((entry) => entry.part === "motion").length, 0, "motion runs at the default text size only");
assert.equal(planShards({ ...all, targets: ["tablet"], perf: 2 }).filter((entry) => entry.part === "perf").length, 1, "perf is one job per target");

const expected = (plan, options) => plan.flatMap((entry) => expectedOutputs(entry, options));
const outputs = expected(defaults, { themes: ["light"], textSizes: ["default"] });
assert.equal(new Set(outputs).size, outputs.length, "no two jobs write the same file");
assert.ok(outputs.includes("light/catalog-type.png") && outputs.includes("tablet-portrait/light/split-empty.png") && outputs.includes("tablet-landscape/light/split-empty.png"), "the expected paths match the layout compare reads");
assert.ok(outputs.includes("tablet-flow/"), "the split flows' directory is expected");
const sized = expected(planShards({ ...all, targets: ["phone"], screens: ["catalog-rows"] }), { themes: ["light", "dark"], textSizes: ["default", "accessibility-large"] });
assert.deepEqual(sized, ["light/catalog-rows.png", "dark/catalog-rows.png", "light-accessibility-large/catalog-rows.png", "dark-accessibility-large/catalog-rows.png"], "text sizes get suffixed theme directories");

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
