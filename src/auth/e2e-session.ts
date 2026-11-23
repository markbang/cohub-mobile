import { LogtoContext, PersistKey } from "@logto/rn";
import { useContext, useEffect, useRef } from "react";
import { config, uiSnapshots } from "@/src/config";

/**
 * A refresh token from `scripts/e2e/logto-token.mjs`, which signs the E2E account in with its password
 * so a snapshot run never opens the hosted sign-in page (that page mails a code to the account).
 * Only a debug bundle served to `scripts/ui-snapshots.mjs` carries it; a release build drops it.
 */
export const e2eRefreshToken = __DEV__ && uiSnapshots ? process.env.EXPO_PUBLIC_E2E_REFRESH_TOKEN?.trim() || null : null;

// `getAccessToken` refuses without a stored id token, and only this private refresh path stores one
// from a refresh token alone; `signIn` would open the hosted page.
type RefreshingClient = { getAccessTokenByRefreshToken(resource: string): Promise<string> };

/** Signs a snapshot run in with `e2eRefreshToken`, once per Logto client, while it is signed out. */
export function useE2eSession() {
  const { client, isInitialized, isAuthenticated, setIsAuthenticated } = useContext(LogtoContext);
  const seededClient = useRef<typeof client | null>(null);

  useEffect(() => {
    if (!e2eRefreshToken || !isInitialized || isAuthenticated || seededClient.current === client) return;
    // Once per client: a session the API later rejects signs out, and must not loop back in.
    seededClient.current = client;
    let active = true;
    void (async () => {
      // An earlier mount may have finished the exchange; the token it spent may not be reusable.
      if (!(await client.isAuthenticated())) {
        await client.adapter.setStorageItem(PersistKey.RefreshToken, e2eRefreshToken);
        await (client as unknown as RefreshingClient).getAccessTokenByRefreshToken(config.apiResource);
        if (!(await client.isAuthenticated())) throw new Error("the refresh grant returned no id token");
      }
      if (active) setIsAuthenticated(true);
    })().catch((error: unknown) => {
      console.warn("[mobile-auth] the snapshot session could not sign in", error);
    });
    return () => {
      active = false;
    };
  }, [client, isAuthenticated, isInitialized, setIsAuthenticated]);
}
