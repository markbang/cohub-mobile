# Cohub Mobile Design System

The rules every screen follows, and the plan for moving the app onto them. Tokens live in
`src/design/tokens.ts`; `global.css` is generated from them (`node --no-warnings --experimental-strip-types scripts/design-tokens.mjs`). Styling
uses Uniwind `className` utilities; `useAppTheme()` remains only for values that native props
need as JS (icon colors, Reanimated, `RefreshControl`, `placeholderTextColor`, gradients).

## 1. Who and what the UI serves

Cohub Mobile is the pocket companion to the web app. People open it to:

1. **Check what their agents are doing**: which Chats are running, finished, or failed.
2. **Reply or steer** a Chat, often one-handed and in short bursts.
3. **Look something up in a Space**: a file, a Work, a task result.
4. **Watch spend**: credits and activity.

Every layout decision is judged against these jobs. The list screens are for scanning, so they
optimize for *how many rows fit and how fast state reads*. The Chat thread is for reading, so it
optimizes for *text comfort*. Settings are rare, so they optimize for *clarity*.

## 2. Principles

### 2.1 Content speaks in words, chrome speaks in icons

| Element | Form | Rule |
| --- | --- | --- |
| Toolbar and header actions | Icon only | 44 pt target, `accessibilityLabel` always set. |
| Row actions (pin, more, retry) | Icon only, or moved to long-press | Pin/unpin moves to the row's long-press menu; it no longer occupies every row. |
| State (running, failed, stopped, active) | Glyph + color | Never a word-only pill in lists. Shape differs per state so color is never the only signal. The default state (completed, idle) shows nothing. |
| Counts | Icon + tabular number | `💬 12` (messages icon + 12), not "12 chats". |
| Time | Compact relative | `3m`, `2h`, `Mon`, `Oct 3`. Never "Active 3 minutes ago". |
| Primary action in a sheet or empty state | Verb label (+ icon) | Text stays where the action is the point of the screen. |
| Destructive confirmation | Verb label | "Sign out", "Delete". Never icon-only. |
| Navigation tabs | Icon + label | Tabs name destinations, so they always keep their words (platform convention). The selected tab shows an accent capsule. |

An icon is allowed to replace text only when it is in the **icon dictionary** (§6). Anything
else keeps its words. Icon-only controls get a long-press hint in a later phase if usage shows
confusion; the accessibility label is mandatory from day one.

### 2.2 Density: two lines per row, one idea per line

- List rows have **at most two text lines**: line 1 = identity (title + time), line 2 = context
  (preview or description). Extra facts become glyphs on the avatar or inline icons, not a
  third line.
- Row heights: **72 pt** for content lists (46 pt avatar, 12 pt vertical padding, 4 pt between the lines), **52 pt** for settings rows, **56 pt**
  minimum for anything with a 44 pt control.
- Separators are hairlines **inset to the text column** (iOS list style), never full width
  inside a list.
- No chevrons in content lists: a tappable row with an avatar already reads as navigable.
  Chevrons stay only in grouped settings lists, where rows drill into another settings page.
- Screen edge padding is 16. Section gap 24. Row internal gap 12. Everything is on the 4 pt grid
  (`p-4` = 16).

### 2.3 UI language

- **Sentence case** everywhere, except product nouns, which are names and stay capitalized: Chat, Space, File, Work, Save, Agent ("New Chat", "Recent Saves", but "Recent activity", "Web app"). No trailing periods on labels.
- **Verb first** for actions; **noun** for places.
- Errors are one sentence: what happened, then what to do ("Couldn't load files. Pull to retry.").
  No "Please", no exclamation marks, no blame.
- **One label per intent.** The glossary is fixed:

| Concept | English | 中文 | Never |
| --- | --- | --- | --- |
| A conversation with agents | Chat | 对话 | session, conversation, 聊天会话 |
| A workspace | Space | 空间 | project, workspace |
| A published app | Work | 作品 | app (in UI copy) |
| A snapshot of a Space | Save | 存档 | version, checkpoint |
| A background job | Task | 任务 | job, run |
| Money balance | Credits | 积分 | balance, funds, 额度 |

