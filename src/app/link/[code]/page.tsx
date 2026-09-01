"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client/api";

/**
 * Where a scanned device-link code lands.
 *
 * The claim is a POST the page makes on arrival, not something the URL does by
 * being visited — a code spent by a link preview or a prefetch would be gone
 * before its owner finished pointing the camera.
 *
 * Outside the app shell on purpose: whoever is here has no identity yet, and
 * the shell would bounce them into onboarding before this could run.
 */
export default function LinkPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const client = useQueryClient();

  const [state, setState] = React.useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = React.useState<string | null>(null);

  const code = params?.code;
  const claimed = React.useRef(false);

  React.useEffect(() => {
    if (!code || claimed.current) return;
    // Guards against React's development double-invoke spending the code twice
    // and showing its owner a failure for something that worked.
    claimed.current = true;

    void (async () => {
      try {
        await api.post(`/api/identity/link/${encodeURIComponent(code)}/claim`);
        await client.invalidateQueries();
        setState("done");
        window.setTimeout(() => router.replace("/"), 900);
      } catch (error) {
        setMessage(error instanceof ApiError ? error.message : "That link did not work.");
        setState("failed");
      }
    })();
  }, [code, client, router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      {state === "working" ? (
        <>
          <Loader2 className="mb-5 size-8 animate-spin text-brand" />
          <h1 className="text-title font-bold text-text">Signing this device in…</h1>
        </>
      ) : state === "done" ? (
        <>
          <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-positive-soft text-positive-soft-text">
            <Check className="size-7" strokeWidth={3} />
          </span>
          <h1 className="text-title font-bold text-text">You are signed in</h1>
          <p className="mt-2 text-subhead text-muted">Taking you to your groups…</p>
        </>
      ) : (
        <>
          <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-warning-soft text-warning-soft-text">
            <TriangleAlert className="size-7" />
          </span>
          <h1 className="text-title font-bold text-text">That link did not work</h1>
          <p className="mt-2 text-subhead leading-relaxed text-muted">{message}</p>
          <p className="mt-2 text-caption leading-relaxed text-subtle">
            Codes work once and last five minutes. Open Divvy on your other device and show a fresh
            one.
          </p>
          <Button className="mt-7" variant="secondary" onClick={() => router.replace("/")}>
            Back to Divvy
          </Button>
        </>
      )}
    </main>
  );
}
