/**
 * OTA runtimes must survive release version bumps. `version` and the derived
 * `android.versionCode` / `ios.buildNumber` are not native changes, so keeping
 * them in the fingerprint would strand every installed binary on the next
 * release. package.json scripts are tooling commands, not native inputs: a
 * script that patches native sources shows up in the hashed files it writes,
 * so editing a check command must not strand installed builds either.
 *
 * `strict` keeps hashing native module files: edits to the vendored
 * `modules/react-native-enriched-markdown` keep its package version, which the SDK 58 `balanced`
 * default would miss, letting an OTA land on a binary without the change.
 */
module.exports = {
  preset: "strict",
  sourceSkips: ["ExpoConfigVersions", "PackageJsonScriptsAll"],
};
