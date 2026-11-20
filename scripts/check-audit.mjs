import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { runtimePackages } from "./bun-lock.mjs";

// High/critical advisories with no patched release, accepted only because the
// vulnerable package runs in build tooling and never ships in the app bundle.
// Remove an entry as soon as upstream publishes a fix; stale entries fail the check.
const accepted = new Map([
  [
    "GHSA-mrhx-c7xc-m3w5",
    "zod <4.6.6 (no 3.x fix): Expo CLI requires zod ^3.25.76; the app bundle ships only the SDK's nested zod 4.6.6.",
  ],
]);
const failingSeverities = new Set(["high", "critical"]);

const result = spawnSync(process.execPath, ["audit", "--json"], { encoding: "utf8" });
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("bun audit did not return JSON.");
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

// bun audit reports dev dependencies too; keep advisories matching an installed runtime package.
const { dependencies } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const runtime = runtimePackages(Object.keys(dependencies));
const advisories = new Map();
for (const [name, entries] of Object.entries(report)) {
  for (const advisory of entries) {
    if (!failingSeverities.has(advisory.severity)) continue;
    const installed = runtime.filter((item) => item.name === name && Bun.semver.satisfies(item.version, advisory.vulnerable_versions));
    if (installed.length === 0) continue;
    const id = advisory.url.split("/").pop();
    const versions = [...new Set(installed.map((item) => item.version))].join(", ");
    advisories.set(id, `${advisory.severity} ${name} ${versions} (${advisory.vulnerable_versions}): ${advisory.title} (${advisory.url})`);
  }
}

const unaccepted = [...advisories].filter(([id]) => !accepted.has(id));
const stale = [...accepted.keys()].filter((id) => !advisories.has(id));

for (const [id, reason] of accepted) {
  if (advisories.has(id)) console.log(`Accepted ${id}: ${reason}`);
}
if (stale.length > 0) {
  console.error(`Remove resolved advisories from scripts/check-audit.mjs: ${stale.join(", ")}`);
}
if (unaccepted.length > 0) {
  console.error("Production dependencies have high or critical advisories:");
  for (const [, summary] of unaccepted) console.error(`- ${summary}`);
  console.error("Update the affected dependency (for example `bun update <package>`) and rerun.");
}
if (stale.length > 0 || unaccepted.length > 0) process.exit(1);
console.log("No unaccepted high or critical advisories in production dependencies.");
