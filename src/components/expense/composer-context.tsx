"use client";

import * as React from "react";
import type { ExpenseDto } from "@/lib/types";

/**
 * Lets any screen open the expense composer without threading a callback down
 * through every intermediate component.
 */
export const ComposerContext = React.createContext<{
  /** Opens a new expense, in a group if given, or as a copy of `template`. */
  open: (groupId?: string, template?: ExpenseDto) => void;
} | null>(null);

export function useComposer() {
  const context = React.useContext(ComposerContext);
  if (!context) {
    throw new Error("useComposer must be used inside the app layout");
  }
  return context;
}
