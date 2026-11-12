/**
 * Web only: replaces expo-router's `global-state/browserHistoryAdapter` (see `metro.config.js`).
 *
 * A Cohub App is served from a static host that 404s every path but real files, and a browser reload keeps an
 * iframe's current URL, so a route written as `<dir>/chat/<id>` would reload into a 404. The router keeps
 * working on paths under `<dir>`; this adapter stores them in the address as `<dir>/index.html#/chat/<id>`
 * and reads them back. Without `__cohubBase` (a plain web build) addresses pass through unchanged.
 */
type Change = { id: string | null; path: string };
type Command = { op: "push" | "replace"; entryId: string; path: string } | { op: "go"; delta: number };

const base = (globalThis as { __cohubBase?: string }).__cohubBase;

function toAddress(path: string) {
  if (base === undefined || !path.startsWith(base)) return path;
  return `${base}/index.html#${path.slice(base.length) || "/"}`;
}

function currentPath() {
  const { pathname, search, hash } = window.location;
  if (base !== undefined && hash.startsWith("#/")) return base + hash.slice(1);
  return pathname + search + hash;
}

function readChange(): Change {
  const id = window.history.state?.id;
  return { id: typeof id === "string" ? id : null, path: currentPath() };
}

export function createBrowserHistoryAdapter() {
  const pending: (() => void)[] = [];
  const push = (id: string, path: string) => {
    if (window.history.state?.id === id) {
      window.history.replaceState({ id }, "", toAddress(path));
      return;
    }
    window.history.pushState({ id }, "", toAddress(path));
  };
  const replace = (id: string, path: string) => window.history.replaceState({ id }, "", toAddress(path));
  const go = (n: number) => {
    if (n === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener("popstate", done);
        const index = pending.indexOf(done);
        if (index > -1) pending.splice(index, 1);
        resolve();
      };
      pending.push(done);
      const timer = setTimeout(done, 100);
      window.addEventListener("popstate", done);
      window.history.go(n);
    });
  };
  let queue = Promise.resolve();
  const apply = (event: Command) => {
    queue = queue.then(() => {
      if (event.op === "go") return go(event.delta);
      return event.op === "push" ? push(event.entryId, event.path) : replace(event.entryId, event.path);
    });
  };
  const listen = (listener: (change: Change) => void) => {
    // The router has read the starting address by now; store it in the reload-safe form too.
    window.history.replaceState(window.history.state, "", toAddress(currentPath()));
    const onPopState = () => {
      if (pending.length) return;
      listener(readChange());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  };
  return { apply, listen };
}
