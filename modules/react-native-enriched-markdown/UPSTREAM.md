# Vendored react-native-enriched-markdown

Fork of [software-mansion/enriched-markdown](https://github.com/software-mansion/enriched-markdown) (`packages/react-native-enriched-markdown`), MIT. Keep `LICENSE` and the third-party licenses in `cpp/md4c/md4c.c` and the restored grammar and RaTeX directories.

- Base: npm `react-native-enriched-markdown@1.1.1`, unpacked as published.
- Removed: the prebuilt `lib/` (Metro and TypeScript read `src/`), web and wasm sources, Jest mocks, and docs. There is no web target.
- Removed the JS side of `EnrichedMarkdownTextInput` (the editor). Its native views and codegen spec remain because autolinking and `codegenConfig` still register them; removing them needs a native build to verify.
- `package.json` keeps only the fields the podspec, Gradle, autolinking, and codegen read.
- `postinstall.mjs` still restores tree-sitter grammars and RaTeX from pinned manifests; those outputs are gitignored.

## Local changes

Search for `cohub:` to find each one.

- Android and iOS code blocks and tables claim a horizontal drag only while they can scroll that way (`NestedHorizontalScrollView.kt`, `ENRMNestedHorizontalScrollView`).
- md4c: a non-ASCII neighbour delimits a permissive autolink, so `通过：https://…。` links as in the web client.
- Android: block bottom margins are a separate spacer line, so selecting a paragraph does not highlight the gap below it.
- Android: a list's line height runs before its items' margin spans (`ListRenderer`), so the measuring layout and the TextView agree on spacer-line heights. Without it a long reply that contains a list is measured shorter than it draws, and its last line is drawn below the view's bottom edge (upstream issue #1060, pull request #1102).
- Android: wrapped inline code ends each fragment at its line's text and hugs the glyph box.
- Android: `consumer-rules.pro` keeps `segments.MathContainerView`, so display math survives R8.
- `markdownStyle.contextMenu`: the long-press block menu (`ContextMenuPopup`) reads its colors, radius, and sizes from JS. iOS keeps the system menu and ignores it.
- `table.columnDividers`, `table.maxColumnWidth`: rows-only grid and a JS-set wrap width. The table frame stays on the viewport while content scrolls.
- `codeBlock.header*`: tinted header band with its own padding, a 44pt copy target, and a checkmark after copying. A block without a language has no header; the copy button floats over the code.
- `android/generated` and `ios/generated` are regenerated for these spec fields.
- Android `EnrichedMarkdown`: `commitPropsSynchronously()` renders on the calling thread and `measuresContent` lets the view measure its own segments, for the native chat timeline (`modules/cohub-chat-timeline`), which binds rows outside Fabric.
- iOS `EnrichedMarkdown`: `cohub_applyProps:renderInline:`, `cohub_measureWidth:`, `cohub_setFrame:`, and `cohub_setLinkHandler:…` let the native chat timeline host the view outside Fabric. Props go through the generated props class; link and height events go to the host's blocks instead of the event emitter.
- Android `CodeBlockHighlighter`: highlight tokens are cached per code and language, so rebinding a recycled row does not parse its code again.
- `src/`: two type casts for React Native 0.88 types (`styleUtils.ts`, `native/EnrichedMarkdownText.tsx`). The app's lint skips this directory; its typecheck covers it.

Every change here is native: it changes the fingerprint and ships only in a new binary.

## Updating from upstream

Unpack the new npm tarball next to this directory, diff it against the base version above, port the upstream changes, keep the local changes, and update the base version. Run `npm install` so `postinstall.mjs` restores the vendored assets.
