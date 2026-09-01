"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Copy,
  Database,
  Download,
  EyeOff,
  Heart,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Smartphone,
  Plus,
  Sun,
  Target,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { Sheet, ConfirmSheet } from "@/components/ui/sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button, Segmented, Skeleton, Switch, cn, haptic } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { CurrencyPicker } from "@/components/expense/currency-picker";
import { MyCodeSheet } from "@/components/friends/my-code-sheet";
import { BudgetsSheet } from "@/components/budget/budgets-sheet";
import { DevicesSheet } from "@/components/identity/devices-sheet";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { clearRecoveryPending, recoveryPending } from "@/lib/client/recovery";
import { useTheme } from "@/components/theme";
import { useBudgets, useDashboard, useUpdateProfile, keys } from "@/lib/client/queries";
import { api, ApiError } from "@/lib/client/api";
import { clear as clearOutbox, pending } from "@/lib/client/outbox";
import { usePrivacyScreenSetting } from "@/components/privacy-screen";
import { storageStatus, type StorageStatus } from "@/lib/client/persistence";
import { PAYMENT_KINDS } from "@/lib/payments";
import { AVATAR_COLORS, initials } from "@/lib/avatar";
import type { PaymentMethodDto } from "@/lib/types";

export default function AccountPage() {
  const { data, isLoading } = useDashboard();
  const { data: budgets } = useBudgets();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const updateProfile = useUpdateProfile();
  const [privacyScreen, setPrivacyScreen] = usePrivacyScreenSetting();

  const [name, setName] = React.useState("");
  const [currencyOpen, setCurrencyOpen] = React.useState(false);
  const [myCode, setMyCode] = React.useState(false);
  const [recovery, setRecovery] = React.useState(false);
  const [payments, setPayments] = React.useState(false);
  const [budgetsOpen, setBudgets] = React.useState(false);
  const [devicesOpen, setDevices] = React.useState(false);
  const [confirmSignOut, setConfirmSignOut] = React.useState(false);
  const [keyUnsaved, setKeyUnsaved] = React.useState(false);
  const [emojiOpen, setEmojiOpen] = React.useState(false);

  React.useEffect(() => {
    if (data) setName(data.me.displayName);
  }, [data]);

  // Read after mount: the server has no localStorage, and initialising from it
  // during render would mismatch hydration.
  React.useEffect(() => setKeyUnsaved(recoveryPending()), []);

  if (isLoading || !data) {
    return (
      <div className="pt-8">
        <Skeleton className="h-24 w-full rounded-[var(--radius-xl)]" />
      </div>
    );
  }

  const me = data.me;

  const signOut = async () => {
    const queued = await pending();
    if (queued.length > 0) {
      toast({
        tone: "error",
        title: "Not yet — there are unsynced changes",
        description: `${queued.length} change${queued.length === 1 ? "" : "s"} still need to reach the server. Reconnect first.`,
      });
      setConfirmSignOut(false);
      return;
    }

    await api.del("/api/identity");
    await clearOutbox();
    client.clear();
    router.refresh();
  };

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-5 text-display-sm font-black tracking-[-0.03em] text-text">Account</h1>

      {/* Profile ----------------------------------------------------------- */}
      <section className="rounded-[var(--radius-xl)] border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-4">
          {/*
            The avatar is the obvious thing to tap to change how you look, so
            it opens the picker as well as the row below. A control nobody
            finds is not a control.
          */}
          <button
            onClick={() => {
              haptic();
              setEmojiOpen(true);
            }}
            aria-label="Change your emoji"
            className="shrink-0 rounded-full transition active:scale-90"
          >
            <Avatar person={me} size="lg" />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 60))}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== me.displayName) {
                  updateProfile.mutate({ displayName: trimmed });
                } else if (!trimmed) {
                  setName(me.displayName);
                }
              }}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label="Your name"
              className="w-full rounded-[var(--radius-sm)] bg-transparent text-title-lg font-bold tracking-[-0.02em] text-text outline-none transition focus:bg-surface-2 focus:px-2 focus:py-1"
            />
            <p className="mt-0.5 text-body text-subtle">
              Member since{" "}
              {new Date(me.createdAt).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/*
          The colour was editable here and the emoji was not, which made the
          emoji a one-shot decision taken during onboarding — the moment
          somebody is least sure what they want to look like for the next year.
        */}
        <button
          onClick={() => {
            haptic();
            setEmojiOpen(true);
          }}
          className="mt-4 flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-2.5 text-left transition active:scale-[0.985]"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-body-lg font-bold text-white"
            style={{ background: `var(--avatar-${me.avatarColor})` }}
          >
            {me.avatarEmoji ?? initials(me.displayName)}
          </span>
          <span className="flex-1 text-body-lg font-semibold text-text">
            {me.avatarEmoji ? "Change your emoji" : "Pick an emoji"}
          </span>
          <ChevronRight className="size-4 shrink-0 text-subtle" />
        </button>

        <EmojiPicker
          open={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          value={me.avatarEmoji}
          onSelect={(avatarEmoji) => updateProfile.mutate({ avatarEmoji })}
          initials={initials(me.displayName)}
        />

        <div className="mt-4 flex flex-wrap gap-1.5">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => {
                haptic();
                updateProfile.mutate({ avatarColor: color });
              }}
              aria-label={`Use the ${color} avatar colour`}
              className={cn(
                "size-7 rounded-full transition active:scale-90",
                me.avatarColor === color && "ring-2 ring-brand ring-offset-2 ring-offset-[var(--surface)]",
              )}
              style={{ background: `var(--avatar-${color})` }}
            />
          ))}
        </div>
      </section>

      {/* Preferences -------------------------------------------------------- */}
      <section className="mt-5">
        <h2 className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
          Preferences
        </h2>

        <div className="space-y-1.5">
          <Row
            icon={<Wallet className="size-[18px]" />}
            label="Default currency"
            value={me.defaultCurrency}
            onClick={() => setCurrencyOpen(true)}
          />
          <Row
            icon={<KeyRound className="size-[18px]" />}
            label="Your invite code"
            value={me.inviteCode}
            onClick={() => setMyCode(true)}
          />
          <Row
            icon={<Wallet className="size-[18px]" />}
            label="How people can pay you"
            value={
              me.paymentMethods.length > 0
                ? `${me.paymentMethods.length} saved`
                : "Not set up"
            }
            onClick={() => setPayments(true)}
          />
          <Row
            icon={<Target className="size-[18px]" />}
            label="Budgets"
            value={
              budgets && budgets.length > 0
                ? `${budgets.length} set`
                : "None yet"
            }
            onClick={() => setBudgets(true)}
          />
        </div>

        <div className="mt-1.5 flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3">
          <span className="shrink-0 text-muted">
            <EyeOff className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-semibold text-text">Privacy screen</span>
            <span className="mt-0.5 block text-caption leading-snug text-subtle">
              Cover the screen when you switch apps, so balances stay out of the
              app switcher. It is a curtain, not a lock — anyone holding an
              unlocked phone can still open Divvy.
            </span>
          </span>
          <Switch
            checked={privacyScreen}
            onChange={setPrivacyScreen}
            label="Cover the screen when the app is in the background"
          />
        </div>

        <div className="mt-3 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
          <p className="mb-2.5 text-body font-semibold text-text">Appearance</p>
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-3.5" />Light</span> },
              { value: "dark", label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
              { value: "system", label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-3.5" />Auto</span> },
            ]}
          />
        </div>
      </section>

      {/* Data --------------------------------------------------------------- */}
      <section className="mt-5">
        <h2 className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
          Your data
        </h2>
        <div className="space-y-1.5">
          {keyUnsaved ? (
            <button
              onClick={() => {
                haptic();
                setRecovery(true);
              }}
              className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] bg-negative-soft p-3.5 text-left"
            >
              <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-negative-text" />
              <span className="text-body leading-relaxed text-negative-text">
                <b className="font-semibold">You never saved a recovery key.</b> Divvy
                keeps only a one-way hash of it, so the one made when you signed up
                cannot be shown again — without a key you cannot get this account back
                if you lose this device. Generate a new one now.
              </span>
            </button>
          ) : null}
          <Row
            icon={<Smartphone className="size-[18px]" />}
            label="Your devices"
            value="Manage"
            onClick={() => setDevices(true)}
          />
          <Row
            icon={<KeyRound className="size-[18px]" />}
            label="Recovery key"
            value={keyUnsaved ? "Not saved" : "Manage"}
            onClick={() => setRecovery(true)}
          />
          <Row
            icon={<Download className="size-[18px]" />}
            label="Download a backup"
            value="JSON"
            onClick={() => {
              // Absolute, and a full navigation rather than a router push:
              // this is a file download, not a page. The response carries
              // Content-Disposition, so the browser hands it to the OS
              // download handler rather than trying to render it.
              window.location.assign(new URL("/api/export", window.location.origin));
            }}
          />
          <Row
            icon={<LogOut className="size-[18px]" />}
            label="Sign out on this device"
            tone="danger"
            onClick={() => setConfirmSignOut(true)}
          />
        </div>

        <p className="mt-2 px-1 text-caption leading-relaxed text-subtle">
          The backup holds every group, expense and payment you can see, with
          the amounts as text so nothing is rounded. Receipts are listed but not
          included.
        </p>

        <StorageRow />
      </section>

      <footer className="mt-8 pb-4 text-center">
        <p className="flex items-center justify-center gap-1.5 text-caption text-subtle">
          Divvy · every feature, free
          <Heart className="size-3" />
        </p>
        <p className="mt-1 text-tiny text-subtle">
          No accounts, no ads, no tracking, no paywall.
        </p>
      </footer>

      {/* Sheets ------------------------------------------------------------- */}
      <CurrencyPicker
        open={currencyOpen}
        onClose={() => setCurrencyOpen(false)}
        value={me.defaultCurrency}
        onChange={(currency) => {
          updateProfile.mutate({ defaultCurrency: currency });
          setCurrencyOpen(false);
        }}
      />

      <MyCodeSheet open={myCode} onClose={() => setMyCode(false)} me={me} />

      <BudgetsSheet open={budgetsOpen} onClose={() => setBudgets(false)} />

      <DevicesSheet open={devicesOpen} onClose={() => setDevices(false)} />

      <RecoverySheet
        open={recovery}
        onClose={() => setRecovery(false)}
        onSaved={() => setKeyUnsaved(false)}
      />

      <PaymentMethodsSheet
        open={payments}
        onClose={() => setPayments(false)}
        methods={me.paymentMethods}
        onChanged={() => void client.invalidateQueries({ queryKey: keys.dashboard })}
      />

      <ConfirmSheet
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        onConfirm={() => void signOut()}
        title="Sign out on this device?"
        description="Your data stays on the server. You will need your recovery key to get back in — make sure you have it saved."
        confirmLabel="Sign out"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * What the browser has promised about the data on this device.
 *
 * Worth stating, because the answer is not the same everywhere and the
 * consequence is real: without persistence, a phone running low on space may
 * evict the offline queue, and a queued expense exists nowhere else. Shown as a
 * fact rather than as a problem to solve — there is no second button to press
 * if the browser said no, beyond installing the app, which is exactly what the
 * copy suggests.
 */
