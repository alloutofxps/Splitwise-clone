"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Catches a throw inside any app screen without taking the shell with it: the
 * tab bar and header stay mounted, so there is still a way out. Without this,
 * one component throwing during render unmounts the whole tree and leaves a
 * white screen — and a standalone PWA has no visible reload button.
 */
export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen {...props} />;
}
