const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  globalIgnores([
    "dist/**",
    ".expo/**",
    "android/**",
    "ios/**",
    "reference/**",
    ".agents/**",
    "coverage/**",
    "landing/vendor/**",
    "modules/react-native-enriched-markdown/**",
    "modules/enriched-markdown-web/**",
    "modules/react-native-screens/**",
  ]),
  {
    rules: {
      "import/order": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
