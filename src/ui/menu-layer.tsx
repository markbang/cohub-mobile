import { createContext, Fragment, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

type SetEntry = (key: string, node: ReactNode | null) => void;
const SetEntryContext = createContext<SetEntry | null>(null);
const EntriesContext = createContext<ReadonlyMap<string, ReactNode>>(new Map());

/**
 * The layer a screen draws its menus in. `MenuLayerOutlet` draws them last among the screen's children, over its
 * content and in its window, where the screens draw their action menus; controls inside scrolling content reach it
 * through `MenuPortal`. Updating a menu re-renders only the outlet.
 */
export function MenuLayer({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, ReactNode>>(new Map());
  const set = useMemo<SetEntry>(() => (key, node) => setEntries((current) => {
    if (node === null && !current.has(key)) return current;
    const next = new Map(current);
    if (node === null) next.delete(key);
    else next.set(key, node);
    return next;
  }), []);
  return <SetEntryContext.Provider value={set}><EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider></SetEntryContext.Provider>;
}

export function MenuLayerOutlet() {
  const entries = useContext(EntriesContext);
  return <>{[...entries].map(([key, node]) => <Fragment key={key}>{node}</Fragment>)}</>;
}

/** Draws `children` in the screen's menu layer, with the layer's context rather than the caller's. */
export function MenuPortal({ children }: { children: ReactNode }) {
  const set = useContext(SetEntryContext);
  if (!set) throw new Error("MenuPortal needs a MenuLayer: render the control inside a Screen.");
  const key = useId();
  useEffect(() => { set(key, children); }, [children, key, set]);
  useEffect(() => () => set(key, null), [key, set]);
  return null;
}
