import { generate, parse, walk, List, type CssNode } from "css-tree";
import {
  parse as parseColor, formatHex8, converter, interpolateWithPremultipliedAlpha,
  fixupHueShorter, fixupHueLonger, fixupHueIncreasing, fixupHueDecreasing,
  type Color, type Mode,
} from "culori";
import type { AppTheme } from "../theme";

type Colors = AppTheme["colors"];
type Scheme = AppTheme["mode"];
export const CONFIG_THEME_PATH = ".cohub/theme.css";
export const MAX_THEME_CSS_LENGTH = 262_144;

const COLOR_TOKENS = {
  background: "bg-primary", surface: "bg-surface", surfaceRaised: "bg-elevated",
  surfacePressed: "bg-active", surfaceFloat: "bg-elevated", pressOverlay: "overlay-control-bg", border: "border-primary",
  borderStrong: "border-strong", text: "text-primary", textSecondary: "text-secondary",
  textMuted: "text-tertiary", textFaint: "text-placeholder", accent: "brand",
  accentPressed: "brand-hover", accentSoft: "brand-soft", accentBorder: "brand-border",
  accentText: "brand-contrast-fg", userBubble: "chat-user-message-bg", userBubbleText: "chat-user-message-fg",
  userBubbleLink: "chat-user-message-link", userBubbleCodeBackground: "chat-user-message-code-bg",
  userBubbleMeta: "chat-user-message-meta", assistantBubble: "chat-assistant-message-bg", assistantBubbleText: "chat-assistant-message-fg",
  success: "success-400", successSoft: "success-900", warning: "warning-400",
  warningSoft: "warning-900", danger: "error-400", dangerSoft: "error-900",
  dangerText: "error-fg", info: "info-400", infoSoft: "info-900", shadow: "shadow-strong",
} satisfies Record<keyof Colors, string>;

const MIX_MODES: Record<string, Mode> = {
  srgb: "rgb", "srgb-linear": "lrgb", oklab: "oklab", oklch: "oklch", lab: "lab", lch: "lch",
  hsl: "hsl", hwb: "hwb", "display-p3": "p3", "a98-rgb": "a98", "prophoto-rgb": "prophoto",
  rec2020: "rec2020", xyz: "xyz65", "xyz-d65": "xyz65", "xyz-d50": "xyz50",
};
const HUE_FIXUPS = { shorter: fixupHueShorter, longer: fixupHueLonger, increasing: fixupHueIncreasing, decreasing: fixupHueDecreasing };

type Declaration = { value: string; important: boolean; specificity: number };
export type ConfigThemePalette = { light: Partial<Colors>; dark: Partial<Colors>; warnings: string[] };

function selectorSpecificity(node: CssNode, mode: Scheme | null): number | null {
  if (node.type === "SelectorList") {
    const matches = node.children.toArray().map((child) => selectorSpecificity(child, mode)).filter((value): value is number => value !== null);
    return matches.length ? Math.max(...matches) : null;
  }
  if (node.type === "Selector") {
    let score = 0;
    for (const child of node.children) {
      const value = selectorSpecificity(child, mode);
      if (value === null) return null;
      score += value;
    }
    return score;
  }
  if (node.type === "TypeSelector") return node.name === "html" ? 1 : node.name === "*" ? 0 : null;
  if (node.type === "AttributeSelector" && node.name.name === "data-theme") {
    if (node.matcher === null) return 1000;
    const value = node.value?.type === "String" ? node.value.value : node.value?.name;
    return node.matcher === "=" && (mode === null || value === mode) ? 1000 : null;
  }
  if (node.type === "PseudoClassSelector") {
    if (node.name === "root") return 1000;
    if (["where", "is", "not"].includes(node.name) && node.children?.first) {
      const score = selectorSpecificity(node.children.first, mode);
      const maximum = selectorSpecificity(node.children.first, null);
      if (node.name === "not") return mode === null ? maximum : score === null ? maximum : null;
      return score === null ? null : node.name === "where" ? 0 : maximum;
    }
  }
  return null;
}

