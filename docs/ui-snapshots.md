# UI snapshots

Android draws the iOS design (see `AGENTS.md` › Native UI). iOS uses the system components, so its screenshots are the reference. The capture runs on both platforms, and `compare` places each pair side by side: iOS on the left, Android on the right.

## Run in CI

Each platform has its own workflow, so you can retry one without waiting for the other. Both take the same inputs:

```bash
gh workflow run ui-snapshots-android.yml --ref <branch> [-f screens=catalog-rows,settings] [-f themes=light] [-f motion=false] [-f target=tablet] [-f orientations=landscape] [-f perf=3]
gh workflow run ui-snapshots-ios.yml --ref <branch> [-f scope=core|full] [same inputs]
```

The iOS run defaults to `scope=core` (see [Scopes](#scopes)). The Android run has no scope input and always captures the full list.

Once both runs succeed, download them and pair them locally. `compare` needs ImageMagick and ffmpeg:

```bash
gh run download <android-run-id> -n ui-snapshots-android -D dist/ui-snapshots/android
gh run download <ios-run-id> -n ui-snapshots-ios -D dist/ui-snapshots/ios
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

- `target` and `text_size` take comma lists (`target=phone,tablet`, `text_size=default,accessibility-large`). The iOS workflow has three stages. `prepare` builds or restores the simulator app and runs `scripts/ui-snapshots.mjs plan`, which cuts the work into capture jobs. Those jobs run in parallel, each on its own simulator, and the `merge` job combines them. `text_size` (iOS only) sets the simulator's Dynamic Type category for its cell: `default`, `extra-large` or `accessibility-large`. Blank (the default) takes the scope's own sizes. The capture logs the category it applied and returns the simulator to `large` (its default) afterwards. Android has no such input.
- `offline` (iOS, default `true`) skips sign-in and the Logto request, so the run needs no account. Offline covers every screen and both tablet orientations, with the split flow's layout checks and its new-Chat draft; only the send is dropped. A signed-in run (`offline=false`) renders the same screens from the account's own data and adds the send in `e2e/tablet/split-send.yaml`. The app stays in debug bundles only (`src/auth/e2e-session.ts`).
- The iOS reference runs on iOS 27, on GitHub's `xcode-27` image (a preview). Pass `-f ios=26` to `ui-snapshots-ios.yml` to capture on the default image's iOS 26 instead; the drawn Android UI follows iOS 27.
- `.github/workflows/ui-snapshots-android.yml` and `.github/workflows/ui-snapshots-ios.yml` build debug binaries and cache them by native fingerprint. The branch's JS is served from Metro, so a JS-only change reuses the cached binaries. A native change rebuilds them, which takes roughly 30 minutes on Android and 60 on iOS.
- Snapshots run without an account on seeded fixtures by default (`offline=true`). `offline=false` signs in through the login flow (`e2e/auth/`) with the `E2E_ACCOUNT_EMAIL` and `E2E_ACCOUNT_PASSWORD` secrets (a dev-tenant account), and the tenant's CAPTCHA blocks that step.
- The Android device E2E (`.github/workflows/e2e-android.yml`) is `disabled_manually`. It depends on the same page login, which the CAPTCHA keeps from running unattended, so do not re-enable it.
- Artifacts: `ui-snapshots-android` and `ui-snapshots-ios`, each holding `<theme>/<screen>.png` and `motion/<interaction>.mp4`. A non-default text size writes to a suffixed directory instead of overwriting the default: `<theme>-<size>/` on the phone and `tablet-<orientation>/<theme>-<size>/` on a tablet, so `light/` is the default size and `light-accessibility-large/` the large one. A tablet run uploads `ui-snapshots-android-tablet` and `ui-snapshots-ios-tablet` instead (see [Tablets](#tablets)).
- iOS shards. `ui-snapshots-ios.yml` uploads each capture job as `ui-snapshots-ios-<n>` (phone) or `ui-snapshots-ios-tablet-<n>` (tablet), and the `merge` job combines them into `ui-snapshots-ios` and `ui-snapshots-ios-tablet`, with the layout above. Each job's Maestro output and flow files are under `diagnostics/<job artifact>/` in the merged artifact. If a job failed, the merged artifact still holds the others, and `MISSING.txt` lists every capture it did not get, with the screens the job owned. The run fails.
- Capture jobs install nothing. `prepare` installs `node_modules` and Maestro and saves them under keys it reports (`node_modules` by lockfile, Maestro by `MAESTRO_VERSION`); each capture job restores them, and a miss fails the job. Each job's Node 22 comes from the runner's tool cache, and Bun from `setup-bun`.
- Metro is warmed once per run. `prepare` starts Metro, requests the app's first bundle (`scripts/ui-snapshots.mjs warm`) and saves Metro's transform cache under a key per run; every capture job restores that save, so its first bundle reads the transforms. Each job's log shows the first bundle line (`iOS Bundled <ms> … (<modules>)`).
- Orientation: a tablet flow turns the device before it launches the app (`setOrientation` ahead of `launchApp`), so a landscape job never relies on the state another flow left.
- Plan: `plan` cuts the scope's screens into jobs of at most 9.5 minutes of captures (`SHARD_CAPTURE_SECONDS`, from the per-screen times in `scripts/ui-snapshots.mjs`). A default-size job holds one orientation; a large-size job holds all of a target's orientations, since its screens are few. The split flows and the motion recordings are one or more jobs of their own (`--part flow`, `--part motion`), and `perf` is one job. With `scope=core`, light theme, offline and no motion, the plan is five jobs: phone default, phone composer at accessibility-large, tablet portrait, tablet landscape, and tablet composer at accessibility-large in both orientations. With `scope=full` the plan is five jobs too: phone 2, tablet portrait 1, tablet landscape 1 and split flows 1. GitHub runs five macOS jobs at once, so a sixth would queue behind them. A run with a single screen is one job.

## Scopes

`scope` picks the screens. `core` (the default, `--scope core` locally) is the budget: a run with `themes=light`, offline and no motion finishes in about 15 minutes from dispatch to the merged artifact. `full` (`scope=full`) is every screen in `SCREENS` and `TABLET_SCREENS`, at the sizes asked for, plus the tablet split flows. Run it on demand; it takes longer than the budget.

Core is the states that have regressed, listed in `CORE` in `scripts/ui-snapshots.mjs`:

| State | Phone | Tablet |
|---|---|---|
| Composer: empty, one-line draft, long draft | `chat-draft-empty`, `chat-draft`, `chat-draft-long` | `split-chat-draft-empty`, `split-chat-draft`, `split-chat-draft-long` |
| Composer at `accessibility-large` | the three above, at the large size | `split-chat-draft-long` at the large size |
| Unread divider, and the divider gone once read | `chat-unread`, `chat-unread-end` | |
| Delivered line | `chat-delivered` | |
| Send failure and retry | `chat-states` | |
| Reply arriving while the timeline is scrolled | `chat-arrival` | |
| Chats long list | `chats`, `chats-scrolled` | |
| A real Chat (markdown table and code block on the phone) | `chat-conversation`, `chat-real` | `split-chat-real` |
| Tablet split pane: Chat panel, Space, settings page, empty right pane | | `split-chat-panel`, `split-space`, `split-settings-page`, `split-empty` |

Core captures each of these in every requested theme, offline, and in both tablet orientations. The large-size jobs carry only the composer screens, so the default run adds two small jobs for them rather than doubling the list. The split flows (`e2e/tablet/split-layout.yaml` and its variants) are not in core; `scope=full` runs them.

To run the full list on iOS: `gh workflow run ui-snapshots-ios.yml --ref <branch> -f scope=full`. To run it at both sizes, add `-f text_size=default,accessibility-large`. `--screens` still overrides the scope's screens: it names them at each requested size.

## Run locally

Start a booted emulator or simulator first, then run:

```bash
node scripts/ui-snapshots.mjs capture --platform android --app <debug.apk>
node scripts/ui-snapshots.mjs capture --platform ios --app <Cohub.app|Cohub-ios-simulator.zip>
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

`--target phone,tablet` and `--text-size default,accessibility-large` take comma lists; every cell runs in the one process. `--offline` renders the debug fixtures without an account, as the workflow's `offline` input does. Use `--no-metro` when Metro is already running on port 8081. Android phone capture sets the emulator's density so that both platforms lay out at 402 pt wide. It resets the density when it finishes.

`--scope core|full` picks the screens as in CI (core by default). `--part screens|flow|motion|perf` runs one slice of a target's work, which is how a capture job runs. `node scripts/ui-snapshots.mjs plan ...` prints the jobs for a selection as JSON. `node scripts/ui-snapshots.mjs merge --plan plan.json --shards <dir>` combines downloaded job artifacts.

The iOS driver's start is retried on its own: a start that Maestro reports as not ready (`iOS driver not ready in time`) runs again without repeating any flow step. A start may take up to `MAESTRO_DRIVER_STARTUP_TIMEOUT` (300 s in CI, measured starts that came up took 35 to 285 s), and a silent one is killed a minute later. Before the capture, the job starts the driver once in the background (`node scripts/ui-snapshots.mjs driver`) while the dependencies restore, so the capture's first start usually finds it running; a warm-up that fails is logged and the capture starts the driver itself. Each attempt logs when the driver comes up or fails, and a start that fails for good quotes the driver's log lines and the device's state.

## Tablets

`target=tablet` (`--target tablet` locally) captures the split layout, in which the tab app is in the left pane and the open Chat or page is in the right one (`src/components/SplitStack.tsx`).

- Devices: iOS uses an iPad simulator from `IOS_DEVICES.tablet` (the iPad Air 11-inch is 820 × 1180 pt). Android uses the `pixel_tablet` AVD at its own density (800 × 1280 dp). Phone runs keep their fixed 402-wide density.
- Orientation: `orientations` (default `portrait,landscape`). Android turns from the host with `user_rotation`. iOS turns with Maestro's `setOrientation` at the start of each flow.
- Before each orientation, capture checks the device's logical size against `SIZE_BANDS`: Android measures it from `wm size` and `wm density`, and iOS reads it from the `IOS_DEVICES` table. Each flow then asserts that the app drew `split-right-pane`, so a run that falls back to the phone layout fails instead of producing screenshots.
- Output: `<target>-<orientation>/<theme>/<screen>.png` from `TABLET_SCREENS`. `compare` pairs these groups as `<screen>.<target>-<orientation>.<theme>.png`.
- Interaction flow: `e2e/tablet/split-layout.yaml` runs once in the light theme, unless `screens` limits the run. It covers the unread mark clearing when a Chat opens, the missing back button on the right pane's first screen, a draft surviving a rotation, a second Chat replacing the first, Android back emptying the pane, and the New Chat sheet. A variant then follows it: `split-offline.yaml` (no account) picks the seeded Finance Ops row by its testID and types a draft without sending; `split-send.yaml` (signed in) picks a Space by position and sends a real message from the test account. Its screenshots are in `tablet-flow/`.

`perf=<runs>` (`--perf <runs>`) runs `PERF_STEPS` that many times from fresh launches in portrait with the frame probe forced on (`EXPO_PUBLIC_FRAME_PROBE=1`). It then reads the probe's records from the app's `cohub-mobile.db` and writes them to `perf/<target>-portrait.json`, one entry per run with its time window. The probe records only UI frames over 25 ms and JS stalls over 50 ms, so a quiet run has no events. Compare a phone run with a tablet run on the same runner type.

## Fixtures

The account screens are never captured from a real account. `src/data/fixtures/` seeds them, and the provider in `src/data/context.tsx` starts from that seed instead of calling the API, so these screens show no loading, network or error state:

- `chats`, `chats-scrolled`, `split-chat-real`: 22 Chats over four Spaces, one of them a pinned Bot, unread on three rows, ages from 13 hours to ten days.
- `chat-real` and `split-chat-real`: one Chat with a tool-using Turn, a long reply and a short Bot reply.
- `spaces`, `spaces-scrolled`: four Spaces; the three without a description show their Chat counts.
- `activity`, `activity-scrolled`: a balance, no active subscription and a 13-week heatmap.
- `settings`, `settings-scrolled`: the profile card's name, email and avatar.

The seed is gated by `usesFixtures()` in `src/data/fixtures/index.ts`, which is `__DEV__ && uiSnapshots`. A release build has `__DEV__` false, so no fixture is ever read. A screen that needs data the seed does not hold gets it added to the seed, not a manual capture.

## Screens

The screen list is `SCREENS` in `scripts/ui-snapshots.mjs`, which maps each name to a deep link and optional taps. To capture a new screen, add an entry there.

`app/debug/ui.tsx` is the UI catalog, a page that shows every shared primitive. `?section=` limits it to one section so each fits in a single screenshot. When you add or restyle a shared component, add it to the catalog.

`app/debug/chat.tsx` renders the Chat screen's header, native timeline, and composer over fixed conversations (`?fixture=conversation|tools|long|states|media|stream|bot`, where `bot` is a Bot's page), so the Chat layout can be compared without an account's data. `&native=0` draws the JS list that binaries without the native timeline fall back to; only that list shows the `stream` fixture's reply in progress. `&draft=<text>` seeds the composer, as a Chat's saved draft does (the `chat-draft` screen). `chat-draft-long` seeds a draft of about four wrapped lines at 402 pt, and `split-chat-draft-long` one of about six at 820 pt, for the composer's two-row layout. `&arrive=<n>` appends n replies two seconds after the screen opens, as a reply landing while the user reads up; the `chat-arrival` screen waits for them (an accessible `arrivals <n>` label) before it scrolls. The `chat-scrolled`, `chat-arrival`, `chat-keyboard` and `chat-keyboard-drag` screens cover the jump to latest and the keyboard. `app/debug/bot-list.tsx` renders the Bots view's rows over fixed Bots.

## Recordings

After the screenshots, each platform records the interactions in `MOTIONS` (`scripts/ui-snapshots.mjs`) in the light theme: tab switches, a push and back, controls, a menu, a sheet, and a confirmation. Android turns its animation scales back on for this pass. `compare` stacks each pair into one 30 fps video with ffmpeg. To record a new interaction, add an entry to `MOTIONS`. Use `?open=0` on the catalog's `sheet` and `confirm` sections so a recording starts from the closed state.

## Limits

Recordings show timing and shape. They do not show gesture feel or haptics, and blur fidelity is unreliable because the CI emulator has no GPU. Check those on a device.
