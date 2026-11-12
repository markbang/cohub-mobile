/**
 * Builds the browser version of the app as a Cohub App: a static site whose address is only known when it is
 * served (`works.cohub.live/w/<space>/<app>/<publish>/content/index.html`), and that host serves only real
 * files, so a reload of `/content/chat/<id>` would 404. Expo writes absolute URLs, so the export uses a
 * placeholder base and this script makes it relative to the page:
 * - JS: file URLs and the router's base start at `__cohubBase`, the page's directory. Routes are kept in the
 *   hash (`src/platform/app-history-adapter.ts`); a script after the asset tags, which have already resolved
 *   against the real address, turns a hash route back into a path for the router's first read.
 * - CSS: URLs become relative to the stylesheet; HTML: relative to index.html.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const PLACEHOLDER = "/__cohub_base__";
const out = process.argv[2] ?? "dist-web";

rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["expo", "export", "--platform", "web", "--output-dir", out], {
  stdio: "inherit",
  env: { ...process.env, COHUB_WEB_BASE: PLACEHOLDER },
});

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});

const BOOT = `<script>var __cohubBase=location.pathname.replace(/\\/[^/]*$/,"");history.replaceState(history.state,"",/^#\\//.test(location.hash)?__cohubBase+location.hash.slice(1):__cohubBase+"/"+location.search);</script>`;

let rewritten = 0;
for (const path of files(out)) {
  if (!/\.(js|css|html)$/.test(path)) continue;
  const source = readFileSync(path, "utf8");
  if (!source.includes(PLACEHOLDER)) continue;
  let next;
  if (path.endsWith(".js")) {
    // The embedded app config is a JSON string; no code reads its baseUrl at runtime.
    next = source.replaceAll(`\\"${PLACEHOLDER}\\"`, '\\"\\"').replaceAll(`"${PLACEHOLDER}`, '__cohubBase+"').replaceAll(`'${PLACEHOLDER}`, "__cohubBase+'").replaceAll(`\`${PLACEHOLDER}`, "__cohubBase+`");
  } else if (path.endsWith(".css")) {
    const up = relative(dirname(path), out) || ".";
    next = source.replaceAll(PLACEHOLDER, up);
  } else {
    next = source.replaceAll(`${PLACEHOLDER}/`, "./").replace("</body>", `${BOOT}</body>`);
    if (!next.includes(BOOT)) throw new Error(`${path} has no </body> to put the boot script before.`);
  }
  if (next.includes(PLACEHOLDER)) throw new Error(`${path} still has the base placeholder in a form this script does not rewrite.`);
  writeFileSync(path, next);
  if (path.endsWith(".js")) execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  rewritten += 1;
}
const count = files(out).length;
if (count > 1000) throw new Error(`${count} files; a Cohub App directory holds at most 1000.`);
console.log(`Web App in ${out}: ${count} files, ${rewritten} rewritten for a relative base.`);
