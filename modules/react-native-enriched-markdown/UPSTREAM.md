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
- Android: wrapped inline code ends each fragment at its line's text and hugs the glyph box.
- `src/`: two type casts for React Native 0.88 types (`styleUtils.ts`, `native/EnrichedMarkdownText.tsx`). The app's lint skips this directory; its typecheck covers it.

Every change here is native: it changes the fingerprint and ships only in a new binary.

## Updating from upstream

Unpack the new npm tarball next to this directory, diff it against the base version above, port the upstream changes, keep the local changes, and update the base version. Run `npm install` so `postinstall.mjs` restores the vendored assets.
