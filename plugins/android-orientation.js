const { AndroidConfig, withAndroidManifest, withMainActivity } = require("expo/config-plugins");

const LOCK = "if (resources.configuration.smallestScreenWidthDp < 600) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT";

/**
 * Phones stay in portrait; tablets (smallest width 600 dp and up) turn freely. `orientation: "portrait"` would
 * lock the manifest on every device, and a tablet launched in landscape is then letterboxed into a portrait
 * window whose size reads as a phone's, so no later check can tell it is a tablet. The manifest therefore
 * leaves orientation open, and MainActivity locks phones before the first frame, measuring the real window.
 */
module.exports = function withAndroidOrientation(config) {
  config = withAndroidManifest(config, (current) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(current.modResults);
    activity.$["android:screenOrientation"] = "unspecified";
    return current;
  });
  return withMainActivity(config, (current) => {
    if (current.modResults.language !== "kt") throw new Error("android-orientation needs the Kotlin MainActivity that Expo generates.");
    let contents = current.modResults.contents;
    if (contents.includes(LOCK)) return current;
    const edits = [
      ["import android.os.Bundle\n", "import android.content.pm.ActivityInfo\nimport android.os.Bundle\n"],
      ["  override fun onCreate(savedInstanceState: Bundle?) {\n", `  override fun onCreate(savedInstanceState: Bundle?) {\n    ${LOCK}\n`],
    ];
    for (const [anchor, replacement] of edits) {
      if (!contents.includes(anchor)) throw new Error(`android-orientation could not find \`${anchor.trim()}\` in MainActivity.kt; update plugins/android-orientation.js for the new template.`);
      contents = contents.replace(anchor, replacement);
    }
    current.modResults.contents = contents;
    return current;
  });
};
