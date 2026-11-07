# UI snapshots

Android draws the iOS design (see `AGENTS.md` › Native UI). iOS uses the system components, so its screenshots are the reference. The capture runs on both platforms, and `compare` places each pair side by side: iOS on the left, Android on the right.

## Run in CI

Each platform has its own workflow, so you can retry one without waiting for the other. Both take the same inputs:

```bash
gh workflow run ui-snapshots-android.yml --ref <branch> [-f screens=catalog-rows,settings] [-f themes=light] [-f motion=false] [-f target=tablet] [-f orientations=landscape] [-f perf=3]
gh workflow run ui-snapshots-ios.yml --ref <branch> [same inputs]
```

Once both runs succeed, download them and pair them locally. `compare` needs ImageMagick and ffmpeg:

```bash
gh run download <android-run-id> -n ui-snapshots-android -D dist/ui-snapshots/android
gh run download <ios-run-id> -n ui-snapshots-ios -D dist/ui-snapshots/ios
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

- The iOS reference runs on iOS 27, on GitHub's `xcode-27` image (a preview). Pass `-f ios=26` to `ui-snapshots-ios.yml` to capture on the default image's iOS 26 instead; the drawn Android UI follows iOS 27.
- `.github/workflows/ui-snapshots-android.yml` and `.github/workflows/ui-snapshots-ios.yml` build debug binaries and cache them by native fingerprint. The branch's JS is served from Metro, so a JS-only change reuses the cached binaries. A native change rebuilds them, which takes roughly 30 minutes on Android and 60 on iOS.
- Both workflows need the `E2E_ACCOUNT_EMAIL` and `E2E_ACCOUNT_PASSWORD` secrets (a dev-tenant account), because every route sits behind sign-in.
- Artifacts: `ui-snapshots-android` and `ui-snapshots-ios`, each holding `<theme>/<screen>.png` and `motion/<interaction>.mp4`. A tablet run uploads `ui-snapshots-android-tablet` and `ui-snapshots-ios-tablet` instead (see [Tablets](#tablets)).

## Run locally

Start a booted emulator or simulator first, then run:

```bash
node scripts/ui-snapshots.mjs capture --platform android --app <debug.apk>
node scripts/ui-snapshots.mjs capture --platform ios --app <Cohub.app|Cohub-ios-simulator.zip>
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

Use `--no-metro` when Metro is already running on port 8081. Android phone capture sets the emulator's density so that both platforms lay out at 402 pt wide. It resets the density when it finishes.

## Tablets

`target=tablet` (`--target tablet` locally) captures the split layout, in which the tab app is in the left pane and the open Chat or page is in the right one (`src/components/SplitStack.tsx`).

- Devices: iOS uses an iPad simulator from `IOS_DEVICES.tablet` (the iPad Air 11-inch is 820 × 1180 pt). Android uses the `pixel_tablet` AVD at its own density (800 × 1280 dp). Phone runs keep their fixed 402-wide density.
- Orientation: `orientations` (default `portrait,landscape`). Android turns from the host with `user_rotation`. iOS turns with Maestro's `setOrientation` at the start of each flow.
- Before each orientation, capture checks the device's logical size against `SIZE_BANDS`: Android measures it from `wm size` and `wm density`, and iOS reads it from the `IOS_DEVICES` table. Each flow then asserts that the app drew `split-right-pane`, so a run that falls back to the phone layout fails instead of producing screenshots.
- Output: `<target>-<orientation>/<theme>/<screen>.png` from `TABLET_SCREENS`. `compare` pairs these groups as `<screen>.<target>-<orientation>.<theme>.png`.
- Interaction flow: `e2e/tablet/split.yaml` runs once in the light theme. It covers the unread mark clearing when a Chat opens, the missing back button on the right pane's first screen, a draft surviving a rotation, a second Chat replacing the first, Android back emptying the pane, and New Chat taking over the right pane. Its screenshots are in `tablet-flow/`. The New Chat step sends a real message from the test account.

`perf=<runs>` (`--perf <runs>`) runs `PERF_STEPS` that many times from fresh launches in portrait with the frame probe forced on (`EXPO_PUBLIC_FRAME_PROBE=1`). It then reads the probe's records from the app's `cohub-mobile.db` and writes them to `perf/<target>-portrait.json`, one entry per run with its time window. The probe records only UI frames over 25 ms and JS stalls over 50 ms, so a quiet run has no events. Compare a phone run with a tablet run on the same runner type.

## Screens

The screen list is `SCREENS` in `scripts/ui-snapshots.mjs`, which maps each name to a deep link and optional taps. To capture a new screen, add an entry there.

`app/debug/ui.tsx` is the UI catalog, a page that shows every shared primitive. `?section=` limits it to one section so each fits in a single screenshot. When you add or restyle a shared component, add it to the catalog.

`app/debug/chat.tsx` renders the Chat screen's header, native timeline, and composer over fixed conversations (`?fixture=conversation|tools|long|states`), so the Chat layout can be compared without an account's data.

## Recordings

After the screenshots, each platform records the interactions in `MOTIONS` (`scripts/ui-snapshots.mjs`) in the light theme: tab switches, a push and back, controls, a menu, a sheet, and a confirmation. Android turns its animation scales back on for this pass. `compare` stacks each pair into one 30 fps video with ffmpeg. To record a new interaction, add an entry to `MOTIONS`. Use `?open=0` on the catalog's `sheet` and `confirm` sections so a recording starts from the closed state.

## Limits

Recordings show timing and shape. They do not show gesture feel or haptics, and blur fidelity is unreliable because the CI emulator has no GPU. Check those on a device.
