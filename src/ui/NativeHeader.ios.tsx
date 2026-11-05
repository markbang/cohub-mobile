import { useNavigation } from "expo-router";
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from "expo-router/native-stack";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { traceAction } from "@/src/data/interaction-trace";
import { SF_SYMBOLS } from "@/src/sf-symbols";
import { useAppTheme, type AppTheme } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";
import type { EmptyListFill, NativeHeader, NativeHeaderItem } from "./NativeHeader";

export type { EmptyListFill, NativeHeader, NativeHeaderItem } from "./NativeHeader";

export const nativeHeaders = true;

export const NAVIGATION_BAR_INSETS = { contentInsetAdjustmentBehavior: "automatic" } as const;

/**
 * Automatic insets put the content below the bar, so a container grown to the list's full height
 * would push a centred empty state down by the bar. It fills only the space between the bar and the
 * bottom safe area instead.
 */
export function useEmptyListFill(empty: boolean): EmptyListFill {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  return {
    onLayout: (event) => setHeight(event.nativeEvent.layout.height),
    // Under a native bar the content starts below it; a drawn header leaves the status bar as the top inset.
    style: empty && height > 0 ? { minHeight: Math.max(0, height - (headerHeight > 0 ? headerHeight : insets.top) - insets.bottom) } : undefined,
  };
}

export function useNativeHeader(header: NativeHeader | null) {
  const navigation = useNavigation();
  const theme = useAppTheme();
  const searchRef = useRef<SearchBarCommands>(null);
  const shown = header !== null;
  // Bar items close over the screen's latest state, so the options follow every render.
  useLayoutEffect(() => {
    if (header) navigation.setOptions(headerOptions(header, theme, searchRef));
  });
  useLayoutEffect(() => {
    if (!shown) return;
    // A screen that switches to a drawn bar must not show both.
    return () => navigation.setOptions({ headerShown: false });
  }, [navigation, shown]);
  const query = header?.search?.query;
  useEffect(() => {
    // The native field owns its text, so a filter cleared from the screen must clear it too.
    if (query === "") searchRef.current?.clearText();
  }, [query]);
}

function headerOptions(header: NativeHeader, theme: AppTheme, searchRef: RefObject<SearchBarCommands | null>): NativeStackNavigationOptions {
  const { title, subtitle, right, items = [], search, close } = header;
  const rightItems: NativeStackHeaderItem[] = [
    ...(right ? [{ type: "custom", element: <BarButtonContext.Provider value="native"><View className="flex-row items-center">{right}</View></BarButtonContext.Provider> } as const] : []),
    ...items.map((item) => barItem(item, theme)),
  ];
  return {
    headerShown: true,
    title,
    headerTitle: subtitle ? () => <View className="items-center">
      <Text accessibilityRole="header" numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
      <Text numberOfLines={1} className="text-caption text-fg-muted">{subtitle}</Text>
    </View> : undefined,
    headerBackButtonDisplayMode: "minimal",
    // design-system-begin: navigator header styles are native props that only take JS colors.
    headerTintColor: theme.colors.text,
    headerTitleStyle: { color: theme.colors.text },
    headerLargeTitleStyle: { color: theme.colors.text },
    // design-system-end
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    unstable_headerRightItems: rightItems.length ? () => rightItems : undefined,
    unstable_headerLeftItems: close ? () => [{ type: "button", label: close.label, accessibilityLabel: close.label, icon: { type: "sfSymbol", name: SF_SYMBOLS.x }, onPress: close.onPress }] : undefined,
    headerSearchBarOptions: search ? {
      ref: searchRef,
      placeholder: search.placeholder,
      autoCapitalize: "none",
      obscureBackground: false,
      hideWhenScrolling: !search.pinned,
      tintColor: theme.colors.accent,
      textColor: theme.colors.text,
      onChangeText: (event) => search.onQueryChange(event.nativeEvent.text),
      onCancelButtonPress: () => search.onQueryChange(""),
    } : undefined,
  };
}

function barItem(item: NativeHeaderItem, theme: AppTheme): NativeStackHeaderItem {
  const icon = { type: "sfSymbol", name: SF_SYMBOLS[item.icon] } as const;
  if (item.kind === "button") return {
    type: "button",
    label: item.label,
    accessibilityLabel: item.label,
    icon,
    disabled: item.disabled,
    variant: item.prominent ? "prominent" : "plain",
    tintColor: item.prominent ? theme.colors.accent : undefined,
    onPress: () => { traceAction("icon", { label: item.label, id: item.icon }); item.onPress(); },
  };
  return {
    type: "menu",
    label: item.label,
    accessibilityLabel: item.title ? `${item.label}, ${item.title}` : item.label,
    icon,
    tintColor: item.active ? theme.colors.accent : undefined,
    menu: {
      title: item.title,
      items: item.actions.map((action) => ({
        type: "action",
        label: action.title,
        description: action.detail,
        icon: { type: "sfSymbol", name: SF_SYMBOLS[action.icon] },
        state: action.checked ? "on" : "off",
        disabled: action.disabled,
        onPress: () => { traceAction("menu_item", { menu: item.label, item: action.title }); action.onPress(); },
      })),
    },
  };
}
