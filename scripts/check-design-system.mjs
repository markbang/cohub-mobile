/**
 * Keeps app code on the design system (docs/design-system.md): visual values come from tokens and
 * reach components through className. A line may opt out with a `design-system:` comment on it or
 * on the line above, and a block with `design-system-begin:` ... `design-system-end`, each stating
 * why a native prop needs a JS value. StyleSheet stays allowed for exact, measured layout values.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  { name: "color literal", pattern: /#[0-9a-fA-F]{3,8}\b|rgba?\(/, fix: "use a color token class, or a palette entry in src/design/tokens.ts" },
  { name: "typography spread into a style", pattern: /\[\s*typography\.\w+\s*[,\]]|style=\{typography\.\w+\}/, fix: "use a text-* class" },
  { name: "theme color in a style", pattern: /\b(backgroundColor|borderColor|borderBottomColor|borderTopColor|borderLeftColor|color|shadowColor):\s*theme\.colors\.\w+/, fix: "use a bg-/border-/text- token class" },
  { name: "pressed style function", pattern: /style=\{\(\{ pressed \}\) =>/, fix: "use active: and disabled: classes" },
];

// The token source, the palette compiler, and the theme store that reads them.
const EXEMPT = [/^src\/design\//, /^src\/data\/config-theme\.ts$/, /^src\/theme\.ts$/];

const files = execFileSync("git", ["ls-files", "app", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.tsx?$/.test(file) && !EXEMPT.some((pattern) => pattern.test(file)));

const violations = [];
const exemptOpen = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  let exempt = false;
  lines.forEach((line, index) => {
    if (/design-system-begin:/.test(line)) exempt = true;
    if (/design-system-end/.test(line)) { exempt = false; return; }
    if (exempt) return;
    if (/design-system:/.test(line) || /design-system:/.test(lines[index - 1] ?? "")) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) violations.push(`${file}:${index + 1}  ${rule.name} — ${rule.fix}`);
    }
  });
  if (exempt) exemptOpen.push(file);
}

if (exemptOpen.length) {
  console.error(`Unclosed design-system-begin in:\n${exemptOpen.join("\n")}`);
  process.exit(1);
}
if (violations.length) {
  console.error(`Design system violations (${violations.length}):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log(`Design system check passed for ${files.length} files.`);
