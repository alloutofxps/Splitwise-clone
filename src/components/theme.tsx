"use client";

import * as React from "react";
import { readStored, removeStored, writeStored } from "@/lib/client/storage";
import { useClientValue } from "./ui/state-hooks";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "divvy-theme";

/**
 * Theme state.
 *
 * The class is already on <html> before React runs - see the inline script in
 * the root layout - so this provider's job is only to keep it in sync
 * afterwards, and to follow the OS when the user has not chosen explicitly.
 */
const EVENT = "divvy:theme";

/** The chosen theme, kept in memory too so a browser that refuses storage still honours it for the visit. */
let remembered: Theme | null = null;

function readTheme(): Theme {
  if (remembered) return remembered;
  const stored = readStored(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const readOsDark = () => window.matchMedia(DARK_QUERY).matches;
function subscribeOs(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Theme state.
 *
 * The class is already on <html> before React runs - see the inline script in
 * the root layout - so this provider's job is only to keep it in sync
 * afterwards, and to follow the OS when the user has not chosen explicitly.
 * Both the choice and the OS setting are read as outside values, so the
 * resolved theme is right on the first render after hydration.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useClientValue(readTheme, "system", subscribeTheme);
  const osDark = useClientValue(readOsDark, false, subscribeOs);
  const resolved: "light" | "dark" = theme === "dark" || (theme === "system" && osDark) ? "dark" : "light";

  React.useEffect(() => {
    const dark = resolved === "dark";
    document.documentElement.classList.toggle("dark", dark);
    // Keep the browser chrome in step with the app on Android, where the
    // address bar is painted with theme-color.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0b0b0a" : "#fafaf8");
  }, [resolved]);

  const setTheme = React.useCallback((next: Theme) => {
    remembered = next;
    if (next === "system") removeStored(STORAGE_KEY);
    else writeStored(STORAGE_KEY, next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
