# Bubble Layout Acceptance

Open **Debug > Bubble Layout** (tap the Profile/About version five times to open Debug). The page uses the production MessageBubble/StreamCard, not a second renderer. No backend requests or synthetic chat submissions are made by the fixtures. Link and image interactions remain real.

## Layout Rules

- Prompts are bubbles; replies are not. A reply reads as the page itself, like the web client: full width at a 16 pt inset, with code and table wells on the surface color. The bubble rules below apply to prompts.
- Under each reply, one 44 pt line holds copy and fork (32 pt buttons, 44 pt touch targets), then `#Turn · model · thinking · ↑input · ↓output · cached`, with the time at the end. Usage parts that do not fit drop whole, from the end (estimated glyph widths, rounded up), never cut mid-word; tapping the line shows them all. The `#N` divider between Turns is gone; 8 pt above each prompt groups its Turn.
- A live reply uses the same layout. Its status line (live dot, runtime label, typing dots, or failure, plus the clock) is exactly the meta line's height, so the finished reply replaces it without moving the timeline.
- A Bot's page shows its typing indicator as a reply bubble with the Bot's 20 pt face on its left. Its time dividers use `micro` (11 pt) and the active locale's clock: "9:41 AM" in English, "09:41" where the locale uses 24 hours.
- Execution steps fold into a capsule that reads 32 pt tall inside a 44 pt row.
- A reply shows and copies only its answer. Its thinking closes the Turn's steps capsule, and a Turn that only thought gets a "Thinking" capsule. While only thinking streams, the live status line reads "thinking…" and the live capsule carries the thought, so finishing the Turn changes nothing in place.
- Ordinary short text is content-sized. Structured blocks (code, tables, lists, quotes, tools, galleries) have bounded widths so their nested rows remain usable.
- A delivered prompt shows no time or receipt inside its bubble. The newest prompt the server accepted carries one "Delivered" line, `micro` and faint, 3 pt below the bubble and right-aligned to its edge, and only while nothing renders after it. A reply, its steps, or a pending reply replaces the line. A prompt still sending shows the sending dot; a failed one shows the failure icon, its error, and the retry/delete row. Neither gets "Delivered".
- A "New Messages" divider sits in the row above the first message of the first Turn this device had not read. A Chat with unread opens with that message near the top of the viewport and the divider above it, placed before the list's first load so the tail never shows first. When the only unread message is the last one, the Chat opens at the tail as usual and the divider sits above that message.
- The divider is live. It drops once the read sequence passes its Turn (the reply to that Turn comes into view), and it never returns when scrolling back. While an unread run is on screen at open, the read sequence does not advance until the first drag, so the rows in view at open are not counted as read. Leaving the Chat reads it through, as the seen mark does for the list.
- For prompts, the last visible text block measures native line rectangles and the status area (sending dot or failure icon). Single-line text may expand within the bubble cap to fit that status. Multi-line text is never narrowed to reserve a status column.
- Status shares the final line only when its measured right-hand space fits the whole status area plus an 8 pt gap. Its bottom sits 2 pt below the text line when height permits. Otherwise it occupies its own right-aligned row.
- Code/table/image/tool endings get a separate status row outside the framed content. Empty trailing text and hidden tool results do not take ownership of the status. Content-only records and text-only records use the same composition. A prompt's error sits below its bubble in the danger tone, above its retry and delete row; its receipt is the alert icon, never the delivered check.
- During streaming, the timestamp stays in its own row outside the growing text's measurement cycle. Each append changes the text measurement key; previously that reset the footer to a new row and then pulled it inline again, even without a line break (a replay measured 48 -> 64 -> 48 pt). Completed messages retain the measured inline placement. Glyph reveal/fade timing is unchanged.
- Measurements are asynchronous: the unmeasured completed-message state reserves a separate footer row, and native layout results determine the final placement. Verify settling and streaming on device; Node assertions cannot validate native frame timing.
- This layout does not alter turn navigation, selection handlers, or scroll-to-turn behavior.

## Controls

- **Text / Rich / States**: 29 fixed cases, each rendered once as a user and once as an assistant. Includes Chinese/English, multi-line and multi-screen text, emoji/combining marks, RTL, unbroken tokens, formatted text, heading/list/quote endings, code, tables, bundled images, nested tool output, sending/errors, missing summaries, invalid dates, and empty records.
- **Boundary**: 12 progressively longer messages, paired across roles, for the exact point where metadata stops fitting on the last line.
- **Stream**: start/pause, restart, and interrupt an incremental reply; compare the completed MessageBubble with the live StreamCard.
- **280 pt** constrains the specimen viewport. **Inverted** changes list direction. Test both along with a normal phone-width viewport.
- The sun/moon button and size options change the real app appearance preferences. Restore your preferred settings after testing. For additional scaling, use the Android system font setting.
- **Record** starts a fresh memory-only diagnostic log (replacing any existing scroll recording). The bookmark inserts a marker; Copy pauses recording and copies all retained entries. The shared recorder retains 4,000 entries and reports overwritten entries in the export header.

## Device Checklist

1. Compare Short reply and Short request in light/dark mode. A request must not be a mostly empty full-width bubble; a reply has no bubble, and its meta line holds the actions, details, and time on one row.
2. Compare Boundary cases in default/xlarge app text and 280 pt/full width. The footer must be wholly on the final line or wholly below it, never covering characters, links, or checkmarks.
3. Check explicit newlines, mixed direction, long tokens, and multi-screen paragraphs. No horizontal overflow; earlier lines must not become a narrow column to accommodate the time.
4. Check all Rich cases. Expand the tool result and open the gallery. Nested code/table content must remain inside its available width; time must not appear inside a code/table/image frame.
5. Check sending/error and missing-summary cases. The error must remain legible, exactly one metadata area should appear, and the content must not change when an optional summary exists. An empty record should have no bubble; an invalid timestamp leaves the time out without an empty row.
6. Start the stream, pause, resume, interrupt, restart, and let it finish. Watch the footer as new lines and Markdown blocks appear, especially while reading away from the bottom. Note any repeated height oscillation or visible settling.
7. Repeat taps, long presses, selection, and scrolling in an actual chat. This work is not a fix for Android selection-induced scrolling.

For a failure, report case number/group, role, viewport mode, font size, theme, and action. Include a screenshot or recording and the copied log. `bubble.metaLayout` includes message/session aliases, text and metadata measurements, last-line rectangle, requested minWidth, footer marginTop, and inline decision. It contains no message text. The existing Scroll Diagnostics page records explicit chat scroll commands separately.

## Automated Coverage

`bun run test:workflow` checks metadata geometry at multiple widths/scales and executes the real Markdown JSX composition with lightweight native leaf stubs to verify footer forwarding, uniqueness, and a separate streaming footer across every prefix of a mixed Markdown reply. These are not native screenshot tests. Use `bun run verify`, `bun run export:android`, and `bun run export:ios` for code/bundle validation.
