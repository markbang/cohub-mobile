const {
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const activityName = ".CohubDetailActivity";

module.exports = function withPredictiveBack(config) {
  config = withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) throw new Error("Android application manifest entry is missing.");
    application.$ = application.$ ?? {};
    application.$["android:enableOnBackInvokedCallback"] = "true";
    application.activity = application.activity ?? [];
    if (!application.activity.some((activity) => activity.$?.["android:name"] === activityName)) {
      application.activity.push({
        $: {
          "android:name": activityName,
          "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths",
          "android:launchMode": "standard",
          "android:windowSoftInputMode": "adjustResize",
          "android:theme": "@style/Theme.App.SplashScreen",
          "android:exported": "true",
          "android:screenOrientation": "portrait",
        },
        "intent-filter": [{
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          category: [
            { $: { "android:name": "android.intent.category.DEFAULT" } },
            { $: { "android:name": "android.intent.category.BROWSABLE" } },
          ],
          data: [{ $: { "android:scheme": "cohub-detail" } }],
        }],
      });
    }
    return configWithManifest;
  });

  return withDangerousMod(config, ["android", async (configWithMod, action) => {
    const packageName = configWithMod.android?.package;
    if (!packageName) throw new Error("Android package is required to generate CohubDetailActivity.");
    const packagePath = packageName.replace(/\\./g, "/");
    const destination = path.join(action.platformProjectRoot, "app/src/main/java", packagePath, "CohubDetailActivity.kt");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `package ${packageName}\n\nimport android.os.Build\nimport android.os.Bundle\nimport com.facebook.react.ReactActivity\nimport com.facebook.react.ReactActivityDelegate\nimport com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled\nimport com.facebook.react.defaults.DefaultReactActivityDelegate\nimport expo.modules.ReactActivityDelegateWrapper\nimport expo.modules.splashscreen.SplashScreenManager\n\nclass CohubDetailActivity : ReactActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    SplashScreenManager.registerOnActivity(this)\n    super.onCreate(savedInstanceState)\n    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {\n      overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, 0, 0)\n      overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)\n    }\n  }\n\n  override fun getMainComponentName(): String = "main"\n\n  override fun createReactActivityDelegate(): ReactActivityDelegate = ReactActivityDelegateWrapper(\n    this,\n    BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,\n    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {}\n  )\n}\n`, "utf8");
    return configWithMod;
  }]);
};
