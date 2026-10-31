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
| Navigation tabs | Icon + label | Tabs name destinations, so they always keep their words (platform convention). The selected tab is accent on the lens. |

An icon is allowed to replace text only when it is in the **icon dictionary** (§6). Anything
else keeps its words. Icon-only controls get a long-press hint in a later phase if usage shows
confusion; the accessibility label is mandatory from day one.

### 2.2 Density: two lines per row, one idea per line

- List rows have **at most two text lines**: line 1 = identity (title + time), line 2 = context
  (preview or description). Extra facts become glyphs on the avatar or inline icons, not a
  third line.
- Row heights: **72 pt** for content lists (46 pt avatar, 12 pt vertical padding, 4 pt between the lines), **52 pt** for settings rows, **56 pt**
  minimum for anything with a 44 pt control.
- **Content rows are flat**, as in Mail, on both platforms: full width, with a hairline inset past the
  avatar; rows that belong together (a fork tree) read as one item through `group`, and only its end
  draws a separator. Settings rows keep hairlines **inset to the text column** inside their group card.
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

- **The app icon sets the language** (`src/design/brand.ts`). Its gradient (`#fdba72` → `#fa7b23` →
  `#dc4b05`), ink, and white face are the logo's and stay fixed across themes and accents: the gradient
  appears only on the logo tile and the sign-in hero. The mascot (`Mascot`, `CohubLogo`) is the product's
  face: sign-in, empty states, not-found, and the Cohub harness icon. It never decorates chrome or
  content, and its cheek mark is never covered.
- **One accent** (ember, from the icon). It marks primary action, selection, and running state.
  Nothing else gets a new hue. The icon's orange fails 4.5:1 as text on paper, so the light accent is
  `#bf3f00`, just past the dark end of the gradient; dark mode uses `#ff8a3d` with ink on it, the icon's
  own pairing.
- **One grey family, warm.** Every neutral leans toward the orange: paper and pure white in light mode,
  warmed ink in dark mode.
- **Selection is filled.** A selected filter or segment is the accent itself with
  `text-on-accent`, not a tinted wash; unselected ones sit on the surface one level up. The tab
  bar is the exception, as on iOS: its lens is a tint and the selected tab is marked by accent color.
- **Flat content, floating chrome.** Only the tab bar, menus, toasts, banners, and the composer use
  `shadow-float`. Cards are separated by surface color, not shadow.
- **Surfaces step, borders don't.** A surface stands out from what it sits on by a step in
  lightness, not an outline. Floating chrome without raised blocks inside (tab bar, action and
  context menus, toasts, the offline banner, jump-to-latest) uses `bg-surface-float`: the card
  white in light mode, one level lighter than cards in dark mode, where a shadow does not show.
  Composer menus and the slash and mention menus keep `bg-surface` and a hairline because their
  rows use `bg-surface-raised` blocks, which a float would swallow in dark mode.
- **Glass for floating controls** (`src/ui/Glass.tsx`). The tab bar and its lifted lens, top-bar
  buttons, the composer, action and context menus, and jump-to-latest draw their backdrop with
  `GlassBackground`: iOS 26 Liquid Glass (the tab bar and lens share a `GlassGroup` so they merge),
  a system blur on older iOS, a frosted blur on Android only where the surface has a blur target
  (the tab bar, through `TabScreenLayout`), and the solid surface otherwise or under Reduce
  Transparency. Glass does not render at low opacity, so a glass shape that appears and
  disappears in place (the lifted lens) switches its style to `none` rather than fading.