function StorageRow() {
  const [status, setStatus] = React.useState<StorageStatus | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void storageStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.supported) return null;

  return (
    <div className="mt-1.5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3">
      <span className="shrink-0 pt-0.5 text-muted">
        <Database className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-lg font-semibold text-text">
          {status.persisted ? "Kept on this device" : "Not protected from cleanup"}
        </p>
        <p className="mt-0.5 text-caption leading-snug text-subtle">
          {status.persisted
            ? "This browser has agreed not to clear Divvy's offline data to reclaim space."
            : "This browser may clear Divvy's offline data if the device runs low on space. Installing the app usually earns the guarantee."}
          {status.usage !== null ? ` Using ${formatBytes(status.usage)}.` : ""}
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------

function Row({
  icon,
  label,
  value,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3 text-left transition active:scale-[0.985] hover:bg-surface-2"
    >
      <span className={cn("shrink-0", tone === "danger" ? "text-negative" : "text-muted")}>
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body-lg font-semibold",
          tone === "danger" ? "text-negative-text" : "text-text",
        )}
      >
        {label}
      </span>
      {value ? (
        <span className="shrink-0 truncate text-body font-semibold text-subtle">{value}</span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * Recovery key management.
 *
 * There is no "show my key" here, and that is not an oversight: the server only
 * ever stored a SHA-256 of it. The honest options are to generate a new one -
 * which invalidates the old - or nothing. The copy says so plainly rather than
 * letting someone discover it at the worst moment.
 */
function RecoverySheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once a fresh key is on screen, so the account screen can drop its warning. */
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Cleared on *close* rather than on open: the key is a secret, and leaving
  // it in state after the sheet shuts keeps it in a heap snapshot for no
  // reason. Nothing paints it in that gap, so an effect is fine here.
  React.useEffect(() => {
    if (!open) setKey(null);
  }, [open]);

  const rotate = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ recoveryKey: string }>("/api/identity/recovery");
      setKey(result.recoveryKey);
      // The old key is dead the moment this returns, so whatever the account
      // was missing before, it is not missing now: there is a key on screen.
      clearRecoveryPending();
      onSaved?.();
      haptic([8, 30, 8]);
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not generate a key",
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
      toast({ tone: "success", title: "Copied" });
    } catch {
      toast({ tone: "info", title: "Copy it by hand" });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Recovery key">
      <div className="px-5 pb-6">
        {key ? (
          <>
            <div className="rounded-[var(--radius-lg)] border border-line bg-surface-2 p-4">
              <p
                className="break-all font-mono text-body leading-relaxed text-text"
                style={{ userSelect: "all", WebkitUserSelect: "all" }}
              >
                {key}
              </p>
            </div>
            <Button
              variant={copied ? "positive" : "primary"}
              fullWidth
              className="mt-3"
              onClick={() => void copy()}
              icon={copied ? <Check className="size-[17px]" /> : <Copy className="size-[17px]" />}
            >
              {copied ? "Copied" : "Copy key"}
            </Button>
            <p className="mt-4 rounded-[var(--radius-md)] bg-warning-soft p-3.5 text-body leading-relaxed text-text">
              Save this now. Any older key has stopped working, and this one is
              not retrievable later — the server only keeps a hash of it.
            </p>
          </>
        ) : (
          <>
            <p className="text-subhead leading-relaxed text-muted">
              Your recovery key is the only way to open this account on another
              device. Divvy stores a one-way hash of it, so it cannot be shown to
              you again — it can only be replaced.
            </p>

            <div className="mt-5 flex gap-3 rounded-[var(--radius-md)] bg-negative-soft p-3.5">
              <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-negative-text" />
              <p className="text-body leading-relaxed text-negative-text">
                Generating a new key immediately invalidates the old one. Any
                other device signed in with it will be locked out.
              </p>
            </div>

            <Button
              variant="secondary"
              fullWidth
              className="mt-5"
              loading={busy}
              onClick={() => void rotate()}
            >
              Generate a new recovery key
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function PaymentMethodsSheet({
  open,
  onClose,
  methods,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  methods: PaymentMethodDto[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = React.useState(PAYMENT_KINDS[0].value);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const selected = PAYMENT_KINDS.find((entry) => entry.value === kind)!;

  const add = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/identity/payment-methods", { kind, value: value.trim() });
      setValue("");
      onChanged();
      haptic();
      toast({ tone: "success", title: "Saved" });
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not save that",
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    haptic();
    await api.del(`/api/identity/payment-methods/${id}`);
    onChanged();
  };

  return (
    <Sheet open={open} onClose={onClose} tall title="How people can pay you">
      <div className="px-5 pb-6">
        <p className="text-body-lg leading-relaxed text-muted">
          Divvy never handles money. These handles just give your friends a
          tappable shortcut into their own banking app when they settle up.
        </p>

        {methods.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {methods.map((method) => {
              const entry = PAYMENT_KINDS.find((k) => k.value === method.kind);
              return (
                <li
                  key={method.id}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2.5"
                >
                  <span className="text-title">{entry?.emoji ?? "💸"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-text">
                      {entry?.label ?? method.kind}
                    </span>
                    <span className="block truncate text-caption text-subtle">
                      {method.value}
                    </span>
                  </span>
                  <button
                    onClick={() => void remove(method.id)}
                    aria-label={`Remove ${entry?.label ?? method.kind}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-negative-soft hover:text-negative"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-5 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
          <p className="mb-2.5 text-body font-semibold text-text">Add a method</p>

          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {PAYMENT_KINDS.map((entry) => (
              <button
                key={entry.value}
                onClick={() => {
                  haptic();
                  setKind(entry.value);
                }}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-body font-semibold transition active:scale-95",
                  kind === entry.value
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface-2 text-muted",
                )}
              >
                <span>{entry.emoji}</span>
                {entry.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-2">
            <input
              value={value}
              onChange={(event) => setValue(event.target.value.slice(0, 140))}
              onKeyDown={(event) => void (event.key === "Enter" && add())}
              placeholder={selected.placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
            />
            <button
              onClick={() => void add()}
              disabled={!value.trim() || busy}
              aria-label="Add payment method"
              className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand text-white transition active:scale-90 disabled:opacity-40"
            >
              <Plus className="size-5" />
            </button>
          </div>

          {selected.hint ? (
            <p className="mt-2 text-caption leading-relaxed text-subtle">{selected.hint}</p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
