import { createContext } from "react";

// The iOS system bar draws its own glass, so `native` bar buttons stay bare glyphs.
export const BarButtonContext = createContext<"drawn" | "native" | null>(null);
