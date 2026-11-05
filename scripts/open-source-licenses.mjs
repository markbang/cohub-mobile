/**
 * Writes src/data/open-source-licenses.json from the installed runtime dependencies so the About
 * screen lists what ships in the app, with each package's full license text. `--check` fails when
 * the committed file is stale (CI Quality runs it).
 * Regenerate with `node scripts/open-source-licenses.mjs` after changing dependencies.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const TARGET = fileURLToPath(new URL("src/data/open-source-licenses.json", root));
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

// The npm tarball omits the license file; the text is copied from the upstream repository.
const LICENSE_TEXT_OVERRIDES = {
  "@lobehub/icons-rn": "scripts/license-texts/lobehub-icons-rn.txt",
};

function repository(name, manifest) {
  const field = typeof manifest.repository === "string" ? { url: manifest.repository } : manifest.repository;
  if (!field?.url) throw new Error(`${name} has no repository field; add its URL to scripts/open-source-licenses.mjs`);
  const url = field.url
    .replace(/^git\+/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  if (!url.startsWith("https://")) throw new Error(`${name} has an unsupported repository URL: ${field.url}`);
  return { root: url, url: field.directory ? `${url}/tree/HEAD/${field.directory}` : url };
}

function readLicenseText(name) {
  if (LICENSE_TEXT_OVERRIDES[name]) return readFileSync(new URL(LICENSE_TEXT_OVERRIDES[name], root), "utf8");
  const file = readdirSync(new URL(`node_modules/${name}/`, root)).find((entry) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(entry));
  return file ? readFileSync(new URL(`node_modules/${name}/${file}`, root), "utf8") : null;
}

const { dependencies } = readJson("package.json");
const installed = Object.keys(dependencies).sort().map((name) => {
  const manifest = readJson(`node_modules/${name}/package.json`);
  if (!manifest.license) throw new Error(`${name} declares no license`);
  return { name, version: manifest.version, license: manifest.license, ...repository(name, manifest), licenseText: readLicenseText(name) };
});

// Monorepo packages (Expo) often ship without a license file; the repository's license covers them.
const textByRepository = new Map(installed.filter((item) => item.licenseText).map((item) => [item.root, item.licenseText]));
const packages = installed.map(({ root: repositoryRoot, licenseText, ...item }) => ({
  ...item,
  licenseText: (licenseText ?? textByRepository.get(repositoryRoot) ?? null)?.replace(/\r\n/g, "\n").trim() ?? null,
}));

// Assets shipped in the bundle rather than through npm.
const BUNDLED_ASSETS = [
  { name: "Inter (font, Android)", version: "4.1", license: "OFL-1.1", url: "https://github.com/rsms/inter", licenseText: readFileSync(new URL("assets/fonts/Inter-LICENSE.txt", root), "utf8").replace(/\r\n/g, "\n").trim() },
  { name: "Framework7 Icons (glyphs, Android)", version: "5.0.5", license: "MIT", url: "https://github.com/framework7io/framework7-icons", licenseText: readFileSync(new URL("scripts/license-texts/framework7-icons.txt", root), "utf8").replace(/\r\n/g, "\n").trim() },
];
packages.push(...BUNDLED_ASSETS);

const transitive = new Set();
for (const [path, entry] of Object.entries(readJson("package-lock.json").packages)) {
  if (!path.startsWith("node_modules/") || entry.dev || entry.devOptional || entry.link) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!(name in dependencies)) transitive.add(name);
}

const output = `${JSON.stringify({ transitiveCount: transitive.size, packages }, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(TARGET, "utf8") !== output) {
    console.error("src/data/open-source-licenses.json is stale. Run `node scripts/open-source-licenses.mjs`.");
    process.exit(1);
  }
  console.log("Open-source license list is up to date.");
} else {
  writeFileSync(TARGET, output);
  const missing = packages.filter((item) => !item.licenseText).map((item) => item.name);
  console.log(`Wrote ${packages.length} packages (${transitive.size} transitive) to src/data/open-source-licenses.json.`);
  if (missing.length) console.log(`No license text shipped by: ${missing.join(", ")}`);
}
