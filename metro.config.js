const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);
const lucideRoot = path.join(__dirname, "node_modules/lucide-react-native");
const defaultResolveRequest = config.resolver.resolveRequest;

// The browser build (`scripts/web-app.mjs`) swaps modules that have no web side.
const WEB_MODULES = {
  "react-native-enriched-markdown": path.join(__dirname, "modules/enriched-markdown-web/index.tsx"),
  "expo-sqlite": path.join(__dirname, "src/platform/sqlite.web.ts"),
};
// expo-router internals the browser build swaps, by the end of the path expo-router imports them with.
const ROUTER_MODULES = {
  "/global-state/browserHistoryAdapter": path.join(__dirname, "src/platform/app-history-adapter.ts"),
  "/useLinkToPathProps": path.join(__dirname, "src/platform/app-link-props.ts"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web") {
    if (Object.hasOwn(WEB_MODULES, moduleName)) return { filePath: WEB_MODULES[moduleName], type: "sourceFile" };
    const swap = Object.keys(ROUTER_MODULES).find((suffix) => moduleName.endsWith(suffix));
    if (swap && context.originModulePath.includes(`${path.sep}expo-router${path.sep}`)) return { filePath: ROUTER_MODULES[swap], type: "sourceFile" };
  }
  if (moduleName === "lucide-react-native") {
    return { filePath: path.join(lucideRoot, "dist/cjs/lucide-react-native.js"), type: "sourceFile" };
  }
  if (moduleName.startsWith("lucide-react-native/icons/")) {
    const icon = moduleName.slice("lucide-react-native/icons/".length);
    const filePath = path.join(lucideRoot, "dist/cjs/icons", `${icon}.js`);
    // Lucide keeps type stubs for renamed icons, so typecheck passes while the runtime file is gone.
    if (!fs.existsSync(filePath)) {
      throw new Error(`lucide-react-native has no runtime icon "${icon}"; it was likely renamed. Find its new file in node_modules/lucide-react-native/dist/cjs/icons.`);
    }
    return { filePath, type: "sourceFile" };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

const uniwindConfig = withUniwindConfig(config, { cssEntryFile: "./global.css", dtsFile: "./uniwind-types.d.ts" });

// Uniwind swaps `react-native` for its own module, which re-exports a fixed list that lacks React Native
// 0.88's `AssetRegistry`. expo-asset imports it from there, so every `require()`d asset loaded through it
// (fonts in `useFonts`) failed with "Cannot read property 'getAssetByID' of undefined". expo-asset styles
// no components, so it gets React Native itself.
const uniwindResolveRequest = uniwindConfig.resolver.resolveRequest;
const UNSWAPPED_ORIGINS = [`${path.sep}node_modules${path.sep}expo-asset${path.sep}`];
uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native" && UNSWAPPED_ORIGINS.some((origin) => context.originModulePath.includes(origin))) {
    return context.resolveRequest(context, moduleName, platform);
  }
  return uniwindResolveRequest(context, moduleName, platform);
};

module.exports = uniwindConfig;