function mediaMatches(query: string, mode: Scheme): boolean | null {
  const conditions = query.toLowerCase().split(",").map((part) => part.trim());
  const results = conditions.map((condition) => {
    const match = /^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(prefers-color-scheme:\s*(light|dark)\)$/.exec(condition);
    return match ? match[1] === mode : null;
  });
  return results.some((value) => value === true) ? true : results.some((value) => value === null) ? null : false;
}

function declarationsFor(ast: CssNode, mode: Scheme, warnings: Set<string>): Map<string, Declaration> {
  const declarations = new Map<string, Declaration>();
  const visit = (nodes: List<CssNode>) => {
    for (const node of nodes) {
      if (node.type === "Atrule") {
        if (node.name === "media" && node.prelude && node.block) {
          const matches = mediaMatches(generate(node.prelude), mode);
          if (matches === true) visit(node.block.children);
          if (matches === null) warnings.add("Only prefers-color-scheme media queries are supported.");
        } else if (node.name !== "charset") {
          warnings.add(`@${node.name} rules are not applied on mobile.`);
        }
      }
      if (node.type !== "Rule" || node.prelude.type !== "SelectorList") continue;
      const specificity = selectorSpecificity(node.prelude, mode);
      if (specificity === null) continue;
      for (const declaration of node.block.children) {
        if (declaration.type !== "Declaration" || !declaration.property.startsWith("--")) continue;
        const previous = declarations.get(declaration.property);
        if (previous && (previous.important && !declaration.important || previous.important === declaration.important && previous.specificity > specificity)) continue;
        declarations.set(declaration.property, { value: generate(declaration.value), important: Boolean(declaration.important), specificity });
      }
    }
  };
  if (ast.type === "StyleSheet") visit(ast.children);
  return declarations;
}

function splitArguments(value: string): string[] {
  const ast = parse(value, { context: "value" });
  if (ast.type !== "Value") return [];
  const parts: CssNode[][] = [[]];
  for (const node of ast.children) {
    if (node.type === "Operator" && node.value === ",") parts.push([]);
    else parts[parts.length - 1].push(node);
  }
  return parts.map((children) => generate({ type: "Value", children: new List<CssNode>().fromArray(children) }));
}

