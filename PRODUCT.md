# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

People who already use Cohub on the web and carry it in their pocket. They open the app in short, often one-handed bursts to:

1. Check what their agents are doing: which Chats are running, finished, or failed.
2. Reply to or steer a Chat.
3. Look something up in a Space: a file, a Work, a task result.
4. Watch spend: credits and activity.

## Product Purpose

Cohub Mobile is the native iOS and Android client for Cohub, a space where people and agents create and build together. It brings Chats, Spaces, Activity, and Settings to the phone so work with agents continues away from the desk. Success means the four jobs above take seconds, not a trip back to the web app.

## Positioning

The native mobile client of Cohub, listed as the official app by upstream Cohub and maintained in `markbang/cohub-mobile`. Beyond the web app it offers native screens, push notifications, and native voice input. On Android, the phone itself can run a Space as a device Runtime and share its screen so people and agents can watch and steer it.

## Operating Context

- Used alongside the Cohub web app; the web app is the source of truth for product terminology and zh copy.
- Content comes from the user's Spaces: Chats with agents, files, Saves, Works, task runs, and schedules.
- Published Works open in a constrained WebView; everything else is a native screen.
- Distribution: iOS through TestFlight (beta), Android as APKs; JS updates ship over OTA.

## Capabilities and Constraints

- Platforms: iOS and Android only, no web target. Portrait only; `supportsTablet` is enabled, but iPad-specific layout is not a stated requirement (undecided).
- Design language: Apple HIG on both platforms. iOS uses system components and SF Symbols. Android draws the same iOS design with Lucide icons and the system font, because SF Symbols and SF Pro are licensed for Apple platforms only.
- Themes: light, dark, and pure black, plus eight accent presets (`src/design/accents.ts`) that replace only the accent and own-message bubble tokens.
- Languages: English and Simplified Chinese. zh uses 对话 for every Chat concept and 积分 for credits, matching the web app; 聊天 is reserved for messaging channels.
- Product nouns stay capitalized: Chat, Space, File, Work, Save, Agent.
- Android-only: device Runtime (Android 11+, 64-bit) and screen sharing.
- Data is cache-first with server-authoritative reconciliation; caches are scoped to the signed-in user.
- Native changes block OTA until a new binary ships; JS-only changes can ship over OTA.

## Brand Commitments

- Name: Cohub. App icon and mascot: `landing/icon.png`, `landing/mascot.png`.
- UI copy is concise, sentence case, and verb-first for actions; errors are one sentence saying what happened and what to do.

## Evidence on Hand

- Screenshots: `landing/screenshots/`.
- Product landing and download page: `landing/`.
- No testimonials, metrics, or press are on hand; do not fabricate them.

## Product Principles

1. Scanning beats decoration on lists: state and recency must read at a glance.
2. Reading comfort comes first in the Chat thread.
3. Native expectations win; follow the platform before inventing patterns.
4. Never show stale or fake data as current: cached data speeds things up but never overrides newer server state.

## Accessibility & Inclusion

- VoiceOver and TalkBack labels on every control, including icon-only actions.
- Usable from the smallest to the extra-large font scale.
- Respect Reduce Motion and Reduce Transparency.
- Touch targets of at least 44 pt.
- State is never conveyed by color alone.
