import { spawnSync } from "node:child_process";
import process from "node:process";

// High/critical advisories with no patched release, accepted only because the
// vulnerable package runs in build tooling and never ships in the app bundle.
// Remove an entry as soon as upstream publishes a fix; stale entries fail the check.
const accepted = new Map([
  [
    "GHSA-vfj7-8cjw-p6xm",
    "braces <=3.0.3 (no fix): Metro file-map glob matching on developer-controlled patterns at build time.",
  ],
  [
    "GHSA-86w9-cpqp-85rv",
    "node-forge <=1.4.0 (no fix): Expo CLI and expo-updates CLI code-signing tooling; native runtimes verify updates without node-forge.",
  ],
]);
const failingSeverities = new Set(["high", "critical"]);

const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("npm audit did not return JSON.");
  console.error(result.stderr || result.stdout);
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !failingSeverities.has(via.severity)) continue;
    const id = via.url.split("/").pop();
    advisories.set(id, `${via.severity} ${via.name} ${via.range}: ${via.title} (${via.url})`);
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
  console.error("Update the affected dependency (for example `npm update <package>`) and rerun.");
}
if (stale.length > 0 || unaccepted.length > 0) process.exit(1);
console.log("No unaccepted high or critical advisories in production dependencies.");
