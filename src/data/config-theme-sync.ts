import type { CohubClient } from "@neta-art/cohub";
import { decode } from "js-base64";
import { CONFIG_THEME_PATH, MAX_THEME_CSS_LENGTH } from "./config-theme";

export type CachedConfigTheme = { spaceId: string | null; css: string | null };
export type ConfigThemeUpdate = CachedConfigTheme & { loading: boolean; error: string | null };

type Cache = {
  read(): Promise<CachedConfigTheme | null>;
  write(value: CachedConfigTheme): Promise<void>;
  clear(): Promise<void>;
};

function status(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Config theme refresh was cancelled.");
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const abort = () => { clearTimeout(timer); reject(new Error("Config theme refresh was cancelled.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function readConfigThemeCss(client: CohubClient, spaceId: string, signal: AbortSignal): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    checkAbort(signal);
    let file;
    try {
      file = await client.space(spaceId).files.read(CONFIG_THEME_PATH, undefined, signal);
    } catch (error) {
      if (status(error) === 404) return null;
      throw error;
    }
    if (!("content" in file)) {
      await wait(Math.max(250, Math.min(5000, file.retryAfterMs)), signal);
      continue;
    }
    if (file.size > MAX_THEME_CSS_LENGTH) throw new Error("Config theme.css exceeds 256 KiB. Reduce its size and retry.");
    let css: string;
    if (file.delivery === "url") {
      if (!file.url) throw new Error("Config theme.css has no download URL. Retry the theme refresh.");
      const url = new URL(file.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Config theme.css must download from an HTTPS URL without credentials.");
      const response = await fetch(url.href, { signal, credentials: "omit" });
      if (!response.ok) throw new Error(`Config theme.css download failed (HTTP ${response.status}). Retry the theme refresh.`);
      if (Number(response.headers.get("content-length")) > MAX_THEME_CSS_LENGTH) throw new Error("Config theme.css exceeds 256 KiB.");
      css = await response.text();
    } else {
      css = file.encoding === "base64" ? decode(file.content) : file.content;
    }
    if (css.length > MAX_THEME_CSS_LENGTH) throw new Error("Config theme.css exceeds 256 KiB.");
    return css;
  }
  throw new Error("Config theme.css is still preparing. Retry when the Config Space is ready.");
}

/** One account owns hydration, revalidation and cache writes; late work cannot publish after disposal. */
export function createConfigThemeSync(options: {
  client: CohubClient;
  cache: Cache;
  publish(update: ConfigThemeUpdate): void;
  watchSpace(spaceId: string | null): void;
}) {
  let current: CachedConfigTheme = { spaceId: null, css: null };
  let revision = 0;
  let confirmed = false;
  let ownedConfirmed = false;
  let disposed = false;
  let request: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let writes = Promise.resolve();
  let loading = true;
  let error: string | null = null;
  const publish = (nextLoading: boolean, nextError: string | null = null) => {
    loading = nextLoading;
    error = nextError;
    options.publish({ ...current, loading, error });
  };
  const persist = (value: CachedConfigTheme) => {
    writes = writes.catch(() => undefined).then(() => disposed ? undefined : options.cache.write(value));
    return writes;
  };
  const commit = async (value: CachedConfigTheme, version: number) => {
    if (disposed || revision !== version) return;
    options.publish({ ...value, loading: false, error: null });
    current = value;
    loading = false;
    error = null;
    confirmed = true;
    options.watchSpace(value.spaceId);
    await persist(value);
  };
  return {
    async hydrate(): Promise<void> {
      try {
        const cached = await options.cache.read();
        if (disposed || confirmed || !cached || ownedConfirmed && cached.spaceId !== current.spaceId) return;
        options.publish({ ...cached, loading, error });
        current = cached;
        options.watchSpace(cached.spaceId);
      } catch (error) {
        if (!disposed && !confirmed) publish(true, error instanceof Error ? error.message : "Unable to load the cached Config theme.");
      }
    },
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (request) return request;
      const version = ++revision;
      const activeController = new AbortController();
      controller = activeController;
      publish(true);
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Config theme refresh timed out. Check your connection and retry.");
          activeController.abort();
          reject(error);
        }, 15_000);
      });
      const load = async (): Promise<CachedConfigTheme> => {
        let space;
        try {
          space = await options.client.spaces.getOwnedBySlug("config");
        } catch (error) {
          if (status(error) === 404) return { spaceId: null, css: null };
          throw error;
        }
        checkAbort(activeController.signal);
        if (disposed || revision !== version) return current;
        ownedConfirmed = true;
        if (space.id !== current.spaceId) {
          current = { spaceId: space.id, css: null };
          publish(true);
          options.watchSpace(space.id);
          await persist(current);
        }
        return { spaceId: space.id, css: await readConfigThemeCss(options.client, space.id, activeController.signal) };
      };
      request = Promise.race([load(), timeout]).then((value) => commit(value, version)).catch(async (error: unknown) => {
        if (disposed || revision !== version) return;
        if (status(error) === 401 || status(error) === 403) {
          confirmed = true;
          current = { spaceId: null, css: null };
          options.watchSpace(null);
          publish(false, "Config theme access was rejected. Sign in again or check your Config Space permissions.");
          await persist(current);
        }
        publish(false, error instanceof Error ? error.message : "Unable to refresh the Config theme. Check your connection and retry.");
        throw error;
      }).finally(() => {
        clearTimeout(timer);
        if (controller === activeController) controller = null;
        request = null;
      });
      return request;
    },
    async clear(): Promise<void> {
      revision++;
      controller?.abort();
      current = { spaceId: null, css: null };
      confirmed = true;
      publish(false);
      await writes.catch(() => undefined);
      await options.cache.clear();
    },
    dispose(): void {
      disposed = true;
      revision++;
      controller?.abort();
      options.watchSpace(null);
    },
    async clearStored(): Promise<void> {
      await writes.catch(() => undefined);
      await options.cache.clear();
    },
  };
}
