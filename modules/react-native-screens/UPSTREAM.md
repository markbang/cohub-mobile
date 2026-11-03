# Vendored react-native-screens

Fork of [software-mansion/react-native-screens](https://github.com/software-mansion/react-native-screens), MIT. Keep `LICENSE`.

- Base: npm `react-native-screens@4.30.0`, unpacked as published.
- Removed: `windows/` and `README.md`. There is no Windows target.
- `package.json` keeps only the fields Metro, TypeScript, the podspec, autolinking, and codegen read.
- The app's lint and typecheck skip this directory; the app's own imports still typecheck against `lib/typescript`.

## Local changes

None yet.

## Updating from upstream

Unpack the new npm tarball next to this directory, diff it against the base version above, port the upstream changes, keep the local changes, and update the base version.
