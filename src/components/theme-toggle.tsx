"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";
import { haptic } from "./ui/primitives";

/**
 * Light/dark toggle.
 *
 * Two states rather than three: the app follows the system until the user
 * touches this, at which point they clearly want a specific one. A three-way
 * light/dark/system control belongs on the settings screen, not in a header.
 */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();

  return (
    <button
      onClick={() => {
        haptic();
        setTheme(resolved === "dark" ? "light" : "dark");
      }}
      aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90"
    >
      {resolved === "dark" ? <Sun className="size-[20px]" /> : <Moon className="size-[20px]" />}
    </button>
  );
}
