# Cohub Mobile

[![CI](https://github.com/markbang/cohub-mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/markbang/cohub-mobile/actions/workflows/ci.yml)
[![Security](https://github.com/markbang/cohub-mobile/actions/workflows/security.yml/badge.svg)](https://github.com/markbang/cohub-mobile/actions/workflows/security.yml)
[![Release](https://github.com/markbang/cohub-mobile/actions/workflows/release-please.yml/badge.svg)](https://github.com/markbang/cohub-mobile/actions/workflows/release-please.yml)

A native iOS and Android client for Cohub, built with React Native and Expo.

<p align="center">
  <img src="landing/screenshots/chats.png" width="28%" alt="Chats inbox" />
  &nbsp;&nbsp;
  <img src="landing/screenshots/spaces.png" width="28%" alt="Spaces list" />
  &nbsp;&nbsp;
  <img src="landing/screenshots/settings.png" width="28%" alt="Settings" />
</p>

## Download

| Platform | Link |
|----------|------|
| **Android** | [Download APK](https://cohub.live/bangwu/cohub-mobile/w/download) · [all builds](https://github.com/markbang/cohub-mobile/releases) |
| **iOS** | [Join the TestFlight beta](https://testflight.apple.com/join/KWhztpkP) |

Android builds are published per ABI to the Yaota distribution origin, which is what the in-app updater reads. The [download page](https://cohub.live/bangwu/cohub-mobile/w/download) resolves the newest `arm64-v8a` build, and falls back to GitHub Releases if the catalog is unreachable.

iOS ships through TestFlight while the app is in beta. Install the Apple TestFlight app first, then open the invite link above.

## Included

The app uses native screens for Chats, Spaces, Activity, Profile, session timelines, files, and settings. Published HTML/Work previews are opened in a constrained WebView because their content is inherently web-based.

- Native Chats inbox with paginated cross-Space selection, search, running/attention filters, optimistic sends, stop, rename, attachments, camera, photo library, and live Cohub stream patches
- Turn-based Chat history with older/newer pagination, searchable turn navigation, direct window jumps, and stable scroll position
- Model picker with availability lights, provider/context metadata, and per-model thinking levels
- Native PCM voice input connected to Cohub ASR
- Spaces with Chats, Files, Saves, Works, and Task Runs
- Native file viewer plus constrained WebView for published Works
- Activity and usage overview
- Native Settings sections for Profile, Appearance, Activity, Notifications, Rules, Channels, Billing, and Referrals
- Cache-first SQLite hydration, reconnect reconciliation, and user-scoped cache clearing
- Android device Runtime: create a Space on this device or connect an existing one, so agents work directly in a phone folder (Android 11+, 64-bit; asks for All files access)
- Android screen sharing: share this phone's screen with a Space it serves so people can watch and steer it from the web and agents can use it; control needs Cohub enabled in Accessibility
- Native Logto PKCE, `cohub://` deep links, notification tap routing, APNs/FCM token acquisition, and GitHub-native build profiles

## Deployment endpoints

The login screen can select production or development and remembers the choice. `EXPO_PUBLIC_COHUB_ENV`
sets the build-time default; optional endpoint overrides are documented in `.env.example`.

| Environment | API | Gateway |
|-------------|-----|---------|
| Production | `https://capi.neta.art` | `wss://cgateway.neta.art/ws` |
| Development | `https://capi-dev.neta.art` | `wss://cgateway-dev.neta.art/ws` |

These accelerated origins serve the same deployments. Authentication endpoints, Logto App IDs, the
OAuth resource identifier (`https://api.talesofai`), and public/deep-link origins are unchanged.

## Android device Runtime policy

The Android module owns system services, permissions, and their required notifications. Product policy
is set through `src/platform/device-runtime.ts`, not hardcoded into service lifecycle callbacks.

- `setDeviceControlKeepAliveEnabled(boolean)` persists and applies optional foreground keep-alive
  while Accessibility is enabled and no Space is connected. `isDeviceControlKeepAliveEnabled()` reads
  the current native value. Both require a supported Android device Runtime.
- JS startup currently sets this policy to `false`, including before sign-in. Native defaults to
  `false` and retains the last configured value across process restarts, so Accessibility can start
  without JS. This is device-wide policy, not account data; sign-out does not change it.
- Disabling it leaves Accessibility enabled and removes the idle foreground notification. Connected
  Spaces and screen sharing still keep their required foreground service and notification. Optional
  keep-alive improves process priority but cannot guarantee survival on every Android ROM.
- After installing a native build containing this interface, changing the JS startup value or wiring
  these methods to a setting can ship through a compatible OTA. The value changes when that JS runs;
  downloading an OTA alone does not update native preferences. New permissions, system capabilities,
  dependencies, and native implementation fixes still require a new APK.

## Config Space colors

The mobile app follows the signed-in user's global Config Space, resolved with the SDK's
`spaces.getOwnedBySlug("config")`. Its `.cohub/theme.css` overrides the existing mobile palette across
screens; it does not use the currently open Space or hardcode a Space ID. Settings > Appearance has
an enable switch, a refresh action, and load/error/partial-support states. Custom colors take
precedence over pure-black surfaces; switching custom colors off restores the native palette.

Supported root selectors are `:root`, `html`, `*`, `[data-theme]`, and `[data-theme="light"/"dark"]`,
including compound selectors and `:where()`, `:is()`, and `:not()` over those selectors. Source order,
specificity, `!important`, and `prefers-color-scheme` media queries are respected (the queries use the
app's selected light/dark mode). The supported
colors include hex, named colors, RGB/HSL/HWB, Lab/LCH/OKLab/OKLCH, CSS `color()` spaces,
`light-dark()`, nested `var()` with defaults, and `color-mix()` with transparency and hue interpolation.
Colors are converted to native sRGB. CSS neutral/brand scales feed their semantic roles; references
to unchanged base variables use the mobile palette rather than reproducing a web preset exactly.

Mapped tokens cover `--bg-primary`, `--bg-content`, `--bg-surface`, `--bg-elevated`, `--bg-active`,
`--text-primary/secondary/tertiary/placeholder`, borders, `--brand` and its states/contrast,
`--success/warning/error/info-*`, `--error-fg`, overlay-control color, shadow color, and
`--chat-user-message-bg/fg` / `--chat-assistant-message-bg/fg`. Mobile also recognizes
`--chat-user-message-link`, `--chat-user-message-code-bg`, and `--chat-user-message-meta`.
Dependent bubble and status colors update when their shared semantic colors change.

CSS layout, component selectors, fonts, arbitrary at-rules, imports, URLs as colors, `calc()`,
relative color expressions, and non-color styling are not executed. Unsupported mapped colors
keep their native values and produce a warning; invalid stylesheets keep the last valid theme.
Files are limited to 256 KiB. Inline UTF-8/base64 and SDK-provided HTTPS download delivery are
supported without forwarding credentials. The user-scoped SQLite cache renders first and the
server reconciles it; foreground/reconnect, watched Config file events, and periodic foreground
refreshes revalidate it. File deletion or access rejection removes cached colors. Sign-out/account
changes dispose the old reader, clear its cache, and prevent late results from applying.

This is JS-only behavior, including its two runtime dependencies (`css-tree` and `culori`); no new
native module or permissions are required. OTA publication must still pass the repository's native
fingerprint compatibility check.

## Thanks

[Cohub](https://github.com/talesofai/cohub)
