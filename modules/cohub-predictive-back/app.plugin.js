const { withMainActivity } = require("expo/config-plugins");

const IMPORT = "import io.github.markbang.cohubmobile.predictiveback.PredictiveBack";

// Registers the back callback after ReactActivity adds its own, and keeps it out of the activity's
// default back. Calls PredictiveBack directly so R8 has nothing to resolve by name.
module.exports = function withCohubPredictiveBack(config) {
  const gestureEnabled = config.android?.predictiveBackGestureEnabled === true;
  return withMainActivity(config, (current) => {
    if (current.modResults.language !== "kt") {
      throw new Error("cohub-predictive-back needs the Kotlin MainActivity that Expo generates.");
    }
    let contents = current.modResults.contents;
    // A prebuild without --clean reruns this on its own output: only the flag may change.
    if (contents.includes(IMPORT)) {
      const install = /PredictiveBack\.install\(this, (?:true|false)\)/;
      if (!install.test(contents)) throw new Error("cohub-predictive-back found its import but not `PredictiveBack.install` in MainActivity.kt; run `expo prebuild --clean`.");
      current.modResults.contents = contents.replace(install, `PredictiveBack.install(this, ${gestureEnabled})`);
      return current;
    }
    const edits = [
      ["import android.os.Bundle\n", `import android.os.Bundle\n${IMPORT}\n`],
      ["    super.onCreate(null)\n", `    super.onCreate(null)\n    PredictiveBack.install(this, ${gestureEnabled})\n`],
      ["  override fun invokeDefaultOnBackPressed() {\n", "  override fun invokeDefaultOnBackPressed() {\n    PredictiveBack.suspendForDefaultBack()\n"],
    ];
    for (const [anchor, replacement] of edits) {
      if (!contents.includes(anchor)) {
        throw new Error(`cohub-predictive-back could not find \`${anchor.trim()}\` in MainActivity.kt; update modules/cohub-predictive-back/app.plugin.js for the new template.`);
      }
      contents = contents.replace(anchor, replacement);
    }
    current.modResults.contents = contents;
    return current;
  });
};
