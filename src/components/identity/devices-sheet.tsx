"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Laptop, Loader2, MonitorSmartphone, Smartphone, Tablet, Trash2, TriangleAlert } from "lucide-react";
import { loadQrLibrary } from "@/components/ui/qr-code";
import { Sheet } from "@/components/ui/sheet";
import { useResetOnOpen } from "@/components/ui/use-reset-on-open";
import { Button, cn, haptic } from "@/components/ui/primitives";
import { formatSignInCode } from "@/lib/invite-code";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/client/api";
import { PasskeyCancelled, passkeysSupported, registerPasskey } from "./passkey";

interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  rpId: string | null;
  usableHere: boolean;
}

interface DeviceSession {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface Devices {
  rpId: string;
  passkeys: Passkey[];
  hasRecoveryKey: boolean;
  sessions: DeviceSession[];
}

/**
 * Everything that can currently reach this account, and the two ways to add
 * another one.
 *
 * The list matters as much as the buttons. Before this, "who can get into my
 * ledger" had no answer anywhere in the app — the honest one was "whoever has
 * ever held your recovery key", which is not something a screen could show
 * because nothing was recorded.
 */
export function DevicesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const [linking, setLinking] = React.useState(false);

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.get<Devices>("/api/identity/devices"),
    enabled: open,
  });

  const addPasskey = useMutation({
    mutationFn: () => registerPasskey(),
    onSuccess: () => {
      toast({ tone: "success", title: "Passkey added" });
      void client.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => {
      if (error instanceof PasskeyCancelled) return;
      toast({
        tone: "error",
        title: "Couldn't add that passkey",
        description: error instanceof ApiError ? error.message : undefined,
      });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/identity/devices/${id}`),
    onSuccess: () => {
      toast({ tone: "success", title: "Removed" });
      void client.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) =>
      toast({
        tone: "error",
        title: "Couldn't remove that",
        description: error instanceof ApiError ? error.message : undefined,
      }),
  });

  const data = devices.data;
  const stale = data?.passkeys.filter((p) => !p.usableHere) ?? [];

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Your devices" tall>
        <div className="space-y-6 px-5 pb-8">
          <p className="text-subhead leading-relaxed text-muted">
            Anything on this list can open your account. Remove anything you don&rsquo;t use.
          </p>

          <div className="space-y-2.5">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                haptic();
                setLinking(true);
              }}
            >
              Add another device
            </Button>
            {passkeysSupported() ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                loading={addPasskey.isPending}
                onClick={() => {
                  haptic();
                  addPasskey.mutate();
                }}
              >
                Add a passkey on this device
              </Button>
            ) : null}
          </div>

          {/*
            A passkey made against another domain is not broken, it is simply
            not offered here — the browser will never surface it. Saying so is
            the difference between understanding a move and concluding the app
            has lost your account.
          */}
          {stale.length > 0 ? (
            <div className="flex gap-3 rounded-[var(--radius-md)] border border-warning-line bg-warning-soft p-3.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-text" />
              <p className="text-caption leading-relaxed text-warning-soft-text">
                {stale.length === 1 ? "One passkey was" : `${stale.length} passkeys were`} made
                on a different web address, so {stale.length === 1 ? "it" : "they"} won&rsquo;t work
                here. Add a new passkey here, then remove the old{" "}
                {stale.length === 1 ? "one" : "ones"}.
              </p>
            </div>
          ) : null}

          {devices.isLoading ? (
            <p className="py-6 text-center text-subhead text-subtle">Loading…</p>
          ) : null}

          {data && data.passkeys.length > 0 ? (
            <section>
              <h3 className="mb-2 text-caption font-medium tracking-wider text-subtle">
                Passkeys
              </h3>
              <ul className="space-y-2">
                {data.passkeys.map((passkey) => (
                  <Row
                    key={passkey.id}
                    icon={<KeyRound className="size-[18px]" />}
                    title={passkey.label}
                    detail={
                      passkey.usableHere
                        ? passkey.lastUsedAt
                          ? `Last used ${when(passkey.lastUsedAt)}`
                          : `Added ${when(passkey.createdAt)}`
                        : `Made on ${passkey.rpId ?? "another address"}, doesn't work here`
                    }
                    dimmed={!passkey.usableHere}
                    busy={revoke.isPending}
                    onRemove={() => revoke.mutate(passkey.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data && data.sessions.length > 0 ? (
            <section>
              <h3 className="mb-2 text-caption font-medium tracking-wider text-subtle">
                Signed in
              </h3>
              <ul className="space-y-2">
                {data.sessions.map((item) => (
                  <Row
                    key={item.id}
                    icon={<DeviceIcon label={item.label} />}
                    title={item.current ? `${item.label} · this device` : item.label}
                    detail={
                      item.current
                        ? "Removing this one signs you out here"
                        : `Last seen ${when(item.lastSeenAt)}`
                    }
                    busy={revoke.isPending}
                    onRemove={() => revoke.mutate(item.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {data && !data.hasRecoveryKey ? (
            <p className="text-caption leading-relaxed text-muted">
              You haven&rsquo;t saved a recovery key. If you lose all of these, you won&rsquo;t be
              able to get back in. You can make one on the Account screen.
            </p>
          ) : null}
        </div>
      </Sheet>

      <LinkSheet open={linking} onClose={() => setLinking(false)} />
    </>
  );
}

/** A computer gets a computer, not a phone. The label comes from describeDevice. */
function DeviceIcon({ label }: { label: string }) {
  const Icon = /^(iPhone|Android)/.test(label)
    ? Smartphone
    : /^iPad/.test(label)
      ? Tablet
      : /^(Mac|Windows|Linux)/.test(label)
        ? Laptop
        : MonitorSmartphone;
  return <Icon className="size-[18px]" />;
}

function Row({
  icon,
  title,
  detail,
  onRemove,
  busy,
  dimmed = false,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onRemove: () => void;
  busy: boolean;
  dimmed?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface p-3",
        dimmed && "opacity-60",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-subhead font-semibold text-text">{title}</span>
        <span className="block truncate text-caption text-subtle">{detail}</span>
      </span>
      <button
        onClick={() => {
          haptic();
          onRemove();
        }}
        disabled={busy}
        aria-label={`Remove ${title}`}
        className="tap-44 relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition active:opacity-70 hover:bg-surface-2 hover:text-danger disabled:opacity-40"
      >
        <Trash2 className="size-[18px]" />
      </button>
    </li>
  );
}

/**
 * The QR code that moves an account onto a second device.
 *
 * Fetched when the sheet opens rather than up front, because asking for one
 * mints a live credential — and a code nobody is looking at is a code sitting
 * on a screen somewhere being valid.
 */
function LinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [png, setPng] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [expired, setExpired] = React.useState(false);

  const create = useMutation({
    // The QR library is fetched alongside the code, so neither waits for the
    // other and a library that can't arrive fails here, with the request.
    mutationFn: async () => {
      const [data, QRCode] = await Promise.all([
        api.post<{ code: string; path: string; expiresInSeconds: number }>("/api/identity/link"),
        loadQrLibrary(),
      ]);
      const absolute = `${window.location.origin}${data.path}`;
      const png = await QRCode.toDataURL(absolute, {
        width: 512,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      return { code: data.code, png, expiresInSeconds: data.expiresInSeconds };
    },
    onSuccess: ({ code, png, expiresInSeconds }) => {
      setCode(code);
      setExpired(false);
      setPng(png);
      window.setTimeout(() => setExpired(true), expiresInSeconds * 1000);
    },
    onError: (error) =>
      toast({
        tone: "error",
        title: "Couldn't make a code",
        description: error instanceof ApiError ? error.message : undefined,
      }),
  });

  // Clearing during render rather than in an effect, so a reopened sheet never
  // paints the previous code for a frame — see `useResetOnOpen`.
  useResetOnOpen(open, () => {
    setPng(null);
    setCode(null);
    setCopied(false);
    setExpired(false);
  });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      haptic([8, 30, 8]);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Some in-app browsers block the clipboard. The code is on screen.
      toast({ tone: "error", title: "Couldn't copy", description: "Please copy the code by hand." });
    }
  };

  const start = create.mutate;
  React.useEffect(() => {
    if (open) start();
  }, [open, start]);

  return (
    <Sheet open={open} onClose={onClose} title="Add another device">
      <div className="space-y-5 px-5 pb-8">
        <p className="text-subhead leading-relaxed text-muted">
          On your other phone or computer, open the camera and point it at this code. It signs
          you in there, with nothing to type.
        </p>

        <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white p-4">
          {create.isPending || (!png && !expired) ? (
            <Loader2 className="size-8 animate-spin text-subtle" />
          ) : expired ? (
            <div className="text-center">
              <p className="mb-3 text-subhead font-semibold text-text">This code has expired</p>
              <Button variant="secondary" onClick={() => create.mutate()}>
                Show a new one
              </Button>
            </div>
          ) : png ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI, generated in-page
            <img src={png} alt="Device link QR code" className="size-full object-contain" />
          ) : null}
        </div>

        {code && !expired ? (
          <div>
            <p className="text-body-lg font-semibold text-text">Or use a sign-in code</p>
            <p className="mt-1 text-body leading-relaxed text-muted">
              For this same phone, between its browser and the home-screen app, or a computer with
              no camera. Choose &ldquo;Sign in with a code&rdquo; there and enter this.
            </p>
            <p
              className="mt-3 select-all rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-center font-mono text-title font-medium text-text"
              style={{ userSelect: "all", WebkitUserSelect: "all" }}
            >
              {formatSignInCode(code)}
            </p>
            <Button
              variant={copied ? "positive" : "secondary"}
              size="lg"
              fullWidth
              className="mt-2"
              onClick={() => void copy(formatSignInCode(code))}
              icon={copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
            >
              {copied ? "Copied" : "Copy sign-in code"}
            </Button>
          </div>
        ) : null}

        <p className="text-caption leading-relaxed text-subtle">
          The picture and the code work once and stop working after five minutes. Anyone who gets
          either can get into your account, so only use them on your own device.
        </p>
      </div>
    </Sheet>
  );
}

function when(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
