import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { getLoadedFonts, isLoaded, loadAsync } from "expo-font";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { AnchoredActionMenu } from "@/src/components/AnchoredActionMenu";
import { FilterChip } from "@/src/components/FilterChip";
import { GroupAddRow, GroupRow, GroupTile } from "@/src/components/GroupRow";
import { NativeMenuButton, nativeMenus, type NativeMenuSection } from "@/src/components/NativeMenu";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { MenuAnchor, MenuPresence } from "@/src/ui/MorphMenuSurface";
import { PLATFORM_FONT_FAMILIES } from "@/src/ui/platform-fonts";
import {
  AppSwitch,
  DataError,
  EmptyState,
  Field,
  FIELD_INPUT_CLASS,
  IconButton,
  LoadingRows,
  PrimaryButton,
  Screen,
  SearchField,
  Segmented,
  SettingsGroup,
  StatusPill,
  TopBar,
} from "@/src/ui";

/**
 * Every shared primitive on one route, so `scripts/ui-snapshots.mjs` can capture iOS and Android
 * side by side. `?section=` renders one section to fit a single screenshot; `sheet` and `confirm`
 * open their overlay on mount because a screenshot cannot wait on a tap, unless `?open=0` asks for the
 * closed state a screen recording starts from.
 */
const SECTIONS = ["type", "rows", "controls", "states", "menu", "sheet", "page", "confirm"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

const NOOP = () => undefined;

export default function DebugUiCatalogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ section?: string; open?: string }>();
  const only = isSection(params.section) ? params.section : null;
  const autoOpen = params.open !== "0";
  // The menu overlays the whole screen, as on real screens, so it lives outside the scroll view.
  const menuAnchorRef = useRef<View>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const show = (section: Section) => only === null || only === section;

  return (
    <Screen>
      <TopBar title="UI Catalog" onBack={() => router.back()} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 32 }}>
        {show("type") ? <TypeSection /> : null}
        {show("rows") ? <RowsSection /> : null}
        {show("controls") ? <ControlsSection /> : null}
        {show("states") ? <StatesSection /> : null}
        {show("menu") ? <MenuSection anchorRef={menuAnchorRef} open={menuOpen} onOpen={() => setMenuOpen(true)} /> : null}
        {show("sheet") ? <SheetSection initiallyOpen={autoOpen && only === "sheet"} /> : null}
        {show("page") ? <PageSheetSection initiallyOpen={autoOpen && only === "page"} /> : null}
        {show("confirm") ? <ConfirmSection initiallyOpen={autoOpen && only === "confirm"} /> : null}
      </ScrollView>
      <MenuPresence open={menuOpen}><AnchoredActionMenu anchorRef={menuAnchorRef} title="Actions" testID="ui-catalog-menu" sections={MENU_SECTIONS} onClose={() => setMenuOpen(false)} /></MenuPresence>
    </Screen>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mb-6 gap-3 px-4">
      <Text className="px-4 text-caption font-semibold text-fg-muted">{label}</Text>
      {children}
    </View>
  );
}

const TYPE_RAMP = [
  ["Display", "text-display font-semibold"],
  ["Title", "text-title font-semibold"],
  ["Headline", "text-headline font-semibold"],
  ["Body", "text-body"],
  ["Subhead", "text-subhead"],
  ["Caption", "text-caption"],
  ["Micro", "text-micro"],
  ["Code", "text-code"],
] as const;

const FONT_SAMPLE = { fontSize: 17 } as const;
// design-system-begin: font probes set the family and weight directly to see which face Android picks.
const FONT_SAMPLES = [
  ["System 400", { fontWeight: "400" }],
  ["System 700", { fontWeight: "700" }],
  ["Inter", { fontFamily: "Inter" }],
  ["Inter 500", { fontFamily: "Inter", fontWeight: "500" }],
  ["Inter 600", { fontFamily: "Inter", fontWeight: "600" }],
  ["Inter 700", { fontFamily: "Inter", fontWeight: "700" }],
] as const;
// design-system-end

