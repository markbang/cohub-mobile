# Vendored expo-glass-custom-menu glass

Android Liquid Glass for drawn menus, from [rit3zh/expo-glass-custom-menu](https://github.com/rit3zh/expo-glass-custom-menu) (`modules/glass-menu-android`), MIT. Keep `LICENSE`.

- Base: commit `0021efd8ab0d068f155bbdac62c5f673ccc39a24`.
- Copied with only the package renamed (`expo.modules.glassmenuandroid` → `io.github.markbang.cohubmobile.glassmenu`): `motion/`, `render/`, `field/`, and `records/` `GlassMenuConfigRecord`, `GlassTriggerConfigRecord`, `GlassShrinkRecord`, `GlassAbsorbRecord`.
- Not taken: the JS compound components, the Canvas-drawn rows and icons (`content/`), the bundled Inter font, the resting glass trigger (`GlassMenuAndroidView`), and the overlay's own back handling and accessibility helper. The app keeps those in JS (`src/ui/MorphMenuSurface.tsx`, `AnchoredActionMenu`, `cohub-predictive-back`).

## Local code

`GlassMenuView.kt` takes the place of upstream's `GlassMenuOverlay` and `GlassMenuSession`. Its drawing, frame loop and row capsule port `GlassMenuSession.draw`, `tick`, `highlight`, `GlassMenuContent.drawPlate` and `GlassMenuOverlay.doFrame`, with these differences:

- The rows are the view's React Native child (the panel), recorded into the rows node, so text, scrolling, accessibility and test IDs stay React Native's. JS lays the panel out where the menu settles and names the lit row by tag; the selection haptic stays in JS.
- The backdrop is the page color plus the content of the expo-blur `BlurTargetView` JS names, read from Dimezis's `BlurTarget.renderNode` (kept by `android/proguard-rules.pro`), instead of the whole window. JS never names a target that contains the menu.
- The trigger is a React Native view drawn by tag; it has no resting glass, press jelly or light of its own. `sourceGlass` picks upstream's two trigger kinds: a glass trigger buds into the menu as a second lobe and is drawn inside the glass (upstream `glass={true}`); a plain one (a select's value) is drawn over the screen shrinking away while the glass fades in (upstream `glass={false}`).
- Renderers are pooled across menus (`render/GlassRendererPool.kt`). Upstream keeps one renderer per glass trigger for the app's life; here each menu is a new view, so without the pool every open compiled the shaders, warmed the pipelines and ran the field warm-up thread again. JS warms the pool once after launch (`GlassMenuWarmup`).
- The view fills the menu's overlay and takes no touches itself (`PointerEvents.BOX_NONE`). After the close it keeps its last frame until React removes it.
- Below Android 13, and under Reduce Motion or Reduce Transparency, JS draws the menu itself (`DrawnMorphMenuSurface`); `drawFallback` covers only a canvas without hardware acceleration.

Every change here is native: it changes the fingerprint and ships only in a new binary.

## Updating from upstream

Diff upstream's `motion/`, `render/`, `field/` and records against the base commit, copy changes with the package renamed, and port changes in `GlassMenuSession` and `GlassMenuOverlay` into `GlassMenuView.kt`. Update the base commit.
