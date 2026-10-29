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
  Bell,
  Coins,
  Heart,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  MonitorSmartphone,
  Plus,
  Sun,
  Target,
  Trash2,
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
import { ConfirmDeleteSheet } from "@/components/identity/confirm-delete";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { clearRecoveryPending, recoveryPending, saveRecoveryKeyFile } from "@/lib/client/recovery";
import { useTheme } from "@/components/theme";
import { useBudgets, useDashboard, useUpdateProfile, keys } from "@/lib/client/queries";
import { api, ApiError } from "@/lib/client/api";
import { pending } from "@/lib/client/outbox";
import { wipeLocalData } from "@/lib/client/wipe";
import { usePrivacyScreenSetting } from "@/components/privacy-screen";
import { useClientValue, useMirror, useResetOnClose } from "@/components/ui/state-hooks";
import { disablePush, enablePush, pushEnabled, pushSupport, type PushSupport } from "@/lib/client/push";
import { storageStatus, type StorageStatus } from "@/lib/client/persistence";
import { PAYMENT_KINDS } from "@/lib/payments";
import { initials } from "@/lib/avatar";
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

  const [name, setName] = useMirror(data?.me.displayName ?? "");
  const [currencyOpen, setCurrencyOpen] = React.useState(false);
  const [myCode, setMyCode] = React.useState(false);
  const [recovery, setRecovery] = React.useState(false);
  const [payments, setPayments] = React.useState(false);
  const [budgetsOpen, setBudgets] = React.useState(false);
  const [devicesOpen, setDevices] = React.useState(false);
  const [confirmSignOut, setConfirmSignOut] = React.useState(false);
  const [discardCount, setDiscardCount] = React.useState(0);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // Whether the recovery key made at sign-up was never confirmed saved. Lives in
  // localStorage, so it is read without an effect and hidden once a new one is.
  const keyPending = useClientValue(recoveryPending, false);
  const [keySaved, setKeySaved] = React.useState(false);
  const keyUnsaved = keyPending && !keySaved;
  const [emojiOpen, setEmojiOpen] = React.useState(false);


  if (isLoading || !data) {
    return (
      <div className="pt-8">
        <Skeleton className="h-24 w-full rounded-[var(--radius-xl)]" />
      </div>
    );
  }

  const me = data.me;

  /**
   * Signs this device out and removes everything it holds.
   *
   * Unsynced changes used to block signing out outright - which, with a change
   * the server kept refusing, meant a device that could never sync and never
   * be signed out. Now the person is told how many would be lost and decides.
   */
  const signOut = async (discardUnsynced = false) => {
    const queued = await pending();
    if (queued.length > 0 && !discardUnsynced) {
      setConfirmSignOut(false);
      setDiscardCount(queued.length);
      return;
    }

    try {
      // Stop this phone getting the account's notifications. The server drops
      // the subscription with the session too; this also tells the browser.
      await disablePush().catch(() => {});
      await api.del("/api/identity");
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't sign out",
        description:
          error instanceof ApiError && error.isOffline
            ? "You're offline. Connect to the internet and try again."
            : error instanceof ApiError
              ? error.message
              : undefined,
      });
      return;
    }
    setDiscardCount(0);
    await wipeLocalData(client);
    router.refresh();
  };

  // The delete itself, with confirming it's you, is the panel's
  // (ConfirmDeleteSheet); this is what follows once it's done.
  const accountDeleted = async () => {
    await wipeLocalData(client);
    setConfirmDelete(false);
    toast({ tone: "success", title: "Your account is deleted" });
    router.refresh();
  };

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-5 text-heading font-semibold tracking-[-0.02em] text-text">You</h1>

      {/* Profile ----------------------------------------------------------- */}
      <section className="flex items-center gap-4">
        {/* Tap your avatar to change how you look: colour, then emoji. */}
        <button
          onClick={() => {
            haptic();
            setEmojiOpen(true);
          }}
          aria-label={me.avatarEmoji ? "Change your emoji" : "Pick an emoji"}
          className="shrink-0 rounded-full transition-opacity active:opacity-70"
        >
          <Avatar person={me} size="lg" />
        </button>
        <div className="min-w-0 flex-1">
          {/* The field is 30 tall with "Change how you look" just under it,
              so both reach away from each other to make 44: this one up,
              over the empty space under the heading, that one down. */}
          <label className="-mt-3.5 block pt-3.5">
          <input
            dir="auto"
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
            className="w-full text-ellipsis rounded-[var(--radius-sm)] bg-transparent text-title-lg font-semibold tracking-[-0.02em] text-text outline-none transition focus:bg-surface-2 focus:px-2 focus:py-1 focus:ring-[1.5px] focus:ring-text"
          />
          </label>
          <p className="mt-0.5 text-caption text-subtle">
            Member since{" "}
            {new Date(me.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            {" · "}
            <button
              onClick={() => {
                haptic();
                setEmojiOpen(true);
              }}
              className="relative text-text underline-offset-2 after:absolute after:inset-x-0 after:top-0 after:-bottom-6 hover:underline"
            >
              Change how you look
            </button>
          </p>
        </div>
      </section>

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        value={me.avatarEmoji}
        onSelect={(avatarEmoji) => updateProfile.mutate({ avatarEmoji })}
        initials={initials(me.displayName)}
        color={me.avatarColor}
        onColor={(avatarColor) => updateProfile.mutate({ avatarColor })}
      />

      {/* Getting paid ------------------------------------------------------- */}
      <Group title="Getting paid">
        <Row
          icon={<Wallet className="size-[18px]" strokeWidth={1.75} />}
          label="How people can pay you"
          value={me.paymentMethods.length > 0 ? `${me.paymentMethods.length} saved` : "Not set up"}
          onClick={() => setPayments(true)}
        />
        <Row
          icon={<KeyRound className="size-[18px]" strokeWidth={1.75} />}
          label="Your invite code"
          value={me.inviteCode}
          onClick={() => setMyCode(true)}
        />
      </Group>

      {/* Preferences -------------------------------------------------------- */}
      <Group title="Preferences">
        <Row
          icon={<Coins className="size-[18px]" strokeWidth={1.75} />}
          label="Default currency"
          value={me.defaultCurrency}
          onClick={() => setCurrencyOpen(true)}
        />
        <Row
          icon={<Target className="size-[18px]" strokeWidth={1.75} />}
          label="Budgets"
          value={budgets && budgets.length > 0 ? `${budgets.length} set` : "None yet"}
          onClick={() => setBudgets(true)}
        />
        <div className="px-4 py-3">
          <p className="mb-1 flex items-center gap-3 text-body-lg font-medium text-text">
            <Moon className="size-[18px] text-muted" strokeWidth={1.75} />
            Appearance
          </p>
          <Segmented
            kind="choice"
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-3.5" />Light</span> },
              { value: "dark", label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-3.5" />Night</span> },
              { value: "system", label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-3.5" />Auto</span> },
            ]}
          />
        </div>
        <NotificationsRow />
        <div className="flex items-center gap-3 px-4 py-3">
          <EyeOff className="size-[18px] shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-medium text-text">Privacy screen</span>
            <span className="mt-0.5 block text-caption leading-snug text-subtle">
              Hides your balances when you switch apps.
            </span>
          </span>
          <Switch checked={privacyScreen} onChange={setPrivacyScreen} label="Hide balances when you switch apps" />
        </div>
      </Group>

      {/* Security and backup ------------------------------------------------ */}
      <Group title="Security and backup">
        {keyUnsaved ? (
          <button
            onClick={() => {
              haptic();
              setRecovery(true);
            }}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
          >
            <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-negative-text" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-medium text-text">Back up your account</span>
              <span className="mt-0.5 block text-caption leading-snug text-muted">
                You haven&rsquo;t saved a recovery key. Without it you can&rsquo;t get back in on a new phone.
              </span>
            </span>
          </button>
        ) : null}
        <Row
          icon={<MonitorSmartphone className="size-[18px]" strokeWidth={1.75} />}
          label="Your devices"
          value="Manage"
          onClick={() => setDevices(true)}
        />
        <Row
          icon={<KeyRound className="size-[18px]" strokeWidth={1.75} />}
          label="Recovery key"
          value={keyUnsaved ? "Not saved" : "Manage"}
          onClick={() => setRecovery(true)}
        />
      </Group>

      {/* Your data ---------------------------------------------------------- */}
      <Group
        title="Your data"
        caption="A file with all your groups, expenses and payments. Receipt photos aren’t included."
      >
        <Row
          icon={<Download className="size-[18px]" strokeWidth={1.75} />}
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
      </Group>
      <StorageRow />

      {/* About -------------------------------------------------------------- */}
      <Group title="About">
        <a href="/privacy" className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
          <Heart className="size-[18px] shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-body-lg font-medium text-text">What Divvy stores about you</span>
            <span className="mt-0.5 block text-caption text-subtle">Free to use. No ads, no tracking.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-subtle" />
        </a>
        {/*
          Which build this actually is.

          Added because there was no way to answer the question. A fix can be
          merged, deployed and still absent from somebody's phone — a stalled
          deploy and a stale cache look identical from the outside, and both
          look like the fix never worked. Hidden behind a tap: a raw build code
          is noise to everyone except the person asking "is the fix on your
          phone yet?". Selectable once shown, because it exists to be read out.
        */}
        <div className="px-4 py-3">
          <VersionLine />
        </div>
      </Group>

      {/* Danger zone, apart and at the very end. ---------------------------- */}
      <Group title="Danger zone">
        <Row
          icon={<LogOut className="size-[18px]" strokeWidth={1.75} />}
          label="Sign out on this device"
          tone="danger"
          onClick={() => setConfirmSignOut(true)}
        />
        <Row
          icon={<Trash2 className="size-[18px]" strokeWidth={1.75} />}
          label="Delete my account"
          tone="danger"
          onClick={() => setConfirmDelete(true)}
        />
      </Group>
      <div className="h-6" />

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
        onSaved={() => setKeySaved(true)}
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
        description="Your groups and expenses stay safe, but they'll be removed from this phone. To sign back in you'll need your recovery key or a passkey, so make sure you have one."
        confirmLabel="Sign out"
      />

      <ConfirmSheet
        open={discardCount > 0}
        onClose={() => setDiscardCount(0)}
        onConfirm={() => void signOut(true)}
        title={`${discardCount} change${discardCount === 1 ? " hasn't" : "s haven't"} been sent yet`}
        description="These changes are only on this phone. If you sign out now, they'll be lost. To keep them, connect to the internet and wait a moment."
        confirmLabel="Sign out and lose them"
      />

      <ConfirmDeleteSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onDeleted={accountDeleted}
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

  // Only worth saying when it's actually a risk.
  if (!status?.supported || status.persisted) return null;

  return (
    <div className="mt-3 flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface shadow-card px-4 py-3">
      <span className="shrink-0 pt-0.5 text-muted">
        <Database className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-lg font-medium text-text">May be cleared by your phone</p>
        <p className="mt-0.5 text-caption leading-snug text-subtle">
          If your phone runs low on space, your browser may delete Divvy&rsquo;s offline copy. Add Divvy
          to your home screen (Share, then Add to Home Screen) to stop this.
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

/** A titled, grouped list: one card, rows separated by hairlines. */
function Group({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
      <div className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
        {children}
      </div>
      {caption ? <p className="mt-2 px-1 text-caption leading-relaxed text-subtle">{caption}</p> : null}
    </section>
  );
}

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
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <span className={cn("shrink-0", tone === "danger" ? "text-danger" : "text-muted")}>
        {icon}
      </span>
      {/* The label wraps rather than being cut: it says what the row is. The
          value beside it is the one that gives way. */}
      <span
        className={cn(
          "min-w-0 flex-1 text-body-lg font-medium",
          tone === "danger" ? "text-danger" : "text-text",
        )}
      >
        {label}
      </span>
      {value ? (
        <span className="max-w-[45%] shrink-0 truncate text-body text-subtle">{value}</span>
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
  // reason.
  useResetOnClose(open, () => setKey(null));

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
        title: "Couldn't make a new key",
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
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant={copied ? "positive" : "primary"}
                fullWidth
                onClick={() => void copy()}
                icon={copied ? <Check className="size-[17px]" /> : <Copy className="size-[17px]" />}
              >
                {copied ? "Copied" : "Copy key"}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => saveRecoveryKeyFile(key)}
                icon={<Download className="size-[17px]" strokeWidth={1.75} />}
              >
                Save as file
              </Button>
            </div>
            <p className="mt-4 rounded-[var(--radius-md)] bg-warning-soft p-3.5 text-body leading-relaxed text-text">
              Save this now. You won&rsquo;t be able to see it again, and your old key
              no longer works.
            </p>
          </>
        ) : (
          <>
            <p className="text-subhead leading-relaxed text-muted">
              Your recovery key is how you get into your account on a new phone.
              We can&rsquo;t show you your old key again, but you can make a new one.
            </p>

            <div className="mt-5 flex gap-3 rounded-[var(--radius-md)] bg-negative-soft p-3.5">
              <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-negative-text" />
              <p className="text-body leading-relaxed text-negative-text">
                Making a new key stops the old one from working. Any other phone
                signed in with the old key will be signed out.
              </p>
            </div>

            <Button
              variant="secondary"
              fullWidth
              className="mt-5"
              loading={busy}
              onClick={() => void rotate()}
            >
              Make a new recovery key
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
        title: "Couldn't save that",
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
          Divvy never moves money. Add your UPI ID, bank details or payment app
          username so friends know how to pay you back.
        </p>

        {methods.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {methods.map((method) => {
              const entry = PAYMENT_KINDS.find((k) => k.value === method.kind);
              return (
                <li
                  key={method.id}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3 py-2.5"
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
                    className="tap-44 relative flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:opacity-70 hover:bg-negative-soft hover:text-negative"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--card-border)] bg-surface shadow-card p-3.5">
          <p className="mb-2.5 text-body font-semibold text-text">Add a way to pay</p>

          <div className="no-scrollbar -mx-1 -mt-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
            {PAYMENT_KINDS.map((entry) => (
              <button
                key={entry.value}
                aria-pressed={kind === entry.value}
                onClick={() => {
                  haptic();
                  setKind(entry.value);
                }}
                className={cn(
                  "tap-44 relative flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-body font-medium transition-colors",
                  kind === entry.value
                    ? "border-text bg-text text-inverse"
                    : "border-line bg-surface text-text hover:bg-surface-2",
                )}
              >
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
              className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:ring-[1.5px] focus:ring-text"
            />
            <button
              onClick={() => void add()}
              disabled={!value.trim() || busy}
              aria-label="Add payment method"
              className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand text-inverse transition active:opacity-70 disabled:opacity-40"
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

/**
 * Phone notifications, per device: the switch reflects whether this browser
 * is subscribed, not a setting on the account.
 */
function NotificationsRow() {
  const toast = useToast();
  const [support, setSupport] = React.useState<PushSupport | null>(null);
  const [on, setOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    const s = pushSupport();
    void (async () => {
      const enabled = s === "ready" ? await pushEnabled().catch(() => false) : false;
      if (!alive) return;
      setSupport(s);
      setOn(enabled);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (support === null || support === "unsupported") return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const result = await enablePush();
        if (result === "on") {
          setOn(true);
          toast({ tone: "success", title: "Notifications are on" });
        } else if (result === "denied") {
          setSupport(pushSupport());
          toast({ tone: "info", title: "Notifications are blocked", description: "Allow them for Divvy in your phone's settings, then try again." });
        } else {
          toast({ tone: "info", title: "Notifications aren't available here yet" });
        }
      } else {
        await disablePush();
        setOn(false);
      }
    } catch (error) {
      toast({ tone: "error", title: "Couldn't change that", description: error instanceof ApiError ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0 text-muted">
        <Bell className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-lg font-medium text-text">Notifications</span>
        <span className="mt-0.5 block text-caption leading-snug text-subtle">
          {support === "install"
            ? "To get notifications on iPhone, add Divvy to your home screen first."
            : support === "blocked"
              ? "Notifications are blocked for Divvy. You can allow them in your phone's settings."
              : "Get a message on this phone when someone adds an expense with you, pays you, or sends a reminder."}
        </span>
      </span>
      {support === "ready" ? (
        <Switch
          checked={on}
          onChange={(next) => {
            if (!busy) void toggle(next);
          }}
          label="Notifications on this phone"
        />
      ) : null}
    </div>
  );
}

function VersionLine() {
  const [shown, setShown] = React.useState(false);
  const build = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  return shown ? (
    <p className="select-text text-body text-subtle">
      Version 1.0 ({build.slice(0, 7)})
    </p>
  ) : (
    <button onClick={() => setShown(true)} className="text-body text-subtle underline-offset-2 hover:underline">
      Version
    </button>
  );
}
