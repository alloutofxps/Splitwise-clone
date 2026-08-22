"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/client/api";
import { startAutoFlush } from "@/lib/client/outbox";
import { ToastProvider } from "./ui/toast";
import { ThemeProvider } from "./theme";
import { PwaProvider } from "./pwa";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Coming back to the app should show current balances, not whatever was
        // on screen when it was backgrounded three hours ago.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, error) => {
          // Retrying a 4xx just delays showing the user what went wrong.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return count < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state, not at module scope: a module-level client would be
  // shared across requests on the server and leak one user's data into
  // another's render.
  const [client] = React.useState(makeClient);

  React.useEffect(() => startAutoFlush(), []);

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          {children}
          <PwaProvider />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