function readColor(value: string, mode: Scheme, depth = 0): Color | undefined {
  if (depth > 32) return undefined;
  value = value.trim().toLowerCase();
  if (value.startsWith("light-dark(")) {
    const parts = splitArguments(value.slice(11, -1));
    return parts.length === 2 ? readColor(parts[mode === "light" ? 0 : 1], mode, depth + 1) : undefined;
  }
  if (!value.startsWith("color-mix(")) return parseColor(value);
  const parts = splitArguments(value.slice(10, -1));
  if (parts.length !== 3) return undefined;
  const header = /^in\s+([\w-]+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/.exec(parts[0]);
  if (!header || !MIX_MODES[header[1]]) return undefined;
  const stops = parts.slice(1).map((part) => {
    const match = /\s+([\d.]+)%$/.exec(part);
    const color = readColor(match ? part.slice(0, match.index) : part, mode, depth + 1);
    return { color, weight: match ? Number(match[1]) / 100 : null };
  });
  if (!stops[0].color || !stops[1].color) return undefined;
  const a = stops[0].weight ?? (stops[1].weight === null ? 0.5 : 1 - stops[1].weight);
  const b = stops[1].weight ?? 1 - a;
  if (a < 0 || b < 0 || a > 1 || b > 1 || a + b === 0) return undefined;
  const fixup = header[2] ? HUE_FIXUPS[header[2] as keyof typeof HUE_FIXUPS] : fixupHueShorter;
  const mixMode = MIX_MODES[header[1]];
  const polarMode = mixMode === "hsl" || mixMode === "hwb" || mixMode === "lch" || mixMode === "oklch";
  if (header[2] && !polarMode) return undefined;
  const color = polarMode
    ? interpolateWithPremultipliedAlpha([stops[0].color, stops[1].color], mixMode, { h: { fixup } })(b / (a + b))
    : interpolateWithPremultipliedAlpha([stops[0].color, stops[1].color], mixMode)(b / (a + b));
  return { ...color, alpha: (color.alpha ?? 1) * Math.min(1, a + b) };
}

function baselineVariables(colors: Colors, mode: Scheme): Map<string, string> {
  const variables = new Map<string, string>();
  for (const [key, token] of Object.entries(COLOR_TOKENS)) variables.set(`--${token}`, colors[key as keyof Colors]);
  const neutralRoles: Record<string, keyof Colors> = mode === "dark"
    ? { "0": "text", "5": "text", "10": "textSecondary", "20": "textMuted", "30": "textFaint", "40": "textFaint", "50": "borderStrong", "60": "surfaceRaised", "70": "surfacePressed", "80": "surface", "90": "surface", "95": "background", "100": "background" }
    : { "0": "text", "5": "text", "10": "textSecondary", "20": "textMuted", "30": "textFaint", "40": "borderStrong", "50": "border", "60": "border", "70": "surfaceRaised", "80": "surfacePressed", "90": "surface", "95": "background", "100": "background" };
  for (const [level, key] of Object.entries(neutralRoles)) variables.set(`--neutral-${level}`, colors[key]);
  for (const [token, level] of Object.entries({
    "text-primary": "0", "text-reading": "5", "text-secondary": "10", "text-tertiary": "20", "text-placeholder": "30", "text-disabled": "40",
    "bg-primary": mode === "dark" ? "95" : "100", "bg-content": mode === "dark" ? "90" : "95",
    "bg-surface": mode === "dark" ? "80" : "90", "bg-elevated": mode === "dark" ? "60" : "100",
    "border-primary": mode === "dark" ? "60" : "50", "border-strong": mode === "dark" ? "50" : "40",
  })) variables.set(`--${token}`, `var(--neutral-${level})`);
  const contrast = mode === "dark" ? "0" : "100";
  variables.set("--brand-contrast-fg", `var(--neutral-${contrast})`);
  variables.set("--error-fg", `var(--neutral-${contrast})`);
  variables.set("--bg-hover", colors.surfacePressed);
  variables.set("--brand-400", colors.accent);
  variables.set("--brand-500", colors.accentPressed);
  variables.set("--brand-700", colors.accentSoft);
  variables.set("--brand-900", colors.accentSoft);
  variables.set("--brand", "var(--brand-400)");
  variables.set("--brand-hover", "var(--brand-500)");
  variables.set("--brand-soft", "var(--brand-700)");
  variables.set("--success-500", colors.success);
  variables.set("--warning-500", colors.warning);
  variables.set("--error-500", colors.danger);
  variables.set("--info-500", colors.info);
  const aliases = {
    "bg-input": "bg-surface", "bg-active": "bg-hover", "bg-surface-hover": "bg-hover",
    "border-default": "border-primary", "border-subtle": "border-primary",
  };
  for (const [token, target] of Object.entries(aliases)) variables.set(`--${token}`, `var(--${target})`);
  variables.set("--bg-code", mode === "dark" ? "var(--neutral-100)" : "var(--neutral-90)");
  variables.set("--text-reading", "var(--neutral-5)");
  variables.set("--text-disabled", "var(--neutral-40)");
  // Bubble roles use shared host semantics only when a custom theme changes those semantics.
  variables.set("--chat-user-message-bg", "var(--brand)");
  variables.set("--chat-user-message-fg", "var(--brand-contrast-fg)");
  variables.set("--chat-user-message-link", "var(--chat-user-message-fg)");
  variables.set("--chat-user-message-meta", "color-mix(in srgb,var(--chat-user-message-fg) 88%,transparent)");
  variables.set("--chat-user-message-code-bg", "color-mix(in srgb,var(--bg-primary) 24%,transparent)");
  variables.set("--chat-assistant-message-bg", "var(--bg-content)");
  variables.set("--chat-assistant-message-fg", "var(--text-reading)");
  variables.set("--brand-border", "color-mix(in srgb,var(--brand) 20%,transparent)");
  for (const family of ["success", "warning", "error", "info"]) {
    variables.set(`--${family}-900`, `color-mix(in srgb,var(--${family}-400) ${mode === "dark" ? 18 : 10}%,var(--bg-primary))`);
  }
  return variables;
}

type ResolvedVariable = { value: string; changed: boolean };

function resolveVariables(value: string, variables: Map<string, string>, custom: Set<string>, path: Set<string>, memo: Map<string, ResolvedVariable>): ResolvedVariable {
  if (path.size > 32) throw new Error("Theme variables exceed the nesting limit.");
  const ast = parse(value, { context: "value" });
  let changed = false;
  walk(ast, {
    visit: "Function",
    enter(node, item, list) {
      if (node.name.toLowerCase() !== "var") return;
      const parts = splitArguments(generate(node).slice(4, -1));
      const name = parts[0];
      const stored = variables.get(name);
      if (path.has(name)) throw new Error("Theme variables contain a cycle.");
      if (stored === undefined && parts.length < 2) throw new Error(`Theme variable ${name} is not defined.`);
      const resolved = stored === undefined
        ? resolveVariables(parts.slice(1).join(","), variables, custom, new Set([...path, name]), memo)
        : memo.get(name) ?? resolveVariables(stored, variables, custom, new Set([...path, name]), memo);
      if (stored !== undefined) memo.set(name, resolved);
      changed ||= custom.has(name) || resolved.changed;
      const replacement = parse(resolved.value, { context: "value" });
      if (replacement.type !== "Value") throw new Error("Invalid theme variable.");
      list.replace(item, replacement.children);
      return this.skip;
    },
  });
  const expanded = generate(ast);
  if (expanded.length > MAX_THEME_CSS_LENGTH) throw new Error("Expanded theme value is too large.");
  return { value: expanded, changed };
}

export function colorWithOpacity(value: string, opacity: number): string {
  const rgb = converter("rgb")(value);
  if (!rgb) throw new Error("Invalid theme color. Refresh the Config theme or disable custom colors.");
  return formatHex8({ ...rgb, alpha: (rgb.alpha ?? 1) * opacity });
}

export function compileConfigTheme(css: string, bases: { light: Colors; dark: Colors }): ConfigThemePalette {
  if (css.length > MAX_THEME_CSS_LENGTH) throw new Error("Config theme.css exceeds 256 KiB. Reduce its size to apply it on mobile.");
  const ast = parse(css, { onParseError: () => { throw new Error("Invalid Config theme.css syntax. Fix the stylesheet and retry."); } });
  const warnings = new Set<string>();
  const compile = (mode: Scheme): Partial<Colors> => {
    const declarations = declarationsFor(ast, mode, warnings);
    const variables = baselineVariables(bases[mode], mode);
    for (const [name, declaration] of declarations) variables.set(name, declaration.value);
    const custom = new Set(declarations.keys());
    const colors: Partial<Colors> = {};
    const memo = new Map<string, ResolvedVariable>();
    for (const [key, token] of Object.entries(COLOR_TOKENS)) {
      try {
        const resolved = resolveVariables(`var(--${token})`, variables, custom, new Set(), memo);
        if (!resolved.changed) continue;
        const color = readColor(resolved.value, mode);
        const rgb = color ? converter("rgb")(color) : undefined;
        if (!rgb || ![rgb.r, rgb.g, rgb.b, rgb.alpha ?? 1].every(Number.isFinite)) throw new Error("Unsupported color expression.");
        colors[key as keyof Colors] = formatHex8(rgb);
      } catch {
        warnings.add(`--${token} could not be applied in ${mode} mode.`);
      }
    }
    return colors;
  };
  const light = compile("light");
  const dark = compile("dark");
  if (!Object.keys(light).length && !Object.keys(dark).length && css.trim()) warnings.add("No supported root color tokens were found in Config theme.css.");
  return { light, dark, warnings: [...warnings] };
}
