import type { ReactNode } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import { LIST_AVATAR_SIZE, RADIUS } from "@/src/design/tokens";
import { useTranslation } from "@/src/i18n";

/**
 * Skeletons trace the geometry of the content that replaces them (row height, leading shape,
 * card radius, insets), so the swap does not shift the layout. Pick the one matching the screen's
 * real content instead of falling back to the list-row shape.
 */

const CONTINUOUS = { borderCurve: "continuous" } as const;

const cycle = (index: number, widths: readonly DimensionValue[]) => widths[index % widths.length];

/** `onRaised` keeps bones visible on a `surface-raised` well, where the default fill would vanish. */
export function Bone({ width, height, radius = height / 2, onRaised = false }: { width: DimensionValue; height: number; radius?: number; onRaised?: boolean }) {
  return <View className={onRaised ? "bg-border" : "bg-surface-raised"} style={{ width, height, borderRadius: radius, ...CONTINUOUS }} />;
}

export function Skeleton({ children, className, style }: { children: ReactNode; className?: string; style?: object }) {
  const { t } = useTranslation();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} pointerEvents="none" className={className} style={style}>{children}</View>;
}

function Line({ width, lineHeight, height }: { width: DimensionValue; lineHeight: number; height: number }) {
  return <View className="justify-center" style={{ height: lineHeight }}><Bone width={width} height={height} /></View>;
}

export function LoadingRows({ count = 5 }: { count?: number }) {
  return <Skeleton>{Array.from({ length: count }, (_, index) => <View key={index} className="min-h-18 flex-row items-center gap-3.5 px-4 py-3" style={CONTINUOUS}>
    <Bone width={LIST_AVATAR_SIZE} height={LIST_AVATAR_SIZE} radius={LIST_AVATAR_SIZE * 0.3} />
    <View className="flex-1 gap-1">
      <View className="flex-row items-center gap-1.5">
        <View className="flex-1"><Line width={cycle(index, ["58%", "68%", "78%"])} lineHeight={22} height={12} /></View>
        <Bone width={28} height={9} />
      </View>
      <Line width={cycle(index, ["38%", "53%"])} lineHeight={20} height={10} />
    </View>
  </View>)}</Skeleton>;
}

export function LoadingFlatRows({ count = 6, leading = "tile" }: { count?: number; leading?: "tile" | "avatar" }) {
  const avatar = leading === "avatar";
  return <Skeleton>{Array.from({ length: count }, (_, index) => <View key={index} className={`flex-row items-center border-b border-border px-4 ${avatar ? "min-h-18 gap-3.5" : "min-h-16 gap-3.5"}`}>
    {avatar ? <Bone width={LIST_AVATAR_SIZE} height={LIST_AVATAR_SIZE} radius={LIST_AVATAR_SIZE * 0.3} /> : <Bone width={36} height={36} radius={RADIUS.sm} />}
    <View className="flex-1">
      <Line width={cycle(index, ["46%", "62%", "36%", "54%"])} lineHeight={22} height={12} />
      <View className="mt-0.5"><Line width={cycle(index, ["30%", "40%"])} lineHeight={18} height={9} /></View>
    </View>
    {avatar ? null : <Bone width={32} height={9} />}
  </View>)}</Skeleton>;
}

/** Lines at the `code` line height: `framed` is a line-numbered `CodeBlock` card, otherwise a bare diff. */
export function LoadingDocument({ lines = 16, framed = false }: { lines?: number; framed?: boolean }) {
  const body = Array.from({ length: lines }, (_, index) => <View key={index} className="flex-row items-center" style={{ height: 20 }}>
    {framed ? <View style={{ width: 28 }}><Bone width={14} height={8} onRaised /></View> : null}
    <View className="flex-1" style={{ paddingLeft: cycle(index, [0, 16, 16, 32, 16, 0, 0, 16]) }}>
      {index % 7 === 6 ? null : <Bone width={cycle(index, ["62%", "78%", "44%", "70%", "52%", "86%"])} height={9} onRaised={framed} />}
    </View>
  </View>);
  if (!framed) return <Skeleton className="px-3 py-2">{body}</Skeleton>;
  return <Skeleton className="p-3">
    <View className="overflow-hidden rounded-md border border-border bg-surface-raised" style={{ padding: 11, ...CONTINUOUS }}>{body}</View>
  </Skeleton>;
}

export type SkeletonSection =
  | { kind: "group"; rows: number; label?: boolean; leading?: boolean; trailing?: "switch" }
  | { kind: "hero" }
  | { kind: "field"; tall?: boolean }
  | { kind: "capsule" }
  | { kind: "caption" };

export function LoadingSections({ sections, paddingTop = 12 }: { sections: readonly SkeletonSection[]; paddingTop?: number }) {
  return <Skeleton style={{ paddingTop }}>{sections.map((section, index) => <SectionBones key={index} section={section} />)}</Skeleton>;
}

function SectionBones({ section }: { section: SkeletonSection }) {
  switch (section.kind) {
    case "caption":
      return <View className="mb-4 px-8"><Line width="64%" lineHeight={18} height={9} /></View>;
    case "capsule":
      return <View className="mx-4 mb-3"><Bone width="100%" height={52} /></View>;
    case "field":
      return <View className="mb-4 gap-1.5 px-4">
        <Line width={72} lineHeight={18} height={9} />
        <Bone width="100%" height={section.tall ? 96 : 48} radius={RADIUS.sm} />
      </View>;
    case "hero":
      return <View className="mb-6 px-4"><View className="gap-1 rounded-md bg-surface p-4" style={CONTINUOUS}>
        <Line width={64} lineHeight={18} height={9} />
        <Line width="48%" lineHeight={41} height={28} />
        <View className="mt-1"><Line width="72%" lineHeight={18} height={9} /></View>
      </View></View>;
    case "group":
      return <View className="mb-6 px-4">
        {section.label ? <View className="px-4 pb-2"><Line width={88} lineHeight={18} height={9} /></View> : null}
        <View className="overflow-hidden rounded-md bg-surface" style={CONTINUOUS}>
          {Array.from({ length: section.rows }, (_, index) => <View key={index} className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
            {section.leading ? <Bone width={30} height={30} radius={RADIUS.xs} /> : null}
            <View className="flex-1">
              <Line width={cycle(index, ["52%", "38%", "64%"])} lineHeight={22} height={11} />
              <Line width={cycle(index, ["34%", "46%"])} lineHeight={18} height={9} />
            </View>
            {section.trailing === "switch" ? <Bone width={51} height={31} /> : null}
            {index === 0 ? null : <View className="absolute right-0 top-0 bg-border" style={{ left: section.leading ? 58 : 16, height: StyleSheet.hairlineWidth }} />}
          </View>)}
        </View>
      </View>;
  }
}
