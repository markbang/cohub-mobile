import { createContext } from "react";

// The iOS system bar draws its own glass, so `native` bar buttons stay bare glyphs. `system` is Android's
// drawing of that bar: glass buttons with UIKit's larger symbols.
export const BarButtonContext = createContext<"drawn" | "system" | "native" | null>(null);
