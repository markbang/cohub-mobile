import { useCallback } from "react";
import type { ProfileClaims } from "@/src/auth/profile-session.types";
import { webViewer } from "@/src/auth/web-session";

/** The browser App has no Logto session; the viewer comes from `connectWebSession`, and the Cohub page owns sign-out. */
export function useProfileSession() {
  const getClaims = useCallback(async (): Promise<ProfileClaims> => {
    const viewer = webViewer();
    return { name: viewer?.name ?? undefined, username: viewer?.username ?? undefined, picture: viewer?.avatarUrl ?? undefined };
  }, []);
  const signOut = useCallback(async () => undefined, []);
  return { getClaims, signOut };
}
