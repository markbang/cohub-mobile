# Vendored react-native-screens

Fork of [software-mansion/react-native-screens](https://github.com/software-mansion/react-native-screens), MIT. Keep `LICENSE`.

- Base: npm `react-native-screens@4.30.0`, unpacked as published.
- Removed: `windows/` and `README.md`. There is no Windows target.
- `package.json` keeps only the fields Metro, TypeScript, the podspec, autolinking, and codegen read.
- The app's lint and typecheck skip this directory; the app's own imports still typecheck against `lib/typescript`.

## Local changes

Search for `cohub:` to find each one. The Android ones are inert until the app sets `ScreenStack.predictiveBackHost`, which `modules/cohub-predictive-back` does only when `android.predictiveBackGestureEnabled` is on.

- iOS `RNSScreen.registerContentScrollViewIfNeeded`: after layout and on appearing (retrying for two seconds while the list mounts), the screen hands its first-descendant scroll view to UIKit with `setContentScrollView:forEdge:` on itself, its navigation controller, and the hosting tab, so Large Titles collapse and a minimizing tab bar tracks the content.

- `ScreenStack`: after a push, the screen it was pushed from stays attached, but invisible, instead of being removed, when the host allows the pushed route (`PredictiveBackHost.canPreviewBelow`). Only that one screen, only under an opaque push with the default animation, and only while it is still attached: retaining never adds a fragment. A transparent modal on top (the image viewer) keeps it for when the modal closes.
- `ScreenStack`: the retained screen gets the animations its fragment would have had from being removed (`rns_default_enter_out`) and added again (`rns_default_exit_in`). A pop the back gesture already animated (`markPredictiveBackPop`) runs with `NONE`. A retained screen the stack drops is hidden first, so its removal never animates or reverses the drawing order.
- `ScreenStack.predictiveBackViews` / `setPredictiveBackPreview`: the top view and the retained view for the gesture to transform, and showing the retained one while it previews.
- `ScreenFragment.isRetainedBelow`: the retained fragment stays resumed, so its animations dispatch disappear and appear events instead of reading that as appearing.
- `ScreenStackFragment.onViewAnimationEnd`: hides the retained screen once the push that covers it ends.
- `ScreensCoordinatorLayout.pointerEvents`: `NONE` while retained. React Native hit-testing ignores visibility.

Every change here is native: it changes the fingerprint and ships only in a new binary.

## Updating from upstream

Unpack the new npm tarball next to this directory, diff it against the base version above, port the upstream changes, keep the local changes, and update the base version. Recheck that `ScreenStack.onUpdate` still removes the screens under the top in one transaction, which the retained-screen filter hooks into.
