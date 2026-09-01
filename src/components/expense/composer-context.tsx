"use client";

import * as React from "react";

/**
 * Lets any screen open the expense composer without threading a callback down
 * through every intermediate component.
 */
export const ComposerContext = React.createContext<{
  open: (groupId?: string) => void;
} | null>(null);

export function useComposer() {
  const context = React.useContext(ComposerContext);
  if (!context) {
    throw new Error("useComposer must be used inside the app layout");
  }
  return context;
}
