"use client";

import { flushSync } from "react-dom";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";
import { haptic } from "./ui/primitives";
import { withThemeWipe } from "./ui/motion";

/**
 * Light/dark toggle.
 *
 * Two states rather than three: the app follows the system until the user
 * touches this, at which point they clearly want a specific one. A three-way
 * light/dark/system control belongs on the settings screen, not in a header.
 *
 * The switch is an event rather than a swap: the new theme wipes in as a circle
 * from the button, and the icon spins from sun to moon.
 */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();

  return (
    <button
      onClick={(event) => {
        haptic();
        const next = resolved === "dark" ? "light" : "dark";
        const rect = event.currentTarget.getBoundingClientRect();
        withThemeWipe(
          () => {
            // Synchronously, so the transition snapshots the new theme.
            document.documentElement.classList.toggle("dark", next === "dark");
            flushSync(() => setTheme(next));
          },
          { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        );
      }}
      aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90"
    >
      <motion.span
        key={resolved}
        initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18 }}
        className="flex"
      >
        {resolved === "dark" ? <Sun className="size-[20px]" /> : <Moon className="size-[20px]" />}
      </motion.span>
    </button>
  );
}