function TypeSection() {
  // Loads the platform fonts again to surface the error the root layout's `useFonts` swallows.
  const [fontLoad, setFontLoad] = useState("loading…");
  useEffect(() => {
    loadAsync(PLATFORM_FONT_FAMILIES).then(() => setFontLoad(`ok · Inter ${isLoaded("Inter") ? "yes" : "no"}`), (error: unknown) => setFontLoad(`error: ${error instanceof Error ? error.message : String(error)}`));
  }, []);
  return (<>
    <SettingsGroup label="Type">
      <View className="gap-2 px-4 py-3">
        {TYPE_RAMP.map(([label, className]) => (
          <Text key={label} numberOfLines={1} className={`${className} text-fg`}>{label} · The quick brown fox</Text>
        ))}
        <Text className="text-body text-fg-muted">Muted body</Text>
        <Text className="text-body text-fg-faint">Faint body</Text>
        <Text className="text-body text-accent">Accent body</Text>
      </View>
    </SettingsGroup>
    {/* Which faces actually loaded, and how each way of naming them renders, beside the system font. */}
    <SettingsGroup label={`Fonts · ${fontLoad} · runtime: ${getLoadedFonts().filter((name) => !name.startsWith("KaTeX")).join(", ") || "none"}`}>
      <View className="gap-1 px-4 py-3">
        {FONT_SAMPLES.map(([label, style]) => <Text key={label} numberOfLines={1} className="text-fg" style={[FONT_SAMPLE, style]}>{label} · Rag 0123</Text>)}
      </View>
    </SettingsGroup>
  </>);
}

const SELECT_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function RowsSection() {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<(typeof SELECT_OPTIONS)[number]["value"]>("system");
  return (
    <>
      <SettingsGroup label="Settings rows" footer="A footnote under the group explains its rows.">
        <SettingsRow icon="palette" title="Appearance" value="System" onPress={NOOP} />
        <SettingsRow icon="bell" title="Notifications" detail="Mentions and replies">
          <AppSwitch value={enabled} onValueChange={setEnabled} accessibilityLabel="Notifications" />
        </SettingsRow>
        <SettingsSelectRow icon="sun" title="Theme" value={mode} options={SELECT_OPTIONS} onChange={setMode} />
        <SettingsRow icon="globe" title="Website" external onPress={NOOP} />
        <SettingsRow icon="trash" title="Delete account" danger last onPress={NOOP} />
      </SettingsGroup>
      <SettingsGroup label="Group rows">
        <GroupRow leading={<GroupTile icon="folder" />} title="Design review" subtitle="12 files · Updated 2 min ago" onPress={NOOP} />
        <GroupRow leading={<GroupTile icon="user" accent />} title="A long title that has to truncate before it reaches the detail" detail="Today" onPress={NOOP} />
        <GroupAddRow label="Add item" onPress={NOOP} last />
      </SettingsGroup>
    </>
  );
}

function ControlsSection() {
  const [segment, setSegment] = useState<"all" | "mine" | "shared">("all");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(0);
  const [on, setOn] = useState(true);
  const segments = [
    { value: "all", label: "All" },
    { value: "mine", label: "Mine" },
    { value: "shared", label: "Shared" },
  ] as const;
  return (
    <>
      <Block label="Buttons">
        <PrimaryButton label="Primary" icon="plus" onPress={NOOP} />
        <PrimaryButton label="Secondary" variant="secondary" onPress={NOOP} />
        <PrimaryButton label="Ghost" variant="ghost" onPress={NOOP} />
        <PrimaryButton label="Danger" variant="danger" onPress={NOOP} />
        <PrimaryButton label="Loading" loading onPress={NOOP} />
        <View className="flex-row items-center gap-2">
          <IconButton name="share" label="Share" onPress={NOOP} />
          <IconButton name="copy" label="Copy" filled onPress={NOOP} />
          <IconButton name="filter" label="Filter" tone="active" onPress={NOOP} />
          <IconButton name="plus" label="Add" tone="accent" onPress={NOOP} />
          <IconButton name="trash" label="Delete" tone="danger" onPress={NOOP} />
          <IconButton name="archive" label="Archive" disabled onPress={NOOP} />
        </View>
      </Block>
      <Block label="Selection">
        <Segmented options={segments} value={segment} onChange={setSegment} />
        <Segmented options={segments.slice(0, 2)} value={segment === "shared" ? "all" : segment} onChange={setSegment} />
        <View className="flex-row flex-wrap gap-1">
          {["Recent", "Pinned", "Archived"].map((label, index) => (
            <FilterChip key={label} label={label} suffix={index === 0 ? "3" : undefined} selected={chip === index} onPress={() => setChip(index)} />
          ))}
        </View>
        <View className="flex-row items-center gap-4">
          <AppSwitch value={on} onValueChange={setOn} accessibilityLabel="Switch on" />
          <AppSwitch value={!on} onValueChange={(next) => setOn(!next)} accessibilityLabel="Switch off" />
          <AppSwitch value disabled accessibilityLabel="Switch disabled" />
        </View>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search" />
        <View className="flex-row flex-wrap gap-2">
          <StatusPill label="Neutral" />
          <StatusPill label="Running" tone="success" />
          <StatusPill label="Paused" tone="warning" />
          <StatusPill label="Failed" tone="danger" />
          <StatusPill label="Queued" tone="info" />
        </View>
      </Block>
    </>
  );
}