The zh copy uses 对话 for every Chat concept (the source of truth is the web app's `zh-CN.json`, which uses 对话). 聊天 is reserved for messaging channels. Credits are 积分, matching the web app; the mobile copy pass already follows both.

### 2.4 Visual system

- **One accent** (the existing orange). It marks primary action, selection, and running state.
  Nothing else gets a new hue.
- **Flat content, floating chrome.** Only the tab bar, menus, toasts, and banners use
  `shadow-float`. Cards are separated by surface color, not shadow.
- **Shape rule**: tags `rounded-xs` (6), controls `rounded-sm` (10), cards/menus/bubbles
  `rounded-md` (14), sheets and the composer `rounded-lg` (20), capsules `rounded-full`. Pair
  every rounded rectangle with `borderCurve: "continuous"` where the platform supports it.
- **Type ramp** (size/line height; `caption` defaults to 500 and `micro` to 600 so small text stays legible, and a `font-*` class overrides either):

| Token | Size | Use |
| --- | --- | --- |
| `text-display` | 28/34 | One figure per screen (credits balance) |
| `text-title` | 20/26 | Sheet titles, Space name on its home |
| `text-headline` | 17/22 | Navigation bar titles |
| `text-body` | 15/22 | Row titles, settings rows, form text |
| `text-chat` | 15/23 | Message text |
| `text-subhead` | 13/18 | Row second line, descriptions |
| `text-caption` | 12/16 | Time, meta, section headers |
| `text-micro` | 11/14 | Badges, counts. Nothing smaller exists. |
| `text-code` | 12/19 | Monospace |

Weights: 400 body, 500 captions, 600 titles, emphasis, and micro labels, 700 display only. Numbers that count or change use
`tabular-nums`.

- **Colors** keep their existing values; only names change for `className`:
  `text-fg`, `text-fg-secondary`, `text-fg-muted`, `text-fg-faint`, `bg-background`,
  `bg-surface`, `bg-surface-raised`, `bg-surface-pressed`, `border-border`, `bg-accent`,
  `text-on-accent`, `bg-accent-soft`, `text-success|warning|danger|info` and their `-soft`
  backgrounds. Tailwind's default palette is removed: a class like `bg-red-500` does nothing.
- **Runtime theming** stays: pure black, the Config Space `theme.css`, and the font scale
  preference all flow through `useUniwindThemeSync()` into the same CSS variables, so className
  styling and JS colors can never disagree.

### 2.5 Motion

Unchanged (`src/motion.ts`). Rows use background highlight on press (`active:bg-surface-pressed`),
not scale and not a haptic (a touch that starts a scroll begins on a row); buttons and cards keep `PressableScale`. Tabs never slide.

## 3. Components

Shared primitives keep their current names and props so screens migrate without API churn.

| Component | Change |
| --- | --- |
| `AppIcon` | Adds `tone` (`fg`, `muted`, `faint`, `accent`, `success`, `warning`, `danger`) so callers stop passing hex. |
| `IconButton` | Numeric `size` for the visual circle (icon at half of it); the touch target never drops below 44 pt. Tones `default`, `accent`, `danger`. |
| `PrimaryButton` | Adds `variant: "primary" | "secondary" | "ghost" | "danger"`. |
| `ListRow` (new) | 72 pt. Leading slot, title, trailing meta, second line, trailing accessory, inset separator. Backs Chat, Space, search, and resource rows. `Meta` and `Tag` sit beside it in `src/ui/ListRow.tsx`. |
| `AvatarStatus` (new) | Replaces `StatusPill` in lists: a Chat that is running = accent ring around the avatar, failed = `alert` badge, stopped = `stop` badge. A Space whose runtime is up keeps the small green dot on `Avatar` (`online`). `StatusPill` stays for detail headers only. |
| `Meta` (new) | Icon + tabular value, e.g. chats count, step count, duration. |
| `SectionHeader` | Sentence case `text-caption font-semibold text-fg-muted`, no uppercase eyebrow. |
| `SettingsGroup`/`SettingsRow` | 52 pt rows, inset separators, `rounded-md` group. |
| `EmptyState`, `DataError`, `LoadingRows` | Skeleton matches the 72 pt `ListRow`; errors use an icon retry button. |
| `TopBar`, `EdgeHeader` | Title `text-headline font-semibold`. |
| `FloatingTabBar` | Icon + label, 58 pt, content-width capsule, `shadow-float`. |

## 4. Screens

### Tab bar
Floating bar with icon above a short label (messages, layers, activity); the selected tab is accent on an
`accent-soft` capsule. The bar hugs its three 80 pt slots instead of spanning the screen. Height 58.

### Chats
- Header: account avatar · "Chats" · search · new chat (unchanged structure).
- Filters: one compact segmented row: **All · Running (count) · Done**, plus the source filter
  icon. The "Done" window moves into the chip as a suffix (`Done · 24h`) instead of a caption line.
- Row (`ListRow`, 72 pt): Space avatar 46 with `AvatarStatus`; line 1 = title (fork icon prefix
  when forked) + time; line 2 = `Space name · preview` in `text-subhead`. The separate
  "Forked from…" line and the "Running" pill are removed; labels collapse to at most two
  `rounded-xs` tags at the end of line 2.
- Result: rows settle at 72 pt instead of 76–110 pt. The gain comes from dropping lines, not from tighter spacing; density never trades away comfortable padding.

### Spaces
- Filters unchanged (Recent · All · Pinned · This device); pinned Spaces carry a pin glyph before the name in every filter.
- Row (72 pt): avatar 46 with the runtime dot when the Space is running; line 1 = name + last activity time; line 2 =
  description, or `💬 count` when there is none. "Active" pill, "Active 3m ago" line, chevron,
  and the always-visible pin button are removed. Pin/unpin is in the long-press menu.

### Activity
- Credits as one `text-display` tabular figure with a credits icon, tapping into billing.
- Subscription as one row (plan name + status glyph).
- Usage and referrals as two icon tiles instead of text links.
- Heatmap unchanged.

### Settings home
- Profile as a 72 pt row (avatar 48, name, email, chevron) instead of a centered 84 pt hero.
- Groups unchanged in content; rows to 52 pt with inset separators.
- Sign out remains a text button (destructive). The version line shows the OTA channel when
  it is not production.

### Space home
- Header: avatar 56, name `text-title`, description `text-subhead` (3 lines max).
- Stats as one row of `Meta` items (chats, works, saves, tasks) instead of labelled tiles.
- Sections use `ListRow`; task and Work status pills become leading status icons; "Load more" becomes
  a centered icon button with a count.

### Chat thread
- Header unchanged in structure (title, Space subtitle, turn navigator, more).
- Turn process summary: `Meta` items (steps, tools, duration) instead of "3 steps · 5 tools · 12s".
- Load earlier/later: icon capsule (`chevrons-up` / `chevrons-down`) with a short label.
- Error banner: icon, message, refresh icon button (no "Retry" word).
- Follow-up queue header: icon + count.
- Message bubbles, Markdown, and the composer keep their measured layout logic; only styling
  moves to tokens. This screen is migrated last and profiled on a release build.

### Everything else
Settings subpages, sheets, menus, toasts, auth, Works, tasks, and files adopt the same
primitives without layout changes beyond the density rules. Debug screens migrate last and are
internal; they may keep Chinese-only copy.

## 5. Migration status and guard

All five phases are complete: every screen, sheet, menu, the chat thread, and the debug screens
use tokens through className. Each phase shipped to staging first (debug menu → Updates → switch
to staging), was checked on a device, then merged for production OTA. None needed a native build.

CI keeps it that way (both run in the Quality job, outside `package.json` scripts because those
are part of the OTA fingerprint):

- `scripts/design-tokens.mjs --check`: `global.css` matches `src/design/tokens.ts`.
- `scripts/check-design-system.mjs`: app code has no color literals, typography spreads, theme
  colors in styles, or pressed-style functions. A line that genuinely needs a JS value (a native
  prop, a measured text style, the Markdown renderer, a theme preview) says so with a
  `design-system:` comment, or a block wraps it in `design-system-begin:` … `design-system-end`.

What stays JS on purpose, with that comment: the Markdown renderer's style object, measured text
in bubbles, the code editor, and the send overlay; navigator and WebView backgrounds; Link-slotted
thumbnails; theme preview cards; the always-black photo viewer and scrims; the logo.

Per-screen definition of done: light, dark, pure black, a Config theme, font scale small and
extra large, long titles, empty, loading, error, offline banner, VoiceOver/TalkBack labels on
every icon-only control, 44 pt targets.

## 6. Icon dictionary

Icons that may stand alone. Anything not listed keeps a text label.

| Meaning | Icon (`src/icons.ts`) |
| --- | --- |
| Search | `search` |
| New / add | `plus` |
| Filter | `filter` |
| More actions | `more` |
| Back / close | `arrow-left` / `x` |
| Retry / refresh | `refresh` |
| Pin / unpin | `pin` / `pin-off` (long-press menu, plus a named screen-reader action) |
| Chats / count of chats | `messages` |
| Spaces | `layers` |
| Activity | `activity` |
| Files | `folder-open` |
| Chat running | accent ring on the avatar |
| Space runtime up | green dot on the avatar |
| Failed | `alert` badge |
| Stopped | `stop` badge |
| Forked | `git-fork` |
| Steps / tools / duration | `list-tree` / `wrench` / `clock` |
| Credits | `database` |
| Earlier / later | `chevrons-up` / `chevrons-down` |
