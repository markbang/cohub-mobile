import * as ExpoLinking from "expo-linking";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { chatLinkNavigation } from "@/src/data/chat-link-navigation";
import {
  getInitialNotificationUrl,
  subscribeToNotificationResponses,
} from "@/src/platform/notifications";

function routeFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const parts = [parsed.hostname, ...parsed.pathname.split("/")]
      .map((part) => decodeURIComponent(part))
      .filter(Boolean);
    if (parsed.protocol === "https:" && parsed.hostname === "cohub.live") {
      return { parts: parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent), parsed };
    }
    return { parts, parsed };
  } catch {
    return null;
  }
}

export function NativeInteractionBridge() {
  const router = useRouter();
  // A ref, so navigating does not re-run the listener effect and replay the initial URL.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const openUrl = useCallback((rawUrl: string | null | undefined) => {
    if (!rawUrl) return;
    const result = routeFromUrl(rawUrl);
    if (!result) return;
    const [resource, id] = result.parts;
    if (!id || resource === "callback") return;
    if (resource === "chat") {
      const turn = result.parsed.searchParams.get("turn");
      const turnId = result.parsed.searchParams.get("turnId");
      const navigation = chatLinkNavigation(pathnameRef.current, { sessionId: id, turn, turnId });
      if (navigation.kind === "none") return;
      if (navigation.kind === "setParams") {
        router.setParams(navigation.params);
        return;
      }
      router.push({
        pathname: "/chat/[sessionId]",
        params: { sessionId: id, ...(turn ? { turn } : {}), ...(turnId ? { turnId } : {}) },
      });
      return;
    }
    if (resource === "space") {
      router.push({ pathname: "/space/[spaceId]", params: { spaceId: id } });
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    let notificationCleanup: (() => void) | null = null;
    const linkingSubscription = ExpoLinking.addEventListener("url", ({ url }) => openUrl(url));
    const notificationSubscription = subscribeToNotificationResponses(openUrl)
      .then((cleanup) => {
        if (active) {
          notificationCleanup = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((error) => {
        console.warn("[mobile-notifications] response listener unavailable", error);
      });

    void notificationSubscription;
    void ExpoLinking.getInitialURL().then(openUrl).catch((error) => {
      console.warn("[mobile-linking] initial URL unavailable", error);
    });
    void getInitialNotificationUrl().then(openUrl).catch((error) => {
      console.warn("[mobile-notifications] initial response unavailable", error);
    });
    return () => {
      active = false;
      linkingSubscription.remove();
      notificationCleanup?.();
    };
  }, [openUrl]);

  return null;
}
