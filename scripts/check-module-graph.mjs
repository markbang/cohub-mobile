/**
 * Keeps the module boundaries in AGENTS.md checkable: local native modules are reached only through
 * `src/platform/`, `reference/` is never imported, and no runtime import cycle exists on either
 * platform. Metro initializes a cycle's modules in import order, so a cycle can hand one of them
 * `undefined` exports at startup. Type-only imports and dynamic `import()` are erased or deferred, so
 * neither creates a cycle.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLATFORM_EXTENSIONS = {
  ios: [".ios.tsx", ".ios.ts", ".native.tsx", ".native.ts", ".tsx", ".ts"],
  android: [".android.tsx", ".android.ts", ".native.tsx", ".native.ts", ".tsx", ".ts"],
};
// Local Expo modules that only `src/platform/` may import at runtime; their types are the shared spec.
const NATIVE_MODULES = ["cohub-device-runtime", "cohub-chat-timeline"];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts") && existsSync(path.join(ROOT, file)));

function runtimeImports(file) {
  const source = ts.createSourceFile(file, readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
  const imports = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const typeOnly = clause?.isTypeOnly
        || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly));
      imports.push({ specifier: statement.moduleSpecifier.text, runtime: !typeOnly });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const typeOnly = statement.isTypeOnly
        || (statement.exportClause && ts.isNamedExports(statement.exportClause)
          && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every((element) => element.isTypeOnly));
      imports.push({ specifier: statement.moduleSpecifier.text, runtime: !typeOnly });
    }
  }
  return imports;
}

function resolve(from, specifier, extensions) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, from)), specifier);
  else return null;
  for (const candidate of [base, ...extensions.map((ext) => base + ext), ...extensions.map((ext) => path.join(base, `index${ext}`))]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return path.relative(ROOT, candidate);
  }
  return null;
}

const violations = [];
const parsed = new Map(files.map((file) => [file, runtimeImports(file)]));

for (const [file, imports] of parsed) {
  for (const { specifier, runtime } of imports) {
    const target = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), specifier)) : specifier;
    if (/^(?:\.\.\/)*reference(?:\/|$)/.test(target)) violations.push(`${file}  imports ${specifier} — reference/ is read-only upstream source, not app code`);
    const nativeModule = NATIVE_MODULES.find((name) => target === name || target.startsWith(`${name}/`) || target.startsWith(`modules/${name}`));
    if (nativeModule && runtime && !file.startsWith("src/platform/")) violations.push(`${file}  imports ${specifier} — reach ${nativeModule} through src/platform/`);
  }
}

for (const [platform, extensions] of Object.entries(PLATFORM_EXTENSIONS)) {
  const other = platform === "ios" ? ".android." : ".ios.";
  const graph = new Map();
  for (const [file, imports] of parsed) {
    if (file.includes(other)) continue;
    graph.set(file, imports.filter((entry) => entry.runtime).map((entry) => resolve(file, entry.specifier, extensions)).filter(Boolean));
  }
  // Tarjan's strongly connected components; each component with more than one module is a cycle.
  let index = 0;
  const stack = [];
  const state = new Map();
  const cycles = [];
  const visit = (file) => {
    state.set(file, { index, low: index, onStack: true });
    index += 1;
    stack.push(file);
    for (const next of graph.get(file) ?? []) {
      if (!graph.has(next)) continue;
      if (!state.has(next)) {
        visit(next);
        state.get(file).low = Math.min(state.get(file).low, state.get(next).low);
      } else if (state.get(next).onStack) {
        state.get(file).low = Math.min(state.get(file).low, state.get(next).index);
      }
    }
    if (state.get(file).low !== state.get(file).index) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      state.get(member).onStack = false;
      component.push(member);
    } while (member !== file);
    if (component.length > 1 || (graph.get(file) ?? []).includes(file)) cycles.push(component.sort());
  };
  for (const file of graph.keys()) if (!state.has(file)) visit(file);
  for (const cycle of cycles) violations.push(`${platform}: import cycle through ${cycle.join(" → ")}`);
}

if (violations.length) {
  console.error(`Module graph violations (${violations.length}):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log(`Module graph check passed for ${files.length} files.`);
