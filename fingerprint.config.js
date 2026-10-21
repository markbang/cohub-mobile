/**
 * OTA runtimes must survive release version bumps. `version` and the derived
 * `android.versionCode` / `ios.buildNumber` are not native changes, so keeping
 * them in the fingerprint would strand every installed binary on the next
 * release. Keep the default package.json script skip so prebuild does not
 * change the fingerprint either.
 *
 * `strict` keeps hashing native module files: edits to the vendored
 * `modules/react-native-enriched-markdown` keep its package version, which the SDK 58 `balanced`
 * default would miss, letting an OTA land on a binary without the change.
 */
module.exports = {
  preset: "strict",
  sourceSkips: ["ExpoConfigVersions", "PackageJsonAndroidAndIosScriptsIfNotContainRun"],
};
