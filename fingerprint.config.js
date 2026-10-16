/**
 * OTA runtimes must survive release version bumps. `version` and the derived
 * `android.versionCode` / `ios.buildNumber` are not native changes, so keeping
 * them in the fingerprint would strand every installed binary on the next
 * release. Keep the default package.json script skip so prebuild does not
 * change the fingerprint either.
 *
 * `strict` keeps hashing native module files: `scripts/patch-enriched-markdown.mjs` edits native
 * sources inside node_modules without changing the package version, which the SDK 58 `balanced`
 * default would miss, letting an OTA land on a binary without the patch.
 */
module.exports = {
  preset: "strict",
  sourceSkips: ["ExpoConfigVersions", "PackageJsonAndroidAndIosScriptsIfNotContainRun"],
};
