---
name: native-modules
description: Design native code so later behavior changes ship over OTA. Use when adding or changing a native module, Kotlin or Swift code, a config plugin, a `scripts/patch-*.mjs` dependency patch, or a native dependency.
---

# Native modules

OTA ships JavaScript only. Any change to a native input changes the Expo native fingerprint, and Publish OTA then skips that platform until users install a new APK or TestFlight build (`docs/releasing.md`). Every native edit is therefore a release for every user, and every JS-only fix queued behind it waits too. Make each native change **complete**: build the native layer once, so later product changes are JS changes.

The design rule is **mechanism in native, policy in JS**. Native code owns what only the platform can do; JS owns every decision about when, how much, and what the user sees.

## Native inputs in this repo

- `modules/*/android`, `modules/*/ios`: local Expo modules. `modules/cohub-device-runtime` uses the Expo Modules API (`expo-module.config.json`, `NativeModule` typed in `index.ts`), and app code reaches it only through `src/platform/device-runtime.ts`. Follow that module's pattern for new local modules.
- `modules/*/app.plugin.js` and native fields in `app.config.ts`: config plugins and native config.
- `scripts/patch-*.mjs`, run by `postinstall`: these write into a dependency's native sources under `node_modules`. They live in `scripts/` but count as native. The fingerprint hashes the whole patched package for both platforms, so even a comment edit in the generated Kotlin stops Android and iOS OTA.
- Native dependencies and their versions in `package.json` / `package-lock.json`.

## Steps

1. **Confirm native is required.** Check whether JS, an installed library, or an existing module method already covers the behavior. Done when the change names the platform capability JS cannot reach.
2. **Write the typed spec first.** The spec is the contract JS will live with until the next native release: the `declare class ... extends NativeModule` block for an Expo module, or a codegen spec as in React Native's [Turbo Native Modules guide](https://reactnative.dev/docs/turbo-native-modules-introduction). Design it against the checklist below before writing platform code.
3. **Make it complete.** Before finishing, list the follow-ups a product iteration will plausibly ask for (the other platform, a neighbouring parameter, a state you observe but do not report, an error case) and fold in each one native would otherwise have to be rebuilt for. Done when every tunable in the change is a JS argument and every state native observes is queryable or emitted.
4. **Measure the fingerprint** (below). Done when the hash changes exactly when you intended a native change.
5. **Hand off the release.** Say in the commit body and to the user that the change requires a native release, then follow `docs/releasing.md`. JS-only follow-ups reach users only after they install that build.

## Completeness checklist

- **Primitives, not screens.** Expose capabilities and raw state; JS composes them per screen, formats them, and writes the copy.
- **Tunables as arguments.** Thresholds, timeouts, intervals, limits, and on/off switches are parameters or option-object fields with defaults in JS, as with `setControlKeepAliveEnabled(enabled)` and `configure(account, gatewayOrigin)`, never constants compiled into native.
- **Options objects for growth.** Pass an options object where a method may gain inputs, so the next field is additive.
- **Observable state.** Emit an event for each lifecycle transition native sees and offer a synchronous read of current state, so JS can change its reaction without new native code.
- **Stable error codes.** Reject with codes such as `ERR_FOLDER_UNAVAILABLE`; JS maps codes to localized copy and recovery.
- **General rules in patches.** A dependency patch cannot easily take new props, so encode the platform-general rule rather than one tuned to today's JS. Example: `NestedHorizontalScrollView` claims a drag only once it has a direction and only while the view can scroll that way. Its first version claimed on touch down, which suited the old pager and broke when JS moved the panel swipe to gesture-handler, forcing a native release.

The fingerprint pins each OTA to a matching binary, so JS always runs against the native code it was built with. Version negotiation between JS and older binaries is unnecessary.

## Measuring the fingerprint

Absolute hashes depend on the local environment (a generated `android/` directory, build output inside `node_modules`) and do not match CI. Compare commits in one clean checkout instead:

```bash
base=$(git describe --tags --abbrev=0)    # latest release
git worktree add /tmp/fingerprint "$base" && cd /tmp/fingerprint && npm ci
fp() { git checkout -q "$1" && npm run postinstall --silent >/dev/null && npx @expo/fingerprint fingerprint:generate --platform "$2" 2>/dev/null | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>console.log(JSON.parse(r).hash))'; }
for platform in android ios; do echo "$platform $(fp "$base" "$platform") $(fp <commit> "$platform")"; done
```

Rerun `postinstall` after each checkout, because patches apply only on install. Equal hashes mean the commit can ship over OTA. Remove the worktree with `git worktree remove /tmp/fingerprint` when done.
