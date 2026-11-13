import useLinkToPathProps, { shouldHandleMouseEvent } from "expo-router/build/link/useLinkToPathProps";
import { toAddress } from "@/src/platform/app-history-adapter";

/**
 * Web only: replaces expo-router's `link/useLinkToPathProps` (see `metro.config.js`), which builds the `href` of
 * every router link (`Link`, header and tab buttons). The address it gives is the one history stores, so a
 * hovered, middle-clicked or reloaded link opens the route instead of a path the static host 404s.
 */
export default function useAppLinkToPathProps(options: Parameters<typeof useLinkToPathProps>[0]) {
  const props = useLinkToPathProps(options);
  return { ...props, href: toAddress(props.href) };
}

export { shouldHandleMouseEvent };
