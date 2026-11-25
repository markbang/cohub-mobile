import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { commandLists, exportFrames, frameTimes, motionOnset, recordingClock, writeSidecar } from "./ui-snapshots-frames.mjs";

/**
 * Captures the same screens on iOS and Android and pairs them side by side, so the drawn Android
 * UI can be compared with the iOS system UI without a local simulator.
 *
 *   capture --platform android|ios --app <apk|.app|.zip> [--target phone|tablet] [--orientations portrait,landscape]
 *           [--out dir] [--screens a,b] [--themes light,dark] [--no-metro] [--no-motion] [--perf runs]
 *           [--target phone,tablet] [--text-size default,accessibility-large] [--offline] [--part screens|flow|motion|perf]
 *           [--scope core|full] [--motion-themes light,dark]
 *           (--target and --text-size take comma lists; every cell runs in this one process, with one Metro)
 *           (--text-size is iOS only and restored to default after each cell; --offline needs no account)
 *           (--scope core is the default: CORE's screens, at the default size and the composer's at accessibility-large.
 *            full is every screen at the requested sizes, and the split flows. --screens names the screens at each size.)
 *           (--part runs one slice of the target's work: its screens, the split flows, the motion recordings
 *            (--screens then names the interactions) or the perf runs. Without --part every slice runs.)
 *   warm --platform ios [--offline]   (starts Metro, requests the iOS bundle once, stops Metro; prepare saves the cache)
 *   plan --target phone,tablet [--scope core|full] [--orientations ...] [--screens ...] [--themes ...] [--text-size ...] [--no-motion] [--perf runs]
 *           prints the capture jobs as JSON, each one a --part slice that fits one job's budget, with its text size
 *   merge --plan <plan.json> --shards <dir> [--out dir] [--themes ...] [--text-size ...]
 *           combines the jobs' directories into one per artifact; names what a missing job did not capture
 *   compare --ios <dir> --android <dir> [--out dir]
 *   redact --dir <dir>   (replaces E2E_ACCOUNT_* values in text files before an upload)
 *   boot --platform ios --target phone|tablet   (starts the simulator's boot and returns; capture waits for it)
 *   driver --platform ios --target phone|tablet   (starts Maestro's driver once on the simulator, so the capture's first start finds it running)
 *
 * Capture runs a debug binary against a local Metro, so a JS-only change needs no native rebuild.
 * After the screenshots it records each of MOTIONS as a video, in each of `--motion-themes` (light by default, animations
 * on): `motion/<theme>/<name>.mp4`, with a `<name>.json` sidecar that holds the recording's start on the host clock. An
 * interaction with `frames` also writes its PNGs beside the video. compare pairs the videos too, so motion can be tuned
 * frame by frame. With `--screens`, only the named interactions record.
 *
 * `--target tablet` runs on an iPad simulator or a tablet emulator at its own density, in each of
 * `--orientations`, and writes `tablet-<orientation>/<theme>/`; the phone keeps `<theme>/`. A text size
 * other than `default` suffixes the theme directory (`<theme>-<size>/`), so one run's sizes never overwrite
 * each other. It
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
// The split-layout flow runs first; the variant after it sends a message (signed in) or picks a seeded Space (offline).
const TABLET_LAYOUT_FLOW = "e2e/tablet/split-layout.yaml";
const TABLET_SEND_FLOW = "e2e/tablet/split-send.yaml";
const TABLET_OFFLINE_FLOW = "e2e/tablet/split-offline.yaml";
const PAIR_HEIGHT = 1400;
// iOS content size categories behind each --text-size choice; `default` is the simulator's own `large`.
const TEXT_SIZES = { default: "large", "extra-large": "extra-large", "accessibility-large": "accessibility-large" };
const WARM_TIMEOUT_MS = 30 * 60 * 1000;
const DEV_SERVER_ERROR = "Could not connect to development server";
const NOT_RESPONDING = ".* isn't responding";
const OPEN_IN_APP = "Open in .*Cohub.*\\?";
// The question's Open button where a landscape window draws it. The question is drawn in a portrait window, so its
// Open button's accessibility frame sits at portrait coordinates, and a text tap on it misses the landscape screen
// (run 45505096009 tapped the empty right pane). The button's centre, measured on that run's landscape screenshot,
// is 56.2% across and 51.2% down.
const OPEN_BUTTON_LANDSCAPE = "56%, 51%";

/** The commands that answer the question: the Open button by its drawn position in landscape, by its text otherwise. */
function answerOpenInApp(landscape) {
  return ["    commands:", ...(landscape ? ["      - tapOn:", `          point: ${yamlString(OPEN_BUTTON_LANDSCAPE)}`] : ["      - tapOn: \"^Open$\""])];
}

// Screens that leave an overlay open come last; `fresh` relaunches first, because a UIKit sheet or
// alert survives the route change and would cover the next screen.
// The first list row under a tab root's search field at 402 pt wide; iOS's native Large Title and
// search field sit lower than Android's drawn ones.
const FIRST_ROW = { ios: "50%, 40%", android: "50%, 26%" };
// Above every menu and under the status bar: a tap here closes what is open without choosing.
const OUTSIDE = { ios: "50%, 9%", android: "50%, 9%" };
// The Web browsing row's value, whichever the test account has; the picker opens from it on both platforms.
const BROWSER_VALUE = "(System|In-app) browser";

// One sentence repeated: the phone's draft wraps to about four lines at 402 pt, the tablet's to about six at 820 pt.
const LONG_DRAFT = "The draft keeps its place while the timeline scrolls, and the composer grows with it. ";
const LONG_DRAFT_PHONE = encodeURIComponent(LONG_DRAFT.repeat(2).trim());
const LONG_DRAFT_TABLET = encodeURIComponent(LONG_DRAFT.repeat(3).trim());

// The striped Chat's title, as the Chats list and the Chat's header show it (src/data/fixtures/session.ts).
const STRIPES_TITLE = "Stripe test pattern";
// A Chats row's label carries its preview too, so the row is matched as a pattern.
const STRIPES_ROW = `.*${STRIPES_TITLE}.*`;