- **Shape rule** (by a shape's shortest side): tags and wells `rounded-xs` (8), controls
  `rounded-sm` (14), cards/menus/bubbles `rounded-md` (20), sheets `rounded-lg` (28); buttons,
  filters, segmented controls, and other capsules `rounded-full`. Pair every rounded rectangle with
  `borderCurve: "continuous"` where the platform supports it (iOS).
- **Concentric corners.** A shape nested in another at an inset takes `outer = inner + inset`.
  The composer's corner is its 8 pt padding plus half its 44 pt corner controls (30); a
  `Segmented` control is a capsule in a capsule, concentric at any height.
- **Type ramp** (size/line height; `caption` defaults to 500 and `micro` to 600 so small text stays legible, and a `font-*` class overrides either):

| Token | Size | Use |
| --- | --- | --- |
| `text-display` | 34/41 | The Settings Large Title, one figure per screen (credits balance) |
| `text-title` | 22/28 | Sheet titles, Space name on its home |
| `text-headline` | 17/22 | Navigation bar titles |
| `text-body` | 17/22 | Row titles, settings rows, form text |
| `text-chat` | 17/24 | Message text |
| `text-subhead` | 15/20 | Row second line, descriptions, filters, segments |
| `text-caption` | 13/18 | Time, meta, settings group labels |
| `text-micro` | 11/14 | Badges, counts. Nothing smaller exists. |
| `text-code` | 13/20 | Monospace |

Weights: 400 body, 500 captions, 600 titles, emphasis, and micro labels, 700 display only. Numbers that count or change use
`tabular-nums`.

- **Rounded display type on iOS.** `ROUNDED_TITLE` (`src/ui/rounded.ts`, SF Pro Rounded) echoes the
  icon's letterform on brand titles and a screen's one display figure. Everything else, including the
  system navigation bar, stays SF Pro. Android keeps its system font.
- **Colors** are named for `className`:
  `text-fg`, `text-fg-secondary`, `text-fg-muted`, `text-fg-faint`, `bg-background`,
  `bg-surface`, `bg-surface-raised`, `bg-surface-pressed`, `bg-surface-float`, `border-border`, `bg-accent`,
  `text-on-accent`, `bg-accent-soft`, `text-success|warning|danger|info` and their `-soft`
  backgrounds. Tailwind's default palette is removed: a class like `bg-red-500` does nothing.
- **Runtime theming** stays: pure black, the accent preset (`src/design/accents.ts`), and the font scale
  preference all flow through `useUniwindThemeSync()` into the same CSS variables, so className
  styling and JS colors can never disagree.

### 2.4.1 System controls on iOS, drawn controls on Android

Where iOS has a system control for the job, iOS uses it and Android draws the matching one, behind
one component and a platform file (`Foo.tsx` for Android, `Foo.ios.tsx` for iOS) or a `native*`
flag from such a file, so call sites stay the same:

| Job | iOS | Android |
| --- | --- | --- |
| Tab bar | `NativeTabs` (`app/(tabs)/_layout.ios.tsx`) | `FloatingTabBar` (`_layout.tsx`) |
| Navigation bar on pushed screens | Native stack header through `TopBar` (`NativeHeader.ios.tsx`); `drawn` opts out for bars that move with content, and transparent or long-press titles stay drawn | drawn `TopBar`: chevron back, centered title balanced against the actions |
| Tab roots | Large Title, system search bar, and bar items (`TabStack.ios.tsx`, `useNativeHeader`) | `LargeTitleBar` in `EdgeHeader`, with the `LargeTitle` and a `SearchField` as the list's first row; the small title fades in once the Large Title scrolls under the bar |
| Sheets | UIKit page sheet (`AdaptiveSheet.ios.tsx`) | drawn `AdaptiveSheet` with the same bar: close leading, title centered |
| Icons | SF Symbols (`Glyph.ios.tsx`, `src/sf-symbols.ts`) | Lucide |
| Busy indicator | `ActivityIndicator` | the same eight-spoke spinner, drawn (`Loader`) |
| Content lists | Flat full-width rows with inset hairlines (`ListRow`) | the same |
| Language and Storage settings | SwiftUI `Form` | drawn settings rows |
| Switches | System thumb with the accent track (`AppSwitch`) | the iOS switch, drawn |
| Segmented choice | SwiftUI segmented `Picker` (`NativeSegmented.ios.tsx`) | drawn `Segmented` |
| Button menus: Chat and Space "more", Chats source filter, composer add | SwiftUI `Menu` (`NativeMenu.ios.tsx`) | `AnchoredActionMenu`, `AttachmentMenu` |
| A few values picked in a settings row | SwiftUI menu `Picker` (`SettingsSelectRow.ios.tsx`) | drawn `SettingsSelectRow` |
| Renaming a Chat | `Alert.prompt` | drawn dialog |
| Composer harness choice | SwiftUI `Menu` with sections and checks (`harnessMenuSections`) | `HarnessPicker` |
| Yes-or-no confirmations: sign out, cancel billing, unbind or remove a channel, rotate a referral code, clear the cache | system action sheet (`ConfirmSheet` in `SystemDialogs.ios.tsx`); a failure returns as an alert with Retry | `ConfirmSheet` drawn as an action sheet: the question and action in one card, Cancel below |
| Notices with one way out | system alert (`NoticeSheet`) | `NoticeSheet` drawn as an alert |
| Long-press peek on Chat and Space rows: a preview of the last exchange or the Space's description above Open (and Pin) | SwiftUI `ContextMenu` with `preview` (`NativeContextMenu.ios.tsx`), built from data already on screen | drawn `ContextMenu` with the same `preview` above the actions, opened at the touch |
| Long-press menus: Space rows, file rows, the Chat and file titles | SwiftUI `ContextMenu` around the view (`NativeContextMenu.ios.tsx`), which lifts it into a preview | the drawn menu or alert from the view's own long press |

Cache retention is picked in place with `SettingsSelectRow` on both. The system tab bar mounts every
tab at launch, where the drawn one mounts a tab on first visit. Tab roots stay React Native rather than
a SwiftUI `Form`: UIKit has to find the root scroll view for the Large Title to collapse.

### 2.5 Motion

`src/motion.ts` holds the timings and the spring presets (`springs`). Anything that moves in
response to a touch or a choice uses a spring, so an interrupted motion continues from where it is:

- Sheets use UIKit's sheet spring (mass 3, stiffness 1000, critically damped). A release closes
  the sheet when its projected position (UIScrollView's fast deceleration) passes half its height;
  a throw back up keeps its speed and lands with slight overshoot.
- Menus and popovers spring out of their anchor with a small bounce (`PopoverSurface`, from 0.5
  scale; the slash and mention menus, which reappear while typing, from 0.92) and close at once.
- The `Segmented` thumb slides on `springs.indicator`. The tab bar's lens uses UIKit's measured
  tab-bar springs (`springs.dock*`); a tab's icon pops when it becomes selected.
- Composer glyphs that change (send, stop, sent; add, close) pop in instead of swapping.

**Haptics** go through `src/platform/haptics.ts` only, on the same frame as the visual: `selection`
when a drawn control's value changes (system controls bring their own), `commit` when a send, steer,
or stop leaves the device, `longPress` when a drawn menu opens from a hold, `failure` with a danger
toast, `success` for the debug unlock. Nothing buzzes on scroll, row taps, or navigation.

Rows use background highlight on press (`active:bg-surface-pressed`),
not scale and not a haptic (a touch that starts a scroll begins on a row); buttons and cards keep `PressableScale`. Tab screens never slide.
The chat thread's rows, bubbles, and streaming text add no motion of their own: list layout
animations would fight scroll anchoring and turn ordering.

## 3. Components

Shared primitives keep their current names and props so screens migrate without API churn.

| Component | Change |
| --- | --- |
| `AppIcon` | Adds `tone` (`fg`, `muted`, `faint`, `accent`, `success`, `warning`, `danger`) so callers stop passing hex. |
| `IconButton` | Numeric `size` for the visual circle (icon at half of it); the touch target never drops below 44 pt. Tones `default`, `accent`, `danger`. `filled` draws a solid circle (accent-filled for `accent`); buttons in a `TopBar` are filled by default. |
| `PrimaryButton` | Capsule, 52 pt. `variant: "primary" | "secondary" | "ghost" | "danger"`. |
| `ListRow` (new) | 72 pt card. Leading slot, title, trailing meta, second line, trailing accessory; `group` joins rows into one card. Backs Chat, Space, search, and resource rows. `Meta` and `Tag` sit beside it in `src/ui/ListRow.tsx`. |
| `AvatarStatus` (new) | Replaces `StatusPill` in lists: a Chat that is running = accent ring around the avatar, failed = `alert` badge, stopped = `stop` badge. A Space whose runtime is up keeps the small green dot on `Avatar` (`online`). `StatusPill` stays for detail headers only. |
| `Meta` (new) | Icon + tabular value, e.g. chats count, step count, duration. |
| `SectionHeader` | Sentence case `text-headline font-bold text-fg`, no uppercase eyebrow. |
| `SettingsGroup`/`SettingsRow` | 52 pt rows, the glyph on an `accent-soft` tile, inset separators, `rounded-md` group. |
| `SettingsSelectRow` | A settings row that picks one of a few values in place, as an iOS pop-up button: the value and `chevrons-up-down` at the trailing edge, a glass menu that springs out of it with a check on the current value. Tap opens it; a press held 120 ms opens it under the finger, and sliding onto a value and letting go picks it, with a selection haptic per row. Used for Language and Web browsing; longer or richer choices keep their own page. iOS renders the system pop-up button (`@expo/ui` SwiftUI `Picker`, `SettingsSelectRow.ios.tsx`); Android renders the drawn one with the same props. |
| `EmptyState`, `DataError`, skeletons | A skeleton traces the content it stands in for (`src/ui/Skeleton.tsx`): `LoadingRows` for `ListRow` cards, `LoadingFlatRows` for bordered file and picker rows, `LoadingDocument` for code and diffs, `LoadingSections` for settings-style pages; content of unknown shape (web previews) uses `LoadingState`. Errors use an icon retry button. |
| `TopBar`, `EdgeHeader` | Title `text-headline font-semibold`; `large` puts a `text-display` Large Title under the bar (Settings); `titleHidden` leaves tab roots (Chats, Spaces, Activity) with only their buttons, the selected tab naming the screen, and keeps the title as the screen reader's header. |
| `FloatingTabBar` | Icon + label, 62 pt, content-width capsule, `shadow-float`, a lens that lifts and follows a drag. |

## 4. Screens

### Tab bar
Floating bar with icon above a short label (messages, layers, activity), modelled on the iOS 26 tab
bar. A lens rests under the selected tab on `accent-soft`, with that tab's icon and label in accent.
Touching the bar lifts the lens (it grows, stands off the bar with a shadow, and magnifies the tab
under it) and moves it to the touched tab; dragging slides it across the bar with a selection
haptic at each tab, stretching with its speed and rubber-banding past either end. Letting go selects
the tab under the lens, carrying a flick on by at most one tab; the lens drops once it has arrived.
The bar hugs its 76 pt slots instead of spanning the screen. Height 62.

### Chats
- Header: source filter chip (All / Web app / Other) · search · new chat. The account lives in the
  Me tab. There are no status filters; row status comes from `AvatarStatus`.
- Row (`ListRow`, 72 pt): Space avatar 46 with `AvatarStatus`; line 1 = title (fork icon prefix
  when forked) + time; line 2 = `Space name · preview` in `text-subhead`. The separate
  "Forked from…" line and the "Running" pill are removed; labels collapse to at most two
  `rounded-xs` tags at the end of line 2.
- Forks: a fork tree is one card. Forks nest up to three levels, 12 pt per level, with rails from
  the parent's avatar; deeper forks flatten into the third level. A parent with more than three forks
  shows its two most recent (plus any running) and closes the card with a "Show N more forks" row.
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
  moves to tokens.
- Markdown in a message (`enrichedMarkdownStyle`) spaces blocks closer than a document: one gap
  (0.45 of a chat line) after paragraphs, lists, quotes, code, tables, and images; headings scale
  from the chat size. List markers hang just inside the text column in a 14 pt column. Inline code
  is a narrow platform monospace on a faint wash of the text color, because the renderer paints its
  background to the full line height; fenced code is a borderless block one surface step above what
  it sits on (`surface` under a reply on the page, `surface-raised` in a prompt bubble or a card),
  with syntax colors per mode. `app/debug/markdown.tsx` shows every supported element. This screen is migrated last and profiled on a release build.

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

Per-screen definition of done: light, dark, pure black, a non-default accent, font scale small and
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
