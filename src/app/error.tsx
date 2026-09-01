"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * The boundary for everything outside the tab bar — the join flow and the
 * offline page. `(app)/error.tsx` handles the screens inside it.
 */
export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen {...props} />;
}
