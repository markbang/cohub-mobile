const { withGradleProperties } = require("expo/config-plugins");

// sandboxd ships as lib/<abi>/libcohub_sandboxd.so and is executed, not loaded. Android only
// allows executing it from nativeLibraryDir, which requires extracting native libraries.
module.exports = function withCohubDeviceRuntime(config) {
  return withGradleProperties(config, (current) => {
    current.modResults = current.modResults.filter((item) => !(item.type === "property" && item.key === "expo.useLegacyPackaging"));
    current.modResults.push({ type: "property", key: "expo.useLegacyPackaging", value: "true" });
    return current;
  });
};