function StatesSection() {
  return (
    <>
      <EmptyState icon="folder" title="No files yet" description="Files you add to this space show up here." action={{ icon: "plus", label: "Add file", onPress: NOOP }} />
      <DataError message="Could not load this list. Check your connection." onRetry={NOOP} />
      <LoadingRows count={3} />
    </>
  );
}

// Groups, a checked choice, and a second line: what iOS menus show beyond a list of verbs.
const MENU_SECTIONS: NativeMenuSection[] = [
  { actions: [
    { icon: "pin", title: "Pin", onPress: NOOP },
    { icon: "share", title: "Share", onPress: NOOP },
    { icon: "copy", title: "Copy link", onPress: NOOP },
  ] },
  { title: "Sort by", actions: [
    { icon: "clock", title: "Recent", checked: true, onPress: NOOP },
    { icon: "type", title: "Name", onPress: NOOP },
  ] },
  { actions: [
    { icon: "archive", title: "Archive", detail: "Hidden from the list, still in search", onPress: NOOP },
  ] },
];

function MenuSection({ anchorRef, open, onOpen }: { anchorRef: RefObject<View | null>; open: boolean; onOpen: () => void }) {
  return (
    <Block label="Menu">
      <View className="flex-row">
        {nativeMenus
          ? <NativeMenuButton appearance="plain" icon="more" label="Open menu" sections={MENU_SECTIONS} testID="ui-catalog-menu-button" />
          : <MenuAnchor ref={anchorRef} open={open}><IconButton name="more" label="Open menu" onPress={onOpen} testID="ui-catalog-menu-button" /></MenuAnchor>}
      </View>
    </Block>
  );
}

function SheetSection({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Block label="Sheet">
      <PrimaryButton label="Open sheet" variant="secondary" onPress={() => setOpen(true)} />
      {/* Two rows: a short sheet sized to its content. */}
      <AdaptiveSheet visible={open} detent="fit" title="Sheet title" subtitle="Subtitle" onClose={() => setOpen(false)} confirm={{ label: "Done", onPress: () => setOpen(false) }}>
        <SettingsGroup>
          <SettingsRow icon="user" title="Profile" value="Mark" onPress={NOOP} />
          <SettingsRow icon="bell" title="Notifications" value="On" last onPress={NOOP} />
        </SettingsGroup>
      </AdaptiveSheet>
    </Block>
  );
}

/** A form, as the app's create and edit sheets are: the full-height page sheet. */
function PageSheetSection({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [name, setName] = useState("");
  return (
    <Block label="Page sheet">
      <PrimaryButton label="Open page sheet" variant="secondary" onPress={() => setOpen(true)} />
      <AdaptiveSheet visible={open} title="New Space" onClose={() => setOpen(false)} confirm={{ label: "Create", disabled: !name.trim(), onPress: () => setOpen(false) }}>
        <View className="gap-4">
          <Field label="Name">
            <TextInput value={name} onChangeText={setName} placeholder="Design review" className={FIELD_INPUT_CLASS} />
          </Field>
          <SettingsGroup label="Placement">
            <SettingsRow icon="cloud" title="Cloud" value="Default" onPress={NOOP} />
            <SettingsRow icon="monitor" title="This device" last onPress={NOOP} />
          </SettingsGroup>
        </View>
      </AdaptiveSheet>
    </Block>
  );
}

function ConfirmSection({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Block label="Confirm">
      <PrimaryButton label="Open confirm" variant="secondary" onPress={() => setOpen(true)} />
      <ConfirmSheet visible={open} title="Delete this chat?" message="This removes the chat for everyone in the space." confirmLabel="Delete" onConfirm={() => setOpen(false)} onClose={() => setOpen(false)} />
    </Block>
  );
}
