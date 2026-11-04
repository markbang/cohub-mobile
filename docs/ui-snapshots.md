# UI snapshots

Android draws the iOS design (see `AGENTS.md` › Native UI). iOS uses the system components, so its screenshots are the reference. The capture runs on both platforms, and `compare` places each pair side by side: iOS on the left, Android on the right.

## Run in CI

Each platform has its own workflow, so you can retry one without waiting for the other. Both take the same inputs:

```bash
gh workflow run ui-snapshots-android.yml --ref <branch> [-f screens=catalog-rows,settings] [-f themes=light] [-f motion=false]
gh workflow run ui-snapshots-ios.yml --ref <branch> [same inputs]
```

Once both runs succeed, download them and pair them locally. `compare` needs ImageMagick and ffmpeg:

```bash
gh run download <android-run-id> -n ui-snapshots-android -D dist/ui-snapshots/android
gh run download <ios-run-id> -n ui-snapshots-ios -D dist/ui-snapshots/ios
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

- `.github/workflows/ui-snapshots-android.yml` and `.github/workflows/ui-snapshots-ios.yml` build debug binaries and cache them by native fingerprint. The branch's JS is served from Metro, so a JS-only change reuses the cached binaries. A native change rebuilds them, which takes roughly 30 minutes on Android and 60 on iOS.
- Both workflows need the `E2E_ACCOUNT_EMAIL` and `E2E_ACCOUNT_PASSWORD` secrets (a dev-tenant account), because every route sits behind sign-in.
- Artifacts: `ui-snapshots-android` and `ui-snapshots-ios`, each holding `<theme>/<screen>.png` and `motion/<interaction>.mp4`

## Run locally

Start a booted emulator or simulator first, then run:

```bash
node scripts/ui-snapshots.mjs capture --platform android --app <debug.apk>
node scripts/ui-snapshots.mjs capture --platform ios --app <Cohub.app|Cohub-ios-simulator.zip>
node scripts/ui-snapshots.mjs compare --ios dist/ui-snapshots/ios --android dist/ui-snapshots/android
```

Use `--no-metro` when Metro is already running on port 8081. Android capture sets the emulator's density so that both platforms lay out at 393 pt wide. It resets the density when it finishes.

## Screens

The screen list is `SCREENS` in `scripts/ui-snapshots.mjs`, which maps each name to a deep link and optional taps. To capture a new screen, add an entry there.

`app/debug/ui.tsx` is the UI catalog, a page that shows every shared primitive. `?section=` limits it to one section so each fits in a single screenshot. When you add or restyle a shared component, add it to the catalog.

## Recordings

After the screenshots, each platform records the interactions in `MOTIONS` (`scripts/ui-snapshots.mjs`) in the light theme: tab switches, a push and back, controls, a menu, a sheet, and a confirmation. Android turns its animation scales back on for this pass. `compare` stacks each pair into one 30 fps video with ffmpeg. To record a new interaction, add an entry to `MOTIONS`. Use `?open=0` on the catalog's `sheet` and `confirm` sections so a recording starts from the closed state.

## Limits

Recordings show timing and shape. They do not show gesture feel or haptics, and blur fidelity is unreliable because the CI emulator has no GPU. Check those on a device.
