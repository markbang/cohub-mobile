import type { LucideIconData } from "lucide-react-native";
import { __iconData as alert } from "lucide-react-native/icons/circle-alert";
import { __iconData as archive } from "lucide-react-native/icons/archive";
import { __iconData as bookOpen } from "lucide-react-native/icons/book-open";
import { __iconData as brain } from "lucide-react-native/icons/brain";
import { __iconData as check } from "lucide-react-native/icons/check";
import { __iconData as checkCheck } from "lucide-react-native/icons/check-check";
import { __iconData as chevronDown } from "lucide-react-native/icons/chevron-down";
import { __iconData as chevronRight } from "lucide-react-native/icons/chevron-right";
import { __iconData as chevronsDown } from "lucide-react-native/icons/chevrons-down";
import { __iconData as chevronsUp } from "lucide-react-native/icons/chevrons-up";
import { __iconData as code } from "lucide-react-native/icons/code";
import { __iconData as copy } from "lucide-react-native/icons/copy";
import { __iconData as fileText } from "lucide-react-native/icons/file-text";
import { __iconData as folder } from "lucide-react-native/icons/folder";
import { __iconData as gitFork } from "lucide-react-native/icons/git-fork";
import { __iconData as globe } from "lucide-react-native/icons/globe";
import { __iconData as images } from "lucide-react-native/icons/images";
import { __iconData as refresh } from "lucide-react-native/icons/refresh-cw";
import { __iconData as search } from "lucide-react-native/icons/search";
import { __iconData as squarePen } from "lucide-react-native/icons/square-pen";
import { __iconData as terminal } from "lucide-react-native/icons/terminal";
import { __iconData as trash } from "lucide-react-native/icons/trash";
import type { IconName } from "@/src/icons";

/** The glyphs the native timeline draws, by the app's icon names. */
const ICONS = {
  alert, archive, "book-open": bookOpen, brain, check, "check-check": checkCheck, "chevron-down": chevronDown,
  "chevron-right": chevronRight, "chevrons-down": chevronsDown, "chevrons-up": chevronsUp, code, copy,
  "file-text": fileText, folder, "git-fork": gitFork, globe, images, refresh, search, "square-pen": squarePen, terminal, trash,
} satisfies Partial<Record<IconName, LucideIconData>>;

export type TimelineIconName = keyof typeof ICONS;

const num = (value: unknown) => Number(value ?? 0);

/** One SVG element as path data, which is all the native vector view draws. */
function elementPath(tag: string, attrs: Record<string, unknown>): string | null {
  switch (tag) {
    case "path":
      return typeof attrs.d === "string" ? attrs.d : null;
    case "line":
      return `M${num(attrs.x1)} ${num(attrs.y1)}L${num(attrs.x2)} ${num(attrs.y2)}`;
    case "circle": {
      const cx = num(attrs.cx), cy = num(attrs.cy), r = num(attrs.r);
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    case "ellipse": {
      const cx = num(attrs.cx), cy = num(attrs.cy), rx = num(attrs.rx), ry = num(attrs.ry);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case "rect": {
      const x = num(attrs.x), y = num(attrs.y), w = num(attrs.width), h = num(attrs.height);
      const rx = Math.min(num(attrs.rx ?? attrs.ry), w / 2), ry = Math.min(num(attrs.ry ?? attrs.rx), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    case "polyline":
    case "polygon": {
      const points = String(attrs.points ?? "").trim().split(/[\s,]+/).map(Number);
      if (points.length < 4) return null;
      let d = `M${points[0]} ${points[1]}`;
      for (let index = 2; index + 1 < points.length; index += 2) d += `L${points[index]} ${points[index + 1]}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    default:
      return null;
  }
}

const cache = new Map<TimelineIconName, string[]>();

export function iconPaths(name: TimelineIconName): string[] {
  let paths = cache.get(name);
  if (!paths) {
    const data: LucideIconData = ICONS[name];
    paths = data.node.flatMap(([tag, attrs]) => {
      const d = elementPath(tag, attrs as Record<string, unknown>);
      return d ? [d] : [];
    });
    cache.set(name, paths);
  }
  return paths;
}
