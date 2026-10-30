"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/client/api";
import { Sheet, WhileOpen } from "../ui/sheet";
import { cn } from "../ui/primitives";
import { PasskeyCancelled, passkeysSupported, provePasskey } from "./passkey";

/**
 * Deleting your account, after confirming it's you (OWASP ASVS 3.6; the
 * owner chose this on 28 October 2026).
 *
 * A signed-in phone isn't enough on its own: whoever is holding it unlocked
 * could delete the account. So the passkey is asked for, or the recovery key
 * when there's no passkey on this device, and the server checks it
 * (api/identity/account).
 *
 * As the panel opens it asks whether the account can be deleted yet, so
 * nobody proves who they are only to be told they still owe money.
 */
export function ConfirmDeleteSheet({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [blocked, setBlocked] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [useKey, setUseKey] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.get<{ passkeys: { usableHere: boolean }[] }>("/api/identity/devices"),
    enabled: open,
  });
  const canPasskey = passkeysSupported() && (devices.data?.passkeys.some((p) => p.usableHere) ?? false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<{ canDelete: boolean; reason: string | null }>("/api/identity/account")
      .then((answer) => {
        if (!cancelled && !answer.canDelete) setBlocked(answer.reason);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setBlocked(reason instanceof ApiError ? reason.message : "Couldn't check. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const remove = async (proof: { passkey?: unknown; recoveryKey?: string }) => {
    setWorking(true);
    setError(null);
    try {
      await api.del("/api/identity/account", proof);
      await onDeleted();
    } catch (reason) {
      if (!(reason instanceof PasskeyCancelled)) {
        setError(reason instanceof ApiError ? reason.message : "That didn't work. Please try again.");
      }
    } finally {
      setWorking(false);
    }
  };

  // Back to the start for next time it opens.
  const close = () => {
    setChecked(false);
    setBlocked(null);
    setError(null);
    setKey("");
    setUseKey(false);
    onClose();
  };

  const showKey = useKey || !canPasskey;
  const danger =
    "h-11 w-full rounded-[var(--radius-md)] bg-danger text-subhead font-semibold text-inverse transition active:opacity-70 disabled:opacity-60";

  return (
    <WhileOpen open={open}>
      <Sheet open={open} onClose={close} title="Delete your account?">
        <div className="px-5 pb-5">
          <p className="text-subhead leading-relaxed text-muted">
            This removes your name, payment details, budgets and comments, and takes you out of every
            group. Other people still see the expenses you shared, under the name &ldquo;Deleted
            user&rdquo;. You can&rsquo;t undo this.
          </p>

          {!checked ? (
            <p className="mt-6 text-body text-subtle">Checking…</p>
          ) : blocked ? (
            <p role="alert" className="mt-6 text-subhead font-semibold text-text">
              {blocked}
            </p>
          ) : (
            <div className="mt-6">
              <p className="text-subhead font-semibold text-text">Confirm it&rsquo;s you</p>
              {showKey ? (
                <>
                  <label className="mt-1 block text-body text-muted" htmlFor="delete-recovery-key">
                    Type your recovery key.
                  </label>
                  <textarea
                    id="delete-recovery-key"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="dvy_…"
                    rows={2}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="mt-3 w-full resize-none rounded-[var(--radius-md)] border border-transparent bg-surface-2 p-3 font-mono text-input text-text outline-none transition placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
                  />
                  <button
                    className={cn(danger, "mt-3")}
                    disabled={working || key.trim() === ""}
                    onClick={() => void remove({ recoveryKey: key })}
                  >
                    {working ? "Working…" : "Delete my account"}
                  </button>
                  {!canPasskey ? (
                    <p className="mt-2 text-caption text-subtle">
                      Lost it? Make a new one under Recovery key, then come back.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    className={cn(danger, "mt-3")}
                    disabled={working}
                    onClick={() => void provePasskey().then((passkey) => remove({ passkey }), (reason: unknown) => {
                      if (!(reason instanceof PasskeyCancelled)) setError("Your passkey didn't work. Try your recovery key.");
                    })}
                  >
                    {working ? "Working…" : "Delete with my passkey"}
                  </button>
                  <button
                    className="mt-2 w-full py-2 text-body font-semibold text-muted"
                    onClick={() => setUseKey(true)}
                  >
                    Use my recovery key instead
                  </button>
                </>
              )}
              {error ? (
                <p role="alert" className="mt-3 text-body text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          )}

          <button
            onClick={close}
            className="mt-4 h-11 w-full rounded-[var(--radius-md)] border border-line bg-surface-2 text-subhead font-semibold text-text transition active:opacity-70"
          >
            Cancel
          </button>
        </div>
      </Sheet>
    </WhileOpen>
  );
}
