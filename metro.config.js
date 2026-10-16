const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const lucideRoot = path.join(__dirname, "node_modules/lucide-react-native");
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
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

module.exports = config;
