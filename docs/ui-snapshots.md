# UI snapshots

Android draws the iOS design (see `AGENTS.md` › Native UI). iOS uses the system components, so its screenshots are the reference. This workflow captures the same screens on both platforms and places each pair side by side: iOS on the left, Android on the right.

## Run in CI

```bash
gh workflow run ui-snapshots.yml --ref <branch> [-f screens=catalog-rows,settings] [-f themes=light]
gh run download <run-id> -n ui-snapshots-pairs -D dist/ui-snapshots/pairs
```

- `.github/workflows/ui-snapshots.yml` builds debug binaries and caches them by native fingerprint. The branch's JS is served from Metro, so a JS-only change reuses the cached binaries. A native change rebuilds them, which takes roughly 30 minutes on Android and 60 on iOS.
- The workflow needs the `E2E_ACCOUNT_EMAIL` and `E2E_ACCOUNT_PASSWORD` secrets (a dev-tenant account), because every route sits behind sign-in.
- Artifacts:
  - `ui-snapshots-pairs`: `<screen>.<theme>.png`
  - `ui-snapshots-ios` and `ui-snapshots-android`: the raw captures

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

## Limits

These are still screenshots. They do not show motion, gesture feel, haptics, or blur fidelity, because the CI emulator has no GPU. Check those on a device.
