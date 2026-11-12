# Web renderer for react-native-enriched-markdown

The browser half of [software-mansion/enriched-markdown](https://github.com/software-mansion/enriched-markdown) (`packages/react-native-enriched-markdown`), MIT, from npm `react-native-enriched-markdown@1.1.1`: `src/index.web.tsx` (here `index.tsx`), `src/web/`, `src/normalizeMarkdownStyle.web.ts` and `src/types/MarkdownTextProps.web.ts`, unpacked as published.

It lives outside `modules/react-native-enriched-markdown` because that directory is part of the native fingerprint: adding files there would strand every installed binary's OTA updates. `metro.config.js` resolves `react-native-enriched-markdown` here on web; imports of the shared sources point into the native package.

## Local changes

Search for `cohub:` to find each one.

- KaTeX is not bundled; math shows as source.
- The default style carries the fields the native fork added (`contextMenu`, code block header, table dividers).
