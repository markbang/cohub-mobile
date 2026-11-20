import { readFileSync } from "node:fs";

const lock = Bun.JSONC.parse(readFileSync(new URL("../bun.lock", import.meta.url), "utf8"));

// Lock keys nest like node_modules: `metro/accepts` is the copy metro resolves before the hoisted `accepts`.
const segments = (key) => key.split("/").reduce((names, part) => {
  if (names.at(-1)?.startsWith("@") && !names.at(-1).includes("/")) names[names.length - 1] += `/${part}`;
  else names.push(part);
  return names;
}, []);

function findKey(fromKey, name) {
  const scope = fromKey ? segments(fromKey) : [];
  for (let depth = scope.length; depth >= 0; depth -= 1) {
    const key = [...scope.slice(0, depth), name].join("/");
    if (lock.packages[key]) return key;
  }
  return null;
}

function resolveKey(fromKey, name) {
  const key = findKey(fromKey, name);
  if (!key) throw new Error(`bun.lock does not resolve ${name} from ${fromKey || "the root"}; run bun install`);
  return key;
}

function describe(key) {
  const [ident, , meta = {}] = lock.packages[key];
  const name = ident.replace(/(.)@.*$/, "$1");
  const workspace = /@workspace:(.+)$/.exec(ident)?.[1];
  const info = workspace ? lock.workspaces[workspace] : meta;
  return { name, version: workspace ? info.version : ident.slice(name.length + 1), info };
}

/**
 * Every package bun.lock installs for the given runtime dependencies, following dependencies,
 * optional dependencies, and peers. Packages reachable only through devDependencies are excluded.
 * Optional peers count once installed, as npm counted them.
 */
export function runtimePackages(dependencies) {
  const packages = new Map();
  const pending = dependencies.map((name) => resolveKey("", name));
  while (pending.length) {
    const key = pending.pop();
    if (packages.has(key)) continue;
    const { name, version, info } = describe(key);
    packages.set(key, { name, version });
    const optionalPeers = new Set(info.optionalPeers ?? []);
    const peers = Object.keys(info.peerDependencies ?? {}).filter((peer) => !optionalPeers.has(peer) || findKey(key, peer));
    for (const dependency of [...Object.keys(info.dependencies ?? {}), ...Object.keys(info.optionalDependencies ?? {}), ...peers]) {
      pending.push(resolveKey(key, dependency));
    }
  }
  return [...packages.values()];
}