export const SCREENS = [
  { name: "catalog-type", ready: "Display.*", link: "cohub://debug/ui?section=type" },
  { name: "catalog-rows", ready: "Settings rows", link: "cohub://debug/ui?section=rows" },
  { name: "catalog-list", ready: "List continuity", link: "cohub://debug/ui?section=list" },
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
  { name: "settings-scrolled", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ swipe: "up" }] },
  // The Chat screen's chrome and native timeline over fixed conversations, then a real Chat.
  { name: "chat-conversation", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  { name: "chat-tools", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=tools" },
  { name: "chat-long", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long" },
  { name: "chat-states", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=states" },
  // The jump to latest once the timeline is scrolled up: arrow alone with nothing new, then the count of replies that arrived.
  { name: "chat-scrolled", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long", steps: [{ swipe: "down" }] },
  { name: "chat-arrival", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long&arrive=2", steps: [{ waitFor: "arrivals 2" }, { swipe: "down" }] },
  // The composer tapped, so the keyboard is up; then a drag down on the timeline, which should take it away.
  // The composer with text: send replaces the mic, and the model chip gives way to its icon.
  { name: "chat-draft", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&draft=Looks%20good%2C%20send%20it" },
  // The empty composer: the same fixture with no draft, so the mic shows alone.
  { name: "chat-draft-empty", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  // A long draft: about four wrapped lines at 402 pt. The composer's wrap layout is judged on this screen.
  { name: "chat-draft-long", ready: "Fix the Android sheet height", link: `cohub://debug/chat?fixture=conversation&draft=${LONG_DRAFT_PHONE}` },
  { name: "chat-keyboard", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation", steps: [{ tapOnId: "chat-composer-input" }, { settle: true }] },
  { name: "chat-keyboard-drag", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation", steps: [{ tapOnId: "chat-composer-input" }, { settle: true }, { swipe: "down" }, { settle: true }] },
  // Unread: the Chat opens at the first message of the turn the device has not read (the 14th message).
  { name: "chat-unread", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long&unread=14" },
  // The Delivered line: a Chat that ends on the prompt, with no reply under it yet.
  { name: "chat-delivered", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&tail=user" },
  // The same Chat after a few swipes to the end: the read sequence has passed the divider's Turn, so the divider is gone.
  { name: "chat-unread-end", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long&unread=14", steps: [{ swipe: "up" }, { swipe: "up" }, { swipe: "up" }] },
  // A Bot's page and the Bots view over fixed Bots, then the Bot page's JS list.
  { name: "chat-bot", ready: "Chief of staff", link: "cohub://debug/chat?fixture=bot" },
  { name: "chat-bot-js", ready: "Chief of staff", link: "cohub://debug/chat?fixture=bot&native=0" },
  { name: "bot-list", ready: "Sales Outbound", link: "cohub://debug/bot-list" },
  // The native timeline on the same fixtures, on iOS too, where the Chat screen draws the JS list.
  { name: "chat-native", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&native=1", steps: [{ waitFor: "setRows" }] },
  // The first row, by position: the test account's newest Chat changes from run to run.
  // Fresh: the Settings and Chats tab roots keep the offset the scrolled screens above left them at, so Appearance would be off-screen.
  { name: "chat-real", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: "Chats" }, { tapPoint: FIRST_ROW }, { waitGone: "Opening Chat" }] },
  { name: "catalog-menu", ready: "Menu", link: "cohub://debug/ui?section=menu", steps: [{ tapOnId: "ui-catalog-menu-button" }, { waitFor: "Pin" }] },
  // Menus in the app, each left open; `fresh` relaunches first, so the previous one is gone. iOS shows the
  // system menu, picker and attachment menu here, Android the drawn ones; the model selector is drawn on both.
  { name: "chats-filter", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: "Chats" }, { tapOnSourceFilter: true }, { waitFor: "All", exact: true }] },
  { name: "settings-select", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: BROWSER_VALUE }, { waitFor: "In-app browser" }] },
  { name: "composer-attach", ready: "blocked=", link: "cohub://debug/composer", fresh: true, steps: [{ tapOnId: "chat-composer-attach" }, { waitFor: "Take a photo" }] },
  { name: "composer-model", ready: "blocked=", link: "cohub://debug/composer", fresh: true, steps: [{ tapOnId: "chat-composer-model" }, { waitFor: "Search models" }] },
  // The model selector in a real Chat, scrolled back so messages run under the composer and the menu.
  { name: "chat-real-model", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: "Chats" }, { tapPoint: FIRST_ROW }, { waitGone: "Opening Chat" }, { swipe: "down" }, { tapOnId: "chat-composer-model" }, { waitFor: "Search models" }] },
  { name: "catalog-sheet", ready: "Sheet title", link: "cohub://debug/ui?section=sheet", fresh: true },
  { name: "catalog-page", ready: "New Space", link: "cohub://debug/ui?section=page", fresh: true },
  { name: "catalog-confirm", ready: "Delete this chat\\?", link: "cohub://debug/ui?section=confirm", fresh: true },
  // The striped Chat (the Chats list's last row), at rest: the picture starts below the fold, so the screen shows its caption.
  { name: "chat-stripes", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ tapOn: "Chats" }, { scrollTo: STRIPES_TITLE }, { tapOn: STRIPES_ROW }, { waitFor: "288 × 160" }, { hold: 2500 }] },
];

// The left pane's first and a later Chat or Space row in a split window.
const LEFT_FIRST_ROW = { ios: "12%, 35%", android: "12%, 35%" };
const LEFT_SECOND_ROW = { ios: "12%, 44%", android: "12%, 44%" };

/** Split-window screens: the right pane empty, a Chat, a Space, a settings page, the Chat's panel, and an overlay. */
export const TABLET_SCREENS = [
  { name: "split-empty", ready: "Appearance", link: "cohub://settings", steps: [{ chatsTab: true }, { waitFor: "New Chat" }] },
  { name: "split-chat-real", ready: "Appearance", link: "cohub://settings", steps: [{ chatsTab: true }, { tapPoint: LEFT_FIRST_ROW }, { waitGone: "Opening Chat" }] },
  { name: "split-chat-panel", ready: "Appearance", link: "cohub://settings", steps: [{ chatsTab: true }, { tapPoint: LEFT_FIRST_ROW }, { waitGone: "Opening Chat" }, { swipe: "right" }] },
  // Fixtures on the native timeline, then on the JS list binaries without it fall back to (`native=0`).
  { name: "split-chat-conversation", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  { name: "split-chat-long", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long" },
  { name: "split-chat-media", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=media" },
  { name: "split-chat-conversation-js", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&native=0" },
  { name: "split-chat-media-js", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=media&native=0" },
  { name: "split-chat-stream-js", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=stream&native=0" },
  { name: "split-chat-bot", ready: "Chief of staff", link: "cohub://debug/chat?fixture=bot" },
  { name: "split-space", link: "cohub://spaces", steps: [{ tapPoint: LEFT_FIRST_ROW }] },
  { name: "split-settings-page", ready: "Accent color", link: "cohub://appearance" },
  { name: "split-new-chat", ready: "Appearance", link: "cohub://settings", fresh: true, steps: [{ chatsTab: true }, { tapOn: "New Chat" }] },
  // The empty composer in the right pane, the tablet's counterpart of chat-draft-empty.
  { name: "split-chat-draft-empty", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation" },
  // A one-line draft in the right pane, the tablet's counterpart of chat-draft.
  { name: "split-chat-draft", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=conversation&draft=Looks%20good%2C%20send%20it" },
  // The long draft in the right pane: about six wrapped lines at 820 pt.
  { name: "split-chat-draft-long", ready: "Fix the Android sheet height", link: `cohub://debug/chat?fixture=conversation&draft=${LONG_DRAFT_TABLET}` },
  // The long draft expanded: the 45% cap, which is the tallest the field gets on a tablet.
  { name: "split-chat-draft-expanded", ready: "Fix the Android sheet height", link: `cohub://debug/chat?fixture=conversation&draft=${LONG_DRAFT_TABLET}`, steps: [{ tapOnId: "chat-composer-expand" }, { settle: true }] },
];

/** The same operations on every target, timed by the frame probe: a long fixture, a real Chat, and the tabs. */
const perfSteps = (row) => [{ open: "cohub://debug/chat?fixture=long", ready: "Fix the Android sheet height" }, { swipe: "down" }, { swipe: "up" }, { swipe: "down" }, { swipe: "up" }, { open: "cohub://settings", ready: "Appearance" }, { chatsTab: true }, { tapPoint: row }, { waitGone: "Opening Chat" }, { swipe: "down" }, { swipe: "up" }, { swipe: "down" }, { swipe: "up" }];
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
  { name: "motion-filter", ready: "Appearance", link: "cohub://settings", setup: [{ tapOn: "Chats" }], steps: [{ tapOnSourceFilter: true }, { waitFor: "All", exact: true }, { tapOn: "All" }] },
  // Opens the Web browsing picker and closes it from outside, so the account's setting is left alone.
  { name: "motion-select", ready: "Appearance", link: "cohub://settings", steps: [{ tapOn: BROWSER_VALUE }, { waitFor: "In-app browser" }, { tapPoint: OUTSIDE }, { waitGone: "In-app browser" }] },
  { name: "motion-attach", ready: "blocked=", link: "cohub://debug/composer", steps: [{ tapOnId: "chat-composer-attach" }, { waitFor: "Take a photo" }, { tapPoint: OUTSIDE }] },
  { name: "motion-model", ready: "blocked=", link: "cohub://debug/composer", steps: [{ tapOnId: "chat-composer-model" }, { waitFor: "Search models" }, { tapOnId: "model-option-automatic" }] },
  // A glass button held and let go: it swells under the finger and bounces past rest.
  { name: "motion-press", ready: "Buttons", link: "cohub://debug/ui?section=controls", steps: [{ longPressOn: "Copy" }] },
  { name: "motion-sheet", ready: "Open sheet", link: "cohub://debug/ui?section=sheet&open=0", steps: [{ tapOn: "Open sheet" }, { tapOn: "Close.*" }] },
  { name: "motion-confirm", ready: "Open confirm", link: "cohub://debug/ui?section=confirm&open=0", steps: [{ tapOn: "Open confirm" }, { tapOn: "Cancel" }] },
  { name: "motion-scroll-chats", ready: "Appearance", link: "cohub://settings", setup: [{ tapOn: "Chats" }], steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-spaces", link: "cohub://spaces", steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-activity", ready: "Usage details", link: "cohub://activity", setup: [{ waitGone: "Loading" }], steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-scroll-settings", ready: "Appearance", link: "cohub://settings", steps: [{ swipe: "up" }, { swipe: "down" }] },
  { name: "motion-chat", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=long", steps: [{ swipe: "down" }, { swipe: "up" }] },
  { name: "motion-space", link: "cohub://spaces", setup: [{ tapPoint: FIRST_ROW }], steps: [{ swipe: "up" }, { swipe: "down" }] },
  // Continuity: the viewer grows out of the tapped thumbnail and back into it; a list closes the gap a row leaves
  // and slides a moved row; the search field rises into the bar and back. Search runs last: iOS's system search
  // may show no Cancel, and an active search would cover the next recording's bar.
  // The viewer's Close sits in a zero-height bar that Android's accessibility tree skips, so it is tapped by position.
  { name: "motion-image", ready: "Fix the Android sheet height", link: "cohub://debug/chat?fixture=media", steps: [{ tapOn: "Open image 1 of 2" }, { tapPoint: { ios: "91%, 10%", android: "91%, 10%" } }] },
  { name: "motion-list", ready: "List continuity", link: "cohub://debug/ui?section=list", steps: [{ tapOn: "Archive first" }, { tapOn: "Move last up" }, { tapOn: "Restore" }] },
  // Chats keeps its offset across recordings; a drag down brings its search field back first.
  { name: "motion-search", ready: "Appearance", link: "cohub://settings", setup: [{ tapOn: "Chats" }, { swipe: "down" }], steps: [{ tapOn: "Search", optional: true }, { tapOn: "Cancel", optional: true }] },
  // The striped Chat under the chrome. Measured on run 45629714100: the picture's top sits about 1340 pt down at the
  // Chat's top, so five swipes down bring the Chat to its top, then one slow drag up leaves the picture's top just under
  // the fold. Drag A takes its top edge to the composer's top edge (the bottom chrome). Drag B runs from above the composer
  // to the top of the screen, so the picture's top passes under the title pill and the back button. The holds are the gaps
  // Maestro leaves between these commands: no step waits, so the still is what the simulator shows between two gestures.
  // Then the back swipe ends the Chat. `frames` cut PNGs from the recording, each at `ms` after the start of its swipe.
  {
    name: "motion-stripes",
    ready: "Appearance",
    link: "cohub://settings",
    setup: [{ tapOn: "Chats" }, { scrollTo: STRIPES_TITLE }, { tapOn: STRIPES_ROW }, { waitFor: "288 \u00d7 160" }, { hold: 2500 }, ...Array.from({ length: 5 }, () => ({ swipe: "down" })), { drag: { from: "50%, 80%", to: "50%, 34%", duration: 3000 } }, { hold: 1000 }],
    steps: [{ drag: { from: "50%, 80%", to: "50%, 62%", duration: 4000 } }, { drag: { from: "50%, 91%", to: "50%, 0%", duration: 4000 } }, { back: true }],
    // The swipes after the recording starts: 0 drag A, 1 drag B, 2 the back swipe. The video first moves at drag A, so
    // `onset` anchors the clock there.
    onset: 0,
    frames: [
      { label: "tab-halfway", swipe: 0, ms: 2810 },
      { label: "tab-edge", swipe: 0, ms: 4000 },
      { label: "tab-hold", swipe: 0, ms: 4500 },
      { label: "back-edge", swipe: 1, ms: 3810 },
      { label: "back-halfway", swipe: 1, ms: 3960 },
      { label: "back-hold", swipe: 1, ms: 4500 },
    ],
  },
  // The Chats list with its seeded rows (src/data/fixtures/chats.ts). Setup scrolls the rows up, so rows sit above the
  // tab bar. Recorded: a slow drag down brings the rows above it under the bar, a stop, a slow drag up, a stop. Nothing is
  // tapped and search is never opened. The Chats list is a root screen, so `fresh` starts it from the top.
  {
    name: "motion-chats-list",
    ready: "Reconcile Q3 vendor invoices",
    link: "cohub:///",
    fresh: true,
    framePrefix: "list",
    setup: [{ swipe: "up" }],
    steps: [{ drag: { from: "50%, 30%", to: "50%, 72%", duration: 4000 } }, { hold: 2000 }, { drag: { from: "50%, 75%", to: "50%, 35%", duration: 4000 } }, { hold: 2000 }],
    // The swipes after the recording starts, holds included: 0 drag down, 1 the hold after it, 2 drag up, 3 the hold after
    // that. The video first moves at drag down.
    onset: 0,
    frames: [
      { label: "edge", swipe: 0, ms: 3500 },
      { label: "halfway", swipe: 0, ms: 2000 },
      { label: "hold", swipe: 1, ms: 1000 },
      { label: "settled", swipe: 3, ms: 1000 },
    ],
  },
];

/** The interactions a selection records: every one, or with `screens`, the ones it names. */
function motionsNamed(screens) {
  return MOTIONS.filter((motion) => !screens || screens.includes(motion.name));
}

function motionNames(screens) {
  return motionsNamed(screens).map((motion) => motion.name);
}

/** A motion's frame files start with its `framePrefix`, which defaults to its name: `<prefix>-<label>.png`. */
function framePrefix(motion) {
  return motion.framePrefix ?? motion.name;
}

/** The files one interaction leaves in each theme: its video, its sidecar, and the PNGs its `frames` cut. */
function motionOutputs(name, motionThemes) {
  const motion = MOTIONS.find((entry) => entry.name === name);
  const frames = motion?.frames ?? [];
  return motionThemes.flatMap((theme) => [`motion/${theme}/${name}.mp4`, `motion/${theme}/${name}.json`, ...frames.map((frame) => `motion/${theme}/${framePrefix(motion)}-${frame.label}.png`)]);
}

const ARTIFACTS = { phone: "ui-snapshots-ios", tablet: "ui-snapshots-ios-tablet" };
const PARTS = ["screens", "flow", "motion", "perf"];
const SCOPES = ["core", "full"];
const DEFAULT_ORIENTATIONS = { phone: ["portrait"], tablet: ["portrait", "landscape"] };
// Seconds of Maestro time per screen, measured on run 45497720090 (warm Metro, offline, light): 25 s on a phone,
// 26 s on a tablet. A job holds at most SHARD_CAPTURE_SECONDS of it. Every job also pays a fixed cost before its
// first screen (about 12 minutes measured on that run: dependencies, the driver, the first bundle), and GitHub runs
// five macOS jobs at once, so the full list is five jobs: phone 2, tablet portrait 1, tablet landscape 1, split flows 1.
const SHARD_CAPTURE_SECONDS = 570;
const SECONDS_PER_SCREEN = { "phone-portrait": 25, "tablet-portrait": 26, "tablet-landscape": 26 };
// An estimate: no run has timed the motion recordings yet.
const SECONDS_PER_MOTION = 25;

/**
 * The core set, the default scope: the states that have regressed, per target. `default` is captured at the default
 * text size; `accessibility-large` holds the composer's screens, the only ones captured at the large size.
 */
export const CORE = {
  phone: {
    default: ["chats", "chats-scrolled", "chat-conversation", "chat-real", "chat-draft-empty", "chat-draft", "chat-draft-long", "chat-unread", "chat-unread-end", "chat-delivered", "chat-states", "chat-arrival"],
    "accessibility-large": ["chat-draft-empty", "chat-draft", "chat-draft-long"],
  },
  tablet: {
    default: ["split-chat-real", "split-chat-draft-empty", "split-chat-draft", "split-chat-draft-long", "split-chat-panel", "split-space", "split-settings-page", "split-empty"],
    "accessibility-large": ["split-chat-draft-long"],
  },
};
const CORE_TEXT_SIZES = ["default", "accessibility-large"];

function list(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Splits `items` into contiguous slices of near-equal size, as many as `seconds` of work needs at SHARD_CAPTURE_SECONDS each. */
function splitByBudget(items, seconds) {
  if (items.length === 0) return [];
  const count = Math.min(items.length, Math.max(1, Math.ceil(seconds / SHARD_CAPTURE_SECONDS)));
  let start = 0;
  return Array.from({ length: count }, (_, index) => {
    const size = Math.floor(items.length / count) + (index < items.length % count ? 1 : 0);
    const slice = items.slice(start, start + size);
    start += size;
    return slice;
  });
}

/**
 * The screens each text size captures for one target, as `{ textSize, names }` in catalog order. `screens` (--screens)
 * names them at every requested size. Otherwise core takes its CORE table and full takes the whole catalog at each size.
 */
function cellsFor({ target, scope, screens, textSizes }) {
  const catalog = (target === "tablet" ? TABLET_SCREENS : SCREENS).map((screen) => screen.name);
  const inCatalog = (names) => catalog.filter((name) => names.includes(name));
  if (screens) return (textSizes ?? ["default"]).map((textSize) => ({ textSize, names: inCatalog(screens) }));
  if (scope === "core") {
    return Object.entries(CORE[target]).filter(([textSize]) => !textSizes || textSizes.includes(textSize)).map(([textSize, names]) => ({ textSize, names: inCatalog(names) }));
  }
  return (textSizes ?? ["default"]).map((textSize) => ({ textSize, names: catalog }));
}

/**
 * The capture jobs for one run, in matrix order. Each is one `--part` slice: its target, its orientations, its text size,
 * the part, and the names that part captures (screens, or motion interactions). `artifact` is the name its directory uploads
 * under. A default-size job holds one orientation, since its screens are many; a larger text size's screens are few, so its
 * job holds all of the target's orientations and the fixed cost is paid once.
 */
export function planShards({ targets, orientations = null, screens = null, scope = "core", themes, textSizes = null, motion, perf, motionThemes = ["light"] }) {
  const units = [];
  for (const target of ["phone", "tablet"].filter((name) => targets.includes(name))) {
    const targetOrientations = orientations ?? DEFAULT_ORIENTATIONS[target];
    const cells = cellsFor({ target, scope, screens, textSizes }).filter((cell) => cell.names.length > 0);
    for (const { textSize, names } of cells) {
      const groups = textSize === "default" ? targetOrientations.map((orientation) => [orientation]) : [targetOrientations];
      for (const group of groups) {
        const seconds = themes.length * names.length * group.reduce((sum, orientation) => sum + SECONDS_PER_SCREEN[`${target}-${orientation}`], 0);
        for (const slice of splitByBudget(names, seconds)) units.push({ target, orientations: group, textSize, part: "screens", screens: slice });
      }
    }
    const hasDefault = cells.some((cell) => cell.textSize === "default");
    // The split flows run in the full scope only: core captures screens, and its jobs stay at five.
    if (target === "tablet" && scope === "full" && !screens && hasDefault) units.push({ target, orientations: ["portrait"], textSize: "default", part: "flow", screens: [] });
    // Motion runs at the default text size, whether or not the selection names any screen.
    if (target === "phone" && motion && (textSizes === null || textSizes.includes("default"))) {
      const interactions = motionNames(screens);
      for (const slice of splitByBudget(interactions, interactions.length * motionThemes.length * SECONDS_PER_MOTION)) units.push({ target, orientations: ["portrait"], textSize: "default", part: "motion", screens: slice });
    }
    if (perf > 0) units.push({ target, orientations: ["portrait"], textSize: "default", part: "perf", screens: [] });
  }
  return units.map((unit, shard) => ({ shard, artifact: `${ARTIFACTS[unit.target]}-${shard}`, ...unit }));
}

/**
 * The files one job leaves in the run's layout, relative to the run's root. A path ending in "/" is a directory: the
 * split flows name their screenshots in the flow file, so only their directory is known here.
 */
export function expectedOutputs(entry, { themes, motionThemes = ["light"] }) {
  if (entry.part === "screens") {
    const suffix = entry.textSize === "default" ? "" : `-${entry.textSize}`;
    return entry.orientations.flatMap((orientation) => {
      const prefix = entry.target === "phone" ? "" : `${entry.target}-${orientation}/`;
      return themes.flatMap((theme) => entry.screens.map((name) => `${prefix}${theme}${suffix}/${name}.png`));
    });
  }
  if (entry.part === "motion") return entry.screens.flatMap((name) => motionOutputs(name, motionThemes));
  if (entry.part === "perf") return [`perf/${entry.target}-${entry.orientations[0]}.json`];
  return ["tablet-flow/"];
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, themes: ["light", "dark"], motionThemes: ["light"], screens: null, metro: true, motion: true, targets: ["phone"], orientations: null, perf: 0, textSizes: null, scope: "core", offline: false, part: null, plan: null, shards: null };
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
    else if (flag === "--target") options.targets = list(value());
    else if (flag === "--orientations") options.orientations = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (flag === "--perf") options.perf = Number(value());
    else if (flag === "--dir") options.dir = resolve(value());
    else if (flag === "--text-size") options.textSizes = list(value());
    else if (flag === "--offline") options.offline = true;
    else if (flag === "--part") options.part = value();
    else if (flag === "--scope") options.scope = value();
    else if (flag === "--motion-themes") options.motionThemes = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (flag === "--plan") options.plan = resolve(value());
    else if (flag === "--shards") options.shards = resolve(value());
    else throw new Error(`Unknown argument "${flag}".`);
  }
  if (options.part !== null && !PARTS.includes(options.part)) throw new Error(`--part must be one of ${PARTS.join(", ")}.`);
  if (!SCOPES.includes(options.scope)) throw new Error(`--scope must be ${SCOPES.join(" or ")}.`);
  if (command === "capture" || command === "plan") checkSelection(options);
  if (command === "capture") {
    if (options.platform !== "android" && options.platform !== "ios") throw new Error("--platform must be android or ios.");
    if (!options.app || !existsSync(options.app)) throw new Error("--app must point to a built debug APK (Android) or simulator .app/.zip (iOS).");
    // Android has no Dynamic Type: its default size is the only one, and the core set's composer sizes drop out.
    if (options.platform === "android") options.textSizes ??= ["default"];
    if (options.platform === "android" && options.textSizes.some((size) => size !== "default")) throw new Error("--text-size is set on iOS only; Android captures at its default font scale.");
    if (options.perf > 0 && !options.metro) throw new Error("--perf starts its own Metro with the frame probe forced on; drop --no-metro.");
    if (options.offline && options.platform === "android") throw new Error("--offline is iOS only for now: the Android flows still sign in.");
    options.out ??= resolve("dist/ui-snapshots", options.platform);
  } else if (command === "plan") {
  } else if (command === "warm") {
    if (options.platform !== "ios") throw new Error("warm is for --platform ios.");
  } else if (command === "merge") {
    if (!options.plan || !options.shards) throw new Error("merge needs --plan <plan.json> and --shards <dir>.");
    options.out ??= resolve("dist/ui-snapshots/merged");
  } else if (command === "compare") {
    if (!options.ios || !options.android) throw new Error("compare needs --ios <dir> and --android <dir>.");
    options.out ??= resolve("dist/ui-snapshots/pairs");
  } else if (command === "redact") {
    if (!options.dir) throw new Error("redact needs --dir <dir>.");
  } else if (command === "boot" || command === "driver") {
    if (options.platform !== "ios") throw new Error(`${command} is for --platform ios.`);
    if (options.targets.length !== 1) throw new Error(`${command} takes one --target: phone or tablet.`);
  } else {
    throw new Error("Usage: node scripts/ui-snapshots.mjs capture|plan|warm|merge|compare|redact|boot|driver [options]. See the header of this file.");
  }
  return options;
}

/** The selection shared by capture and plan: targets, orientations, themes, text sizes, perf and the named screens or interactions. */
function checkSelection(options) {
  if (options.targets.length === 0 || options.targets.some((target) => target !== "phone" && target !== "tablet")) throw new Error("--target must be phone, tablet, or a comma list of both.");
  for (const target of options.targets) for (const orientation of options.orientations ?? []) if (!SIZE_BANDS[`${target}-${orientation}`]) throw new Error(`The ${target} target has no ${orientation} orientation. Known: ${Object.keys(SIZE_BANDS).join(", ")}.`);
  for (const theme of options.themes) if (theme !== "light" && theme !== "dark") throw new Error(`Unknown theme "${theme}". Use light and/or dark.`);
  if (!Number.isInteger(options.perf) || options.perf < 0) throw new Error("--perf must be a whole number of runs.");
  if (options.textSizes?.length === 0 || options.textSizes?.some((size) => !(size in TEXT_SIZES))) throw new Error(`Unknown --text-size. Use a comma list of ${Object.keys(TEXT_SIZES).join(", ")}.`);
  if (options.scope === "core" && !options.screens && options.textSizes?.some((size) => !CORE_TEXT_SIZES.includes(size))) throw new Error(`The core scope captures ${CORE_TEXT_SIZES.join(" and ")} only; use --scope full for ${options.textSizes.join(", ")}.`);
  if (options.perf > 0 && options.targets.length > 1) throw new Error("--perf runs one target at a time.");
  if (options.perf > 0 && options.textSizes && !options.textSizes.includes("default")) throw new Error("--perf runs at the default text size; add default to --text-size.");
  if (options.part === "perf" && options.perf < 1) throw new Error("--part perf needs --perf <runs>.");
  if (options.part === "flow" && options.targets.some((target) => target !== "tablet")) throw new Error("--part flow is for --target tablet.");
  if (options.part === "motion" && options.targets.some((target) => target !== "phone")) throw new Error("--part motion is for --target phone.");
  for (const theme of options.motionThemes) if (theme !== "light" && theme !== "dark") throw new Error(`Unknown motion theme "${theme}". Use light and/or dark.`);
  // A selection without a part names screens and interactions alike; `--part motion` names interactions only.
  const known = new Set([...(options.part === "motion" ? [] : [...SCREENS, ...TABLET_SCREENS]), ...(!options.part || options.part === "motion" ? MOTIONS : [])].map((item) => item.name));
  for (const name of options.screens ?? []) if (!known.has(name)) throw new Error(`Unknown screen or interaction "${name}". Known: ${[...known].join(", ")}.`);
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

/** Runs one step and prints its duration, so a CI log shows where the time goes. */
function timed(label, step) {
  const started = Date.now();
  const result = step();
  process.stdout.write(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return result;
}

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

async function startMetro({ frameProbe, offline }) {
  const metro = spawn("bunx", ["expo", "start", "--port", String(METRO_PORT)], {
    env: { ...process.env, CI: "1", EXPO_PUBLIC_UI_SNAPSHOTS: "1", EXPO_PUBLIC_COHUB_ENV: process.env.EXPO_PUBLIC_COHUB_ENV || "dev", ...(frameProbe ? { EXPO_PUBLIC_FRAME_PROBE: "1" } : {}), ...(offline ? { EXPO_PUBLIC_E2E_SESSION: "offline" } : {}) },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  // Expo's CLI and its bundler take about 90 s to answer on a cold runner; a run that timed out at 120 s was a false failure.
  const deadline = Date.now() + 300_000;
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
  throw new Error(`Metro did not answer on port ${METRO_PORT} within five minutes.`);
}

/**
 * The app's first bundle takes minutes on a cold Metro, and the simulator boots for minutes before the app asks
 * for it. This requests the same bundle the app's React Native host asks for (its URL, with Expo's rewrite
 * filling the transform options), so Metro's transforms are done when the app launches. Detached: the capture
 * does not wait for it.
 */
function iosBundleUrl() {
  return `http://localhost:${METRO_PORT}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&app=${PACKAGE_ID}`;
}

function warmIosBundle() {
  spawn("curl", ["--silent", "--output", "/dev/null", iosBundleUrl()], { stdio: "ignore", detached: true }).unref();
}

/**
 * Starts Metro and requests the app's first bundle, then stops it. Metro's transform cache lives on disk, so the
 * capture jobs that restore it start with the bundle already transformed. Expo's own "iOS Bundled" line shows the cost.
 */
async function warm({ offline }) {
  const metro = await startMetro({ frameProbe: false, offline });
  const started = Date.now();
  try {
    const response = await fetch(iosBundleUrl(), { signal: AbortSignal.timeout(WARM_TIMEOUT_MS) });
    const size = (await response.arrayBuffer()).byteLength;
    if (!response.ok) throw new Error(`Metro answered ${response.status} for the iOS bundle.`);
    process.stdout.write(`Warmed the iOS bundle: ${size} bytes in ${((Date.now() - started) / 1000).toFixed(1)} s.\n`);
  } finally {
    stopMetro(metro);
  }
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
 * With a `session` (an offline run) the app draws its fixtures without sign-in, so the flow waits for
 * Chats alone.
 */
function preamble(platform, session, orientation = null, prelude = []) {
  const login = resolve(LOGIN_FLOWS[platform]);
  const start = session ? "Chats" : "Continue with Cohub|Chats";
  return [
    `appId: ${PACKAGE_ID}`,
    "---",
    ...prelude,
    // Before the launch, so the app draws in the orientation the flow asks for and not in the one an earlier flow left.
    ...(platform === "ios" && orientation ? [`- setOrientation: ${MAESTRO_ORIENTATION[orientation]}`, "- waitForAnimationToEnd:", "    timeout: 5000"] : []),
    "- launchApp:",
    "    stopApp: true",
    "    permissions:",
    "      all: allow",
    // A debug binary fetches its first bundle from Metro, which can take minutes on a cold cache.
    "- extendedWaitUntil:",
    `    visible: ${yamlString(`(${start}|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING}|${OPEN_IN_APP})`)}`,
    "    timeout: 600000",
    "- runFlow:",
    "    when:",
    `      visible: ${yamlString(OPEN_IN_APP)}`,
    ...answerOpenInApp(platform === "ios" && orientation === "landscape"),
    "      - extendedWaitUntil:",
    `          visible: ${yamlString(`(${start}|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING})`)}`,
    "          timeout: 300000",
    "- repeat:",
    "    while:",
    `      visible: ${yamlString(NOT_RESPONDING)}`,
    "    times: 3",
    "    commands:",
    "      - tapOn: \"Wait\"",
    "      - extendedWaitUntil:",
    `          visible: ${yamlString(`(${start}|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING})`)}`,
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
    `          visible: ${yamlString(`(${start}|${DEV_SERVER_ERROR}.*)`)}`,
    "          timeout: 300000",
    ...(session ? [] : [
      "- runFlow:",
      "    when:",
      "      visible: \"Continue with Cohub\"",
      `    file: ${yamlString(login)}`,
    ]),
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
  ];
}

/**
 * A deep link navigates after `openLink` returns, so an animation wait can return before the screen
 * changes. A screen names text that shows it is ready; without one it gets a short settle.
 */
function openScreen(lines, platform, link, first, ready, landscape = false) {
  lines.push(`- openLink: ${yamlString(link)}`);
  // Matched inside the element's text: iOS and Android often merge a card or row into one element.
  const screen = ready ? `.*${ready}.*` : "^__settle__$";
  // iOS asks once per simulator before handing a custom-scheme link to the app, and the question can arrive
  // seconds after openLink returns. On a cold Metro the first screen after it also loads its route's modules
  // (tens of seconds), so a flow's first link waits up to 60 s for the question or the screen, answers the
  // question if it is up, then waits up to 60 s for the screen. An absent question costs Maestro's ~7 s
  // optional lookup, so only a flow's first link checks.
  if (platform === "ios" && first && ready) {
    lines.push("- extendedWaitUntil:", `    visible: ${yamlString(`(${OPEN_IN_APP}|${screen})`)}`, "    timeout: 60000");
    lines.push("- runFlow:", "    when:", `      visible: ${yamlString(OPEN_IN_APP)}`, ...answerOpenInApp(landscape));
    lines.push("- extendedWaitUntil:", `    visible: ${yamlString(screen)}`, "    timeout: 60000");
  } else if (ready) lines.push("- extendedWaitUntil:", `    visible: ${yamlString(screen)}`, "    timeout: 20000");
  else lines.push("- extendedWaitUntil:", "    visible: \"^__settle__$\"", "    timeout: 1500", "    optional: true");
  lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
}

// A tap waits for the screen to settle, which never happens beside a spinner; a second is enough here.
const SETTLE = "    waitToSettleTimeoutMs: 1000";
// iOS 26 minimizes the tab bar to the current tab on scroll, and a tab root keeps its offset across deep links.
const TAB_LABELS = new Set(["Chats", "Spaces", "Activity", "Me"]);
// The Chats source filter. Android's drawn button has a testID; iOS's native bar item has only its label
// ("Filter Chats by who started them, All"), so iOS matches the label's start.
const SOURCE_FILTER_IOS = "Filter Chats by .*";

// The left margin of a list, where a still press does nothing: no text, bubble or row reaches x = 2%.
const HOLD_POINT = "2%, 50%";

function pushSteps(lines, platform, steps = []) {
  for (const step of steps) {
    // What a tap opens can take a moment to draw; `waitFor` holds the capture until it has.
    // `exact` matches the whole text, for a short word such as a menu item that other labels contain.
    // A hold is an optional wait for a state that never comes, so the flow pauses for the whole timeout.
    // Holds and drags end where they are: a wait for animations after them would run to its full five seconds on a Chat.
    // An iOS hold presses still on the left margin for its full time: an optional wait for a state that never comes
    // runs for several times its timeout there, since each check of the hierarchy takes seconds on a Chat.
    if (step.hold && platform === "ios") {
      lines.push("- swipe:", `    start: ${yamlString(HOLD_POINT)}`, `    end: ${yamlString(HOLD_POINT)}`, `    duration: ${step.hold}`);
      continue;
    }
    if (step.hold) {
      lines.push("- extendedWaitUntil:", "    visible: \"^__hold__$\"", `    timeout: ${step.hold}`, "    optional: true");
      continue;
    }
    if (step.drag) {
      lines.push("- swipe:", `    start: ${yamlString(step.drag.from)}`, `    end: ${yamlString(step.drag.to)}`, `    duration: ${step.drag.duration}`);
      continue;
    }
    if (step.scrollTo) lines.push("- scrollUntilVisible:", "    element:", `      text: ${yamlString(`.*${step.scrollTo}.*`)}`, "    direction: DOWN", "    timeout: 60000");
    else if (step.waitFor) lines.push("- extendedWaitUntil:", `    visible: ${yamlString(step.exact ? step.waitFor : `.*${step.waitFor}.*`)}`, "    timeout: 20000");
    // For a loading state: the screen counts as ready once it has gone.
    else if (step.waitGone) lines.push("- extendedWaitUntil:", `    notVisible: ${yamlString(`.*${step.waitGone}.*`)}`, "    timeout: 60000");
    // A pause with nothing to wait for, as a keyboard needs after a tap before it is drawn.
    else if (step.settle) lines.push("- extendedWaitUntil:", "    visible: \"^__settle__$\"", "    timeout: 2500", "    optional: true");
    else if (step.tapOnId) lines.push("- tapOn:", `    id: ${yamlString(step.tapOnId)}`, SETTLE);
    // The root link selects Chats on iPad, where a minimized system tab bar can hide the label.
    else if (step.chatsTab && platform === "ios") lines.push("- openLink: \"cohub:///\"", "- extendedWaitUntil:", "    visible: \".*Chats.*\"", "    timeout: 20000");
    else if (step.chatsTab) lines.push("- tapOn:", "    text: \"Chats\"", SETTLE);
    else if (step.open) {
      openScreen(lines, platform, step.open, false, step.ready);
      continue;
    }
    else if (step.tapPoint) lines.push("- tapOn:", `    point: ${yamlString(step.tapPoint[platform])}`, SETTLE);
    else if (step.tapOnSourceFilter) lines.push("- tapOn:", ...(platform === "android" ? ["    id: \"chats-source-menu-button\""] : [`    text: ${yamlString(SOURCE_FILTER_IOS)}`]), SETTLE);
    else if (step.longPressOn) lines.push("- longPressOn:", `    text: ${yamlString(step.longPressOn)}`, SETTLE);
    else if (step.back && platform === "android") lines.push("- back");
    else if (step.back) lines.push("- swipe:", "    start: 2%, 50%", "    end: 85%, 50%", "    duration: 400");
    // A deliberate drag, slow enough that the content follows the finger and then coasts.
    else if (step.swipe === "up") lines.push("- swipe:", "    start: 50%, 72%", "    end: 50%, 32%", "    duration: 700");
    else if (step.swipe === "nudge") lines.push("- swipe:", "    start: 50%, 60%", "    end: 50%, 55%", "    duration: 900");
    else if (step.swipe === "down") lines.push("- swipe:", "    start: 50%, 32%", "    end: 50%, 72%", "    duration: 700");
    // Across the right pane, which opens the Chat's Space panel.
    else if (step.swipe === "right") lines.push("- swipe:", "    start: 55%, 50%", "    end: 95%, 50%", "    duration: 400");
    else {
      // Tapping the minimized bar (the current tab's bubble, bottom leading) expands it again. Android's drawn bar
      // keeps the hidden tabs' labels, so it is found by the bubble's id instead.
      if (platform === "ios" && TAB_LABELS.has(step.tapOn)) lines.push("- runFlow:", "    when:", `      notVisible: ${yamlString(step.tapOn)}`, "    commands:", "      - tapOn:", "          point: 13%, 94%", "      - waitForAnimationToEnd:", "          timeout: 5000");
      // A link that switched tabs expands the bar itself, so the bubble may be gone by the time it is tapped.
      if (platform === "android" && TAB_LABELS.has(step.tapOn)) lines.push("- runFlow:", "    when:", "      visible:", "        id: \"tab-bar-expand\"", "    commands:", "      - tapOn:", "          id: \"tab-bar-expand\"", "          optional: true", "      - waitForAnimationToEnd:", "          timeout: 5000");
      lines.push("- tapOn:", `    text: ${yamlString(step.tapOn)}`, ...(step.optional ? ["    optional: true"] : []), SETTLE);
    }
    lines.push("- waitForAnimationToEnd:", "    timeout: 5000");
  }
}

/**
 * iOS asks once per simulator before the app's first custom-scheme link, and the question is drawn in the device's
 * frame: a landscape window never accepts it (the logs show it stuck, with the device in portrait). A landscape flow
 * therefore answers it on a portrait launch; the preamble then turns the device and launches the app for its screens.
 */
function answerQuestionInPortrait(platform, session) {
  const start = session ? "Chats" : "Continue with Cohub|Chats";
  const lines = [
    "- setOrientation: PORTRAIT",
    "- waitForAnimationToEnd:",
    "    timeout: 5000",
    "- launchApp:",
    "    stopApp: true",
    "    permissions:",
    "      all: allow",
    "- extendedWaitUntil:",
    `    visible: ${yamlString(`(${start}|${DEV_SERVER_ERROR}.*|${NOT_RESPONDING}|${OPEN_IN_APP})`)}`,
    "    timeout: 600000",
  ];
  openScreen(lines, platform, "cohub://debug/chat?fixture=conversation", true, "Fix the Android sheet height");
  return lines;
}

/** The app's own word on its layout: a tablet run must draw the split panes before anything is captured. */
function checkSplit(lines, platform, landscape = false) {
  openScreen(lines, platform, "cohub://debug/chat?fixture=conversation", true, "Fix the Android sheet height", landscape);
  lines.push("- assertVisible:", "    id: \"split-right-pane\"");
}

// The account screens are seeded (src/data/fixtures), so none of these states may show: a failed read or an
// empty list would mean the seed is missing something the screen needs.
const ACCOUNT_SCREENS = new Set(["chats", "chats-snap", "chats-scrolled", "spaces", "spaces-scrolled", "activity", "activity-scrolled", "settings", "settings-scrolled", "chat-real", "chat-real-model", "split-chat-real", "split-chat-panel"]);
const EMPTY_OR_ERROR_TEXT = "(.*are unavailable|.*Connection unavailable|.*Still connecting.*|.*No Chats yet|.*No Spaces yet|.*Could not .*|.*Unable to .*)";

/** One Maestro run per theme: sign in if needed, then visit and capture each screen. */
export function buildFlow({ platform, session, screens, target, orientation }) {
  const landscape = platform === "ios" && target === "tablet" && orientation === "landscape";
  const lines = preamble(platform, session, target === "tablet" ? orientation : null, landscape ? answerQuestionInPortrait(platform, session) : []);
  if (target === "tablet") checkSplit(lines, platform, landscape);
  for (const [index, screen] of screens.entries()) {
    if (screen.fresh) lines.push("- launchApp:", "    stopApp: true", "- extendedWaitUntil:", "    visible: \"Chats\"", "    timeout: 120000");
    openScreen(lines, platform, screen.link, index === 0 && target !== "tablet", screen.ready, landscape);
    pushSteps(lines, platform, screen.steps);
    if (ACCOUNT_SCREENS.has(screen.name)) lines.push("- assertNotVisible:", `    text: ${yamlString(EMPTY_OR_ERROR_TEXT)}`);
    // Maestro only writes screenshots inside its test output directory, so the path stays relative.
    lines.push("- takeScreenshot:", `    path: ${yamlString(screen.name)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The split-layout interaction flow. Signed in it ends by sending a message; offline (`session`) it
 * picks the seeded Space instead, so every layout assertion still runs and only the send is dropped.
 */
export function buildTabletFlow({ platform, session, maestroOrientation }) {
  const lines = preamble(platform, session, "portrait");
  checkSplit(lines, platform);
  lines.push("- runFlow:", `    file: ${yamlString(resolve(TABLET_LAYOUT_FLOW))}`, "    env:", `      FIRST_ROW: ${yamlString(LEFT_FIRST_ROW[platform])}`, `      SECOND_ROW: ${yamlString(LEFT_SECOND_ROW[platform])}`, `      PORTRAIT: ${maestroOrientation("portrait")}`, `      LANDSCAPE: ${maestroOrientation("landscape")}`);
  lines.push("- runFlow:", `    file: ${yamlString(resolve(session ? TABLET_OFFLINE_FLOW : TABLET_SEND_FLOW))}`);
  return `${lines.join("\n")}\n`;
}

/** One pass of the perf sequence from a fresh launch. */
function buildPerfFlow({ platform, session, target }) {
  const lines = preamble(platform, session, target === "tablet" ? "portrait" : null);
  openScreen(lines, platform, "cohub://settings", target !== "tablet", "Appearance");
  pushSteps(lines, platform, PERF_STEPS[target]);
  return `${lines.join("\n")}\n`;
}

/** Records each interaction from its settled start screen to its settled end. */
export function buildMotionFlow({ platform, session, motions }) {
  const lines = preamble(platform, session);
  for (const [index, motion] of motions.entries()) {
    // `fresh` relaunches first, so an overlay the previous recording left open (a New Chat sheet) is gone.
    if (motion.fresh) lines.push("- launchApp:", "    stopApp: true", "- extendedWaitUntil:", "    visible: \"Chats\"", "    timeout: 120000");
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
const DRIVER_NOT_READY = "iOS driver not ready in time";
const RUNNING_ON = "Running on ";
const DRIVER_ATTEMPTS = 3;
const FLOW_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 15_000;
const DRIVER_LINE = /xctest|xcodebuild|xcuitest|driver|simctl|simulator|exception|error/i;

/**
 * Runs one `maestro test` and reports how it went. Its output is copied to this process as it arrives. `started` is
 * true once Maestro names the device it runs on, which it does only after the driver answers; a start that never gets
 * there is killed a minute after the driver's own timeout.
 */
export function launchMaestro(args, cwd, device) {
  const watchdogMs = driverWatchdogMs();
  return new Promise((resolveAttempt, reject) => {
    const started = Date.now();
    let output = "";
    let upAt = null;
    let timedOut = false;
    let driverHung = false;
    const child = spawn("maestro", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const copy = (sink) => (text) => {
      output += text;
      sink.write(text);
      if (upAt === null && output.includes(RUNNING_ON)) {
        upAt = Date.now();
        process.stdout.write(`Driver up on ${device} after ${((upAt - started) / 1000).toFixed(0)} s.\n`);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", copy(process.stdout));
    child.stderr.on("data", copy(process.stderr));
    // A failed iOS `viewHierarchy` request can leave Maestro hung instead of exiting, so each attempt is capped.
    const timers = [
      setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, MAESTRO_ATTEMPT_MS),
      setTimeout(() => {
        if (upAt !== null) return;
        driverHung = true;
        child.kill("SIGKILL");
      }, watchdogMs),
    ];
    child.on("error", (error) => {
      timers.forEach(clearTimeout);
      reject(error);
    });
    child.on("close", (status) => {
      timers.forEach(clearTimeout);
      resolveAttempt({ status, timedOut, driverHung, started: upAt !== null, output, seconds: (Date.now() - started) / 1000 });
    });
  });
}

/** Maestro's own startup ceiling plus a minute: a start that is still silent then is killed as hung. */
function driverWatchdogMs() {
  return (Number(process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT) || 300_000) + 60_000;
}

/** A start that never reached the device: Maestro's startup timeout, or the watchdog. No step of the flow has run. */
function driverNeverStarted(attempt) {
  return !attempt.started && (attempt.driverHung || attempt.output.includes(DRIVER_NOT_READY));
}

/**
 * Runs a flow until it passes or a budget runs out. A driver that never starts has run no step, so only its start is
 * retried, on its own budget; a flow that fails after its driver came up is retried as a whole, as before. The first
 * failed start is read by `driverLog` as soon as it fails, before the next start overwrites Maestro's debug output,
 * and that text is returned as `driverLog` whatever the later starts do.
 */
export async function runFlowWithRetries(launch, { describe, driverAttempts = DRIVER_ATTEMPTS, flowAttempts = FLOW_ATTEMPTS, pauseMs = RETRY_PAUSE_MS, pause = sleep, log = (text) => process.stdout.write(text), driverLog = () => "" }) {
  let drivers = 0;
  let flows = 0;
  let firstDriverLog = null;
  for (;;) {
    const attempt = await launch();
    if (attempt.status === 0 && !attempt.timedOut) return { ok: true, attempt };
    if (driverNeverStarted(attempt)) {
      drivers += 1;
      if (firstDriverLog === null) {
        firstDriverLog = driverLog(attempt);
        if (firstDriverLog) log(`Driver start 1 failed on ${describe}. Its log:\n${firstDriverLog}\n`);
      }
      log(`Driver start ${drivers} of ${driverAttempts} failed on ${describe} after ${attempt.seconds.toFixed(0)} s; no step ran.${drivers < driverAttempts ? " Starting the driver again." : ""}\n`);
      if (drivers === driverAttempts) return { ok: false, reason: "driver", attempt, driverLog: firstDriverLog };
    } else {
      flows += 1;
      log(`Maestro ${attempt.timedOut ? "timed out" : "failed"} on ${describe}.${flows < flowAttempts ? ` Retrying (attempt ${flows + 1} of ${flowAttempts}).` : ""}\n`);
      if (flows === flowAttempts) return { ok: false, reason: "flow", attempt };
    }
    await pause(pauseMs);
  }
}

/** The driver's own lines from a failed start: Maestro's output, the log files its debug output wrote, and the device's state. */
function driverLogExcerpt({ output }, { udid, debugOutput, since, secrets }) {
  const fromOutput = output.split("\n").filter((line) => !/^\s+at\s/.test(line) && DRIVER_LINE.test(line));
  const logs = [...listFiles(debugOutput), ...listFiles(join(homedir(), ".maestro"))].filter((path) => path.endsWith(".log") && statSync(path).mtimeMs >= since);
  const fromLogs = logs.flatMap((path) => readFileSync(path, "utf8").split("\n").filter((line) => DRIVER_LINE.test(line)).slice(-40).map((line) => `${basename(path)}: ${line}`));
  const device = run("xcrun", ["simctl", "list", "devices"], { allowFailure: true }).split("\n").find((line) => line.includes(udid)) ?? `${udid} is not listed`;
  return scrubSecrets([`device: ${device.trim()}`, ...fromOutput.slice(-25), ...fromLogs.slice(-40)].join("\n"), secrets);
}

async function runMaestro({ device, flowPath, out, testOutput, offline = false }) {
  const credentials = offline ? [] : ["E2E_ACCOUNT_EMAIL", "E2E_ACCOUNT_PASSWORD"].map((key) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`${key} is required: every screen renders AuthScreen until a session exists (dev tenant account).`);
    return `${key}=${value}`;
  });
  // Maestro records `-e` values verbatim in commands.json and its logs, and this directory is uploaded.
  const secrets = credentials.map((pair) => pair.slice(pair.indexOf("=") + 1));
  // Kept inside the uploaded directory so a failed run carries Maestro's own screenshots and view hierarchy.
  const debugOutput = join(out, "maestro-debug", basename(flowPath, ".yaml"));
  const args = ["test", "--device", device, "--debug-output", debugOutput, "--test-output-dir", testOutput, ...credentials.flatMap((pair) => ["-e", pair]), flowPath];
  const describe = basename(flowPath);
  const since = Date.now();
  let outcome;
  try {
    outcome = await runFlowWithRetries(() => launchMaestro(args, out, device), {
      describe,
      driverLog: (attempt) => driverLogExcerpt(attempt, { udid: device, debugOutput, since, secrets }),
    });
  } finally {
    redact(debugOutput, secrets);
    redact(testOutput, secrets);
  }
  if (outcome.ok) return;
  if (outcome.reason === "driver") throw new Error(`Maestro's driver did not start on ${device} in ${DRIVER_ATTEMPTS} attempts (${describe}). The first start's log:\n${outcome.driverLog}`);
  throw new Error(`Maestro failed on ${describe}. Its screenshots and view hierarchy are in ${debugOutput}.`);
}

const MAX_REDACTED_BYTES = 32 * 1024 * 1024;

/** XCTest types the first character on its own and logs the remaining text, so each secret is scrubbed in both forms. */
function scrubSecrets(text, secrets) {
  const variants = secrets.flatMap((secret) => [secret, secret.slice(1)]).filter((value) => value.length >= 4).sort((a, b) => b.length - a.length);
  return variants.reduce((clean, secret) => clean.split(secret).join("***"), text);
}

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
      const clean = scrubSecrets(source, secrets);
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
    // A tablet's system may letterbox an app that asks for portrait rather than turn the display for it, as HyperOS
    // does. The emulator turns the display by default, which hides how the app releases a letterboxed tablet.
    const ignoredOrientation = target === "tablet" ? /\btrue\b/.test(adb("shell", "wm", "get-ignore-orientation-request")) : null;
    if (target === "tablet") adb("shell", "wm", "set-ignore-orientation-request", "true");
    // Rotation 0 is the panel's natural orientation, which is landscape on a tablet such as the Pixel Tablet.
    const naturalLandscape = naturalWidth > naturalHeight;
    const rotationFor = (orientation) => (orientation === "landscape") === naturalLandscape ? 0 : 1;
    // Maestro's PORTRAIT is rotation 0 and LANDSCAPE_LEFT rotation 90, whatever the panel's natural orientation.
    const maestroOrientation = (orientation) => rotationFor(orientation) === 0 ? "PORTRAIT" : "LANDSCAPE_LEFT";
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
      maestroOrientation,
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
        if (ignoredOrientation !== null) run("adb", ["-s", serial, "shell", "wm", "set-ignore-orientation-request", String(ignoredOrientation)], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "settings", "put", "global", "hide_error_dialogs", "0"], { allowFailure: true });
        run("adb", ["-s", serial, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"], { allowFailure: true });
      },
    };
  },
};

/** The target's simulator: the first of its devices installed on this machine, with its logical portrait size. */
function iosDevice(target) {
  requireCommand("xcrun", ["--version"], "iOS capture needs macOS with Xcode.");
  const devices = Object.values(JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "-j"])).devices).flat();
  const sizes = IOS_DEVICES[target];
  const device = Object.keys(sizes).map((name) => devices.find((candidate) => candidate.name === name)).find(Boolean);
  if (!device) throw new Error(`No ${target} simulator among ${Object.keys(sizes).join(", ")}. Install one in Xcode > Settings > Components, or add its logical size to IOS_DEVICES.`);
  return { ...device, size: sizes[device.name] };
}

/** `simctl boot` returns once the boot is requested, so a CI step can start it early and the capture waits with bootstatus. */
function bootSimulator(target) {
  const device = iosDevice(target);
  if (device.state === "Shutdown") timed("boot", () => run("xcrun", ["simctl", "boot", device.udid]));
  process.stdout.write(`${device.name} (${device.state}) ${device.udid}\n`);
}

/**
 * Starts Maestro's driver on the target's simulator once: `hierarchy` opens a session and closes it. A start that fails
 * is reported and not fatal, since the capture starts the driver itself and retries it.
 */
function warmDriver(target) {
  const device = iosDevice(target);
  timed("bootstatus", () => run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]));
  const started = Date.now();
  const result = spawnSync("maestro", ["--device", device.udid, "hierarchy"], { encoding: "utf8", timeout: driverWatchdogMs(), stdio: ["ignore", "ignore", "pipe"] });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (result.status === 0) {
    process.stdout.write(`Driver warm on ${device.udid} after ${seconds} s.\n`);
    return;
  }
  const reason = result.error?.message ?? (result.signal ? `killed by ${result.signal}` : `exit ${result.status}`);
  process.stdout.write(`Driver warm-up failed on ${device.udid} after ${seconds} s (${reason}); the capture starts the driver itself.\n${String(result.stderr ?? "").slice(-4000)}\n`);
}

const ios = {
  prepare(app, out, target) {
    const device = iosDevice(target);
    const [portraitWidth, portraitHeight] = device.size;
    // A simulator the boot step already started is Booting here; booting it again fails.
    if (device.state === "Shutdown") timed("boot", () => run("xcrun", ["simctl", "boot", device.udid]));
    let appPath = app;
    if (app.endsWith(".zip")) {
      const unpacked = join(out, "app");
      rmSync(unpacked, { recursive: true, force: true });
      timed("unzip", () => run("ditto", ["-x", "-k", app, unpacked]));
      const bundle = readdirSync(unpacked).find((entry) => entry.endsWith(".app"));
      if (!bundle) throw new Error(`${app} does not contain a .app bundle.`);
      appPath = join(unpacked, bundle);
    }
    timed("bootstatus", () => run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]));
    timed("install", () => run("xcrun", ["simctl", "install", device.udid, appPath]));
    run("xcrun", ["simctl", "status_bar", device.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"]);
    const setContentSize = (category) => run("xcrun", ["simctl", "ui", device.udid, "content_size", category], { allowFailure: true });
    return {
      device: device.udid,
      setTextSize: (size) => {
        const category = TEXT_SIZES[size];
        setContentSize(category);
        process.stdout.write(`Text size ${size}: content size ${category}\n`);
      },
      setTheme: (theme) => run("xcrun", ["simctl", "ui", device.udid, "appearance", theme]),
      setAnimations: () => undefined,
      // Maestro turns the simulator in each flow's preamble.
      setOrientation: () => undefined,
      maestroOrientation: (orientation) => MAESTRO_ORIENTATION[orientation],
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
      restore: () => {
        run("xcrun", ["simctl", "status_bar", device.udid, "clear"], { allowFailure: true });
        setContentSize(TEXT_SIZES.default);
      },
    };
  },
};

async function capture(options) {
  requireCommand("maestro", ["--version"], "Install Maestro: curl -Ls https://get.maestro.mobile.dev | bash");
  mkdirSync(options.out, { recursive: true });
  const session = options.offline;
  const metro = options.metro ? await startMetro({ frameProbe: options.perf > 0, offline: options.offline }) : null;
  if (metro && options.platform === "ios") warmIosBundle();
  const missing = [];
  let cells = 0;
  const described = [];
  try {
    for (const target of options.targets) {
      for (const cell of cellsFor({ target, scope: options.scope, screens: options.screens, textSizes: options.textSizes })) {
        described.push(`${target} ${cell.textSize} (${cell.names.length})`);
        cells += await captureCell({ ...options, target, textSize: cell.textSize, names: cell.names }, session, missing);
      }
    }
  } finally {
    stopMetro(metro);
  }
  if (missing.length) throw new Error(`Maestro finished but these captures are missing: ${missing.join(", ")}.`);
  process.stdout.write(`Captured ${cells} cells (${described.join(", ")}) in ${options.out}\n`);
}

/** The slices one capture runs: a `--part`, or without one every slice the target has in this run. */
function partsFor(options, screens) {
  if (options.part) return [options.part];
  return ["screens", ...(options.target === "tablet" && !options.screens && options.scope === "full" ? ["flow"] : []), ...(options.motion ? ["motion"] : []), ...(options.perf > 0 ? ["perf"] : [])];
}

/** One device at one text size: the screens it names in each orientation and theme, then the slices the target has beyond them. */
async function captureCell(options, session, missing) {
  const catalog = options.target === "tablet" ? TABLET_SCREENS : SCREENS;
  const screens = catalog.filter((screen) => options.names.includes(screen.name));
  const motions = motionsNamed(options.screens);
  const parts = partsFor(options, screens);
  // The split flows and the motion recordings run once, at the default text size.
  const doScreens = parts.includes("screens") && screens.length > 0;
  const doFlow = parts.includes("flow") && options.target === "tablet" && options.textSize === "default";
  const doMotion = parts.includes("motion") && options.target === "phone" && options.textSize === "default" && motions.length > 0;
  const doPerf = parts.includes("perf") && options.perf > 0 && options.textSize === "default";
  if (!doScreens && !doFlow && !doMotion && !doPerf) return 0;
  const orientations = options.orientations ?? (options.target === "tablet" ? ["portrait", "landscape"] : ["portrait"]);
  // Text sizes other than the default get their own theme directories, so every cell of a run survives.
  const suffix = options.textSize === "default" ? "" : `-${options.textSize}`;
  const device = (options.platform === "android" ? android : ios).prepare(options.app, options.out, options.target);
  device.setTextSize?.(options.textSize);
  // The phone keeps the original layout (`<theme>/`); other targets are grouped by device and orientation.
  const groupDirectory = (orientation) => options.target === "phone" ? options.out : join(options.out, `${options.target}-${orientation}`);
  try {
    for (const orientation of doScreens ? orientations : []) {
      const group = `${options.target}-${orientation}`;
      device.setOrientation(orientation);
      assertBand(group, device.logicalSize(orientation), options.platform === "android" ? "the emulator" : "the simulator");
      for (const theme of options.themes) {
        const directory = join(groupDirectory(orientation), `${theme}${suffix}`);
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        device.setTheme(theme);
        const name = `${options.target === "phone" ? theme : `${group}-${theme}`}${suffix}`;
        const flowPath = join(options.out, `${name}.yaml`);
        writeFileSync(flowPath, buildFlow({ platform: options.platform, session, screens, target: options.target, orientation }));
        const testOutput = join(options.out, "maestro-output", name);
        rmSync(testOutput, { recursive: true, force: true });
        await runMaestro({ device: device.device, flowPath, out: options.out, testOutput, offline: options.offline });
        for (const screen of screens) {
          const file = `${screen.name}.png`;
          // Maestro may nest screenshots in a per-run folder under its test output directory.
          const found = findFile(testOutput, file);
          if (found) run("mv", [found, join(directory, file)]);
          else missing.push(`${relative(options.out, directory)}/${file}`);
        }
      }
    }
    if (doFlow) {
      const directory = join(options.out, "tablet-flow");
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      device.setTheme("light");
      device.setOrientation("portrait");
      const flowPath = join(options.out, "tablet-flow.yaml");
      writeFileSync(flowPath, buildTabletFlow({ platform: options.platform, session, maestroOrientation: device.maestroOrientation }));
      const testOutput = join(options.out, "maestro-output", "tablet-flow");
      rmSync(testOutput, { recursive: true, force: true });
      await runMaestro({ device: device.device, flowPath, out: options.out, testOutput, offline: options.offline });
      for (const file of listFiles(testOutput).filter((path) => path.endsWith(".png"))) run("mv", [file, join(directory, basename(file))]);
    }
    if (doMotion) {
      const directory = join(options.out, "motion");
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      device.setAnimations(true);
      for (const theme of options.motionThemes) {
        const themeDirectory = join(directory, theme);
        mkdirSync(themeDirectory, { recursive: true });
        device.setTheme(theme);
        const name = `motion-${theme}`;
        const flowPath = join(options.out, `${name}.yaml`);
        writeFileSync(flowPath, buildMotionFlow({ platform: options.platform, session, motions }));
        const testOutput = join(options.out, "maestro-output", name);
        rmSync(testOutput, { recursive: true, force: true });
        await runMaestro({ device: device.device, flowPath, out: options.out, testOutput, offline: options.offline });
        for (const motion of motions) {
          const file = `${motion.name}.mp4`;
          const found = findFile(testOutput, file);
          if (!found) {
            missing.push(`motion/${theme}/${file}`);
            continue;
          }
          run("mv", [found, join(themeDirectory, file)]);
          recordMotion({ motion, theme, video: join(themeDirectory, file), commands: testOutput, directory: themeDirectory, missing });
        }
      }
      device.setAnimations(false);
    }
    if (doPerf) await capturePerf(options, device, session);
  } finally {
    device.restore();
  }
  return 1;
}

/**
 * Writes a recording's sidecar: the host-clock start from Maestro's command JSON (in the flow's test output, which the
 * upload leaves out), and the frames its `frames` name, cut from the mp4 at their real-time offsets. A failure is listed as missing, so the run reports it after the other captures.
 */
function recordMotion({ motion, theme, video, commands, directory, missing }) {
  try {
    const clock = recordingClock(commandLists(commands), `${motion.name} (${theme})`);
    const onset = { swipe: motion.onset ?? 0, seconds: motionOnset(video) };
    const frames = exportFrames(video, frameTimes(clock, motion.frames ?? [], onset), directory, framePrefix(motion));
    writeSidecar(join(directory, `${motion.name}.json`), { name: motion.name, theme, clock, onset, frames });
  } catch (error) {
    missing.push(`motion/${theme}/${motion.name} sidecar or frames: ${error instanceof Error ? error.message : String(error)}`);
  }
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
async function capturePerf(options, device, session) {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = join(options.out, "perf");
  mkdirSync(directory, { recursive: true });
  const group = `${options.target}-portrait`;
  device.setTheme("light");
  device.setOrientation("portrait");
  device.setAnimations(true);
  const flowPath = join(options.out, "perf.yaml");
  writeFileSync(flowPath, buildPerfFlow({ platform: options.platform, session, target: options.target }));
  const runs = [];
  try {
    for (let index = 1; index <= options.perf; index += 1) {
      const testOutput = join(options.out, "maestro-output", `perf-${index}`);
      rmSync(testOutput, { recursive: true, force: true });
      const startedAt = new Date().toISOString();
      await runMaestro({ device: device.device, flowPath, out: options.out, testOutput });
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
/** Recordings side by side at one height and frame rate, aligned on their first change; the shorter one holds its last frame. */
function pairMotion(options, unmatched) {
  let count = 0;
  // Each theme's recordings sit in `motion/<theme>/`; a theme that only one platform captured is listed as unmatched.
  for (const theme of ["light", "dark"]) {
    const iosDirectory = join(options.ios, "motion", theme);
    const androidDirectory = join(options.android, "motion", theme);
    if (!existsSync(iosDirectory) || !existsSync(androidDirectory)) continue;
    requireCommand("ffmpeg", ["-version"], "Install ffmpeg (apt-get install ffmpeg / brew install ffmpeg) to pair recordings.");
    const directory = join(options.out, "motion", theme);
    mkdirSync(directory, { recursive: true });
    const names = new Set([...readdirSync(iosDirectory), ...readdirSync(androidDirectory)].filter((name) => name.endsWith(".mp4")));
    for (const name of [...names].sort()) {
      const left = join(iosDirectory, name);
      const right = join(androidDirectory, name);
      if (!existsSync(left) || !existsSync(right)) {
        unmatched.push(`motion/${theme}/${name}`);
        continue;
      }
      const height = 1280;
      const lead = 0.3;
      const trim = (path) => String(Math.max(0, motionOnset(path) - lead));
      run("ffmpeg", ["-y", "-loglevel", "error", "-ss", trim(left), "-i", left, "-ss", trim(right), "-i", right, "-filter_complex",
        `[0:v]fps=30,scale=-2:${height},setsar=1[a];[1:v]fps=30,scale=-2:${height},setsar=1[b];[a]pad=iw+24:ih:0:0:color=0x808080[ag];[ag][b]hstack=inputs=2`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(directory, name)]);
      count += 1;
    }
  }
  return count;
}

function describeEntry(entry) {
  const where = entry.target === "tablet" ? `tablet ${entry.orientations.join("/")}` : "phone";
  if (entry.part === "flow") return `${where} split flows`;
  if (entry.part === "perf") return `${where} perf runs`;
  return `${where} ${entry.textSize} ${entry.part}: ${entry.screens.join(", ")}`;
}

/** Diagnostics stay out of the layout that compare reads: Maestro's output, its debug logs and the flow files. */
function isDiagnostic(name) {
  return name === "maestro-output" || name === "maestro-debug" || name.endsWith(".yaml");
}

/** Copies a file or directory tree; a file two jobs both wrote is an error, not an overwrite. */
function copyTree(source, destination) {
  if (statSync(source).isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name));
    return;
  }
  if (existsSync(destination)) throw new Error(`Two jobs wrote ${destination}.`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

/**
 * Combines the jobs' directories into one per artifact, in the layout compare reads. A job that did not upload, or
 * uploaded without one of its files, is listed in MISSING.txt in its artifact and fails the command after the copy.
 */
function merge(options) {
  const plan = JSON.parse(readFileSync(options.plan, "utf8"));
  rmSync(options.out, { recursive: true, force: true });
  const roots = Object.fromEntries([...new Set(plan.map((entry) => entry.target))].map((target) => [target, join(options.out, ARTIFACTS[target])]));
  for (const root of Object.values(roots)) mkdirSync(root, { recursive: true });
  const missing = Object.fromEntries(Object.keys(roots).map((target) => [target, []]));
  for (const entry of plan) {
    const root = roots[entry.target];
    const source = join(options.shards, entry.artifact);
    if (!existsSync(source)) {
      missing[entry.target].push(`${entry.artifact} did not upload; it owned ${describeEntry(entry)}`);
      continue;
    }
    for (const name of readdirSync(source)) copyTree(join(source, name), isDiagnostic(name) ? join(root, "diagnostics", entry.artifact, name) : join(root, name));
    for (const path of expectedOutputs(entry, options)) {
      const found = path.endsWith("/") ? existsSync(join(root, path)) && statSync(join(root, path)).isDirectory() : existsSync(join(root, path));
      if (!found) missing[entry.target].push(`${path} is missing from ${entry.artifact} (${describeEntry(entry)})`);
    }
  }
  let count = 0;
  for (const [target, root] of Object.entries(roots)) {
    const lines = missing[target];
    count += lines.length;
    if (lines.length) writeFileSync(join(root, "MISSING.txt"), `${lines.join("\n")}\n`);
    for (const line of lines) process.stdout.write(`Missing: ${line}\n`);
  }
  if (count) throw new Error(`${count} capture(s) are missing from the merged run; each is listed in MISSING.txt in its artifact.`);
  process.stdout.write(`Merged ${plan.length} jobs into ${Object.values(roots).map((root) => relative(process.cwd(), root)).join(", ")}\n`);
}

function planCommand(options) {
  const plan = planShards(options);
  if (plan.length === 0) throw new Error(`Nothing to capture for --target ${options.targets.join(",")}${options.screens ? ` with --screens ${options.screens.join(",")}` : ""}.`);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === "capture") await capture(options);
    else if (options.command === "plan") planCommand(options);
    else if (options.command === "warm") await warm(options);
    else if (options.command === "merge") merge(options);
    else if (options.command === "boot") bootSimulator(options.targets[0]);
    else if (options.command === "driver") warmDriver(options.targets[0]);
    else if (options.command === "redact") redact(options.dir, ["E2E_ACCOUNT_EMAIL", "E2E_ACCOUNT_PASSWORD"].map((key) => process.env[key]?.trim()).filter(Boolean));
    else compare(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
