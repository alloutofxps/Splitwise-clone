"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button, cn, haptic } from "./ui/primitives";
import { useToast } from "./ui/toast";
import { Wordmark } from "./app-shell";
import { api, ApiError } from "@/lib/client/api";
import { keys } from "@/lib/client/queries";
import { clearRecoveryPending, markRecoveryPending } from "@/lib/client/recovery";
import { colorForName, initials } from "@/lib/avatar";
import {
  PasskeyCancelled,
  hasPlatformAuthenticator,
  signInWithPasskey,
} from "./identity/passkey";
import { CURRENCIES } from "@/lib/money";
import type { MeDto } from "@/lib/types";

/**
 * Setup.
 *
 * There is no sign-up here because there are no accounts. What replaces it is
 * one question - what should we call you - and one thing to keep safe. That is
 * the whole trade this app makes: no email, no password, no verification link,
 * in exchange for the user being responsible for a recovery key.
 *
 * Which means the recovery step cannot be skipped past casually. It is the one
 * screen in the app that deliberately slows the user down, because a person who
 * loses this key loses their history, and telling them that afterwards is far
 * too late.
 */

type Step = "welcome" | "profile" | "recovery" | "restore";

const EMOJI_CHOICES = ["🙂", "😎", "🦊", "🐙", "🌵", "🍕", "⚡️", "🌊", "🎧", "🚲", "🪐", "🐝"];

export function Onboarding({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = React.useState<Step>("welcome");
  const [recoveryKey, setRecoveryKey] = React.useState<string | null>(null);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <AnimatePresence mode="wait">
        {step === "welcome" ? (
          <StepShell key="welcome">
            <Welcome onStart={() => setStep("profile")} onRestore={() => setStep("restore")} />
          </StepShell>
        ) : null}

        {step === "profile" ? (
          <StepShell key="profile">
            <ProfileStep
              onDone={(key) => {
                setRecoveryKey(key);
                setStep("recovery");
              }}
              onBack={() => setStep("welcome")}
            />
          </StepShell>
        ) : null}

        {step === "recovery" && recoveryKey ? (
          <StepShell key="recovery">
            <RecoveryStep recoveryKey={recoveryKey} onFinished={onFinished} />
          </StepShell>
        ) : null}

        {step === "restore" ? (
          <StepShell key="restore">
            <RestoreStep onBack={() => setStep("welcome")} onFinished={onFinished} />
          </StepShell>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function Welcome({ onStart, onRestore }: { onStart: () => void; onRestore: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const [passkeyReady, setPasskeyReady] = React.useState(false);
  const [signingIn, setSigningIn] = React.useState(false);

  /*
   * The passkey button appears only once the device says it actually holds
   * one. Offering it unconditionally means most first-time visitors tap it and
   * get a system sheet saying "no passkeys found", which teaches them the
   * feature is broken before they have an account to use it with.
   */
  React.useEffect(() => {
    let live = true;
    void hasPlatformAuthenticator().then((ready) => {
      if (live) setPasskeyReady(ready);
    });
    return () => {
      live = false;
    };
  }, []);

  async function withPasskey() {
    setSigningIn(true);
    try {
      await signInWithPasskey();
      await client.invalidateQueries();
    } catch (error) {
      if (!(error instanceof PasskeyCancelled)) {
        toast({
          tone: "error",
          title: "Could not sign in with a passkey",
          description:
            error instanceof ApiError
              ? error.message
              : "Use your recovery key instead, then add a passkey from Account.",
        });
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center py-10">
        <Wordmark className="mb-9" />

        <h1 className="text-display font-black leading-[1.08] tracking-[-0.035em] text-text">
          Split anything.
          <br />
          <span className="text-brand">Settle everything.</span>
        </h1>

        <p className="mt-4 text-input leading-relaxed text-muted">
          Track shared expenses with friends, housemates and travel companions.
          Every feature is free — receipts, itemised bills, multiple currencies,
          charts, exports, the lot.
        </p>

        <ul className="mt-8 space-y-3.5">
          <Feature icon={<Sparkles className="size-[18px]" />} title="No accounts">
            Share an invite code. That is the whole sign-up.
          </Feature>
          <Feature icon={<ShieldCheck className="size-[18px]" />} title="No paywall">
            Nothing is held back for a subscription.
          </Feature>
          <Feature icon={<KeyRound className="size-[18px]" />} title="Yours to keep">
            Self-hosted, exportable, no ads, no tracking.
          </Feature>
        </ul>
      </div>

      <div className="space-y-3">
        <Button variant="primary" size="lg" fullWidth onClick={onStart}>
          Get started
          <ArrowRight className="size-[18px]" />
        </Button>
        {passkeyReady ? (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={signingIn}
            onClick={() => void withPasskey()}
          >
            Sign in with a passkey
          </Button>
        ) : null}
        <Button variant="ghost" size="md" fullWidth onClick={onRestore}>
          I already have a recovery key
        </Button>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand-soft text-brand-soft-text">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-subhead font-semibold text-text">{title}</span>
        <span className="block text-body-lg leading-snug text-muted">{children}</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------

function ProfileStep({
  onDone,
  onBack,
}: {
  onDone: (recoveryKey: string) => void;
  onBack: () => void;
}) {
  const toast = useToast();

  const [name, setName] = React.useState("");
  const [emoji, setEmoji] = React.useState<string | null>(null);
  const [currency, setCurrency] = React.useState(guessCurrency());
  const [saving, setSaving] = React.useState(false);

  const color = colorForName(name || "divvy");
  const canSubmit = name.trim().length > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await api.post<{ me: MeDto; recoveryKey: string }>("/api/identity", {
        displayName: name.trim(),
        avatarColor: color,
        avatarEmoji: emoji,
        defaultCurrency: currency,
      });
      // The account exists from here on, and its key has been shown to nobody.
      // Recorded rather than assumed, because the user can still close the tab
      // on the next screen: while this flag is set the account screen says the
      // key was never saved and offers to issue a new one.
      markRecoveryPending();
      haptic([10, 40, 10]);
      onDone(result.recoveryKey);
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not set that up",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <button
        onClick={onBack}
        className="-ml-1 mb-8 self-start py-2 text-body-lg font-semibold text-muted"
      >
        Back
      </button>

      <h1 className="text-display-sm font-black tracking-[-0.03em] text-text">
        What should we call you?
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        This is the name your friends will see next to every expense.
      </p>

      <div className="mt-8 flex flex-col items-center">
        <span
          className="flex size-20 items-center justify-center rounded-full text-display-sm font-bold text-white transition-colors duration-300"
          style={{ background: `var(--avatar-${color})` }}
        >
          {emoji ?? (name.trim() ? initials(name) : "?")}
        </span>

        <div className="no-scrollbar mt-5 flex w-full gap-2 overflow-x-auto pb-1">
          <EmojiChip active={emoji === null} onClick={() => setEmoji(null)}>
            {name.trim() ? initials(name) : "Aa"}
          </EmojiChip>
          {EMOJI_CHOICES.map((choice) => (
            <EmojiChip key={choice} active={emoji === choice} onClick={() => setEmoji(choice)}>
              {choice}
            </EmojiChip>
          ))}
        </div>
      </div>

      <label className="mt-7 block">
        <span className="mb-1.5 block text-body font-semibold text-muted">Your name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 60))}
          onKeyDown={(event) => void (event.key === "Enter" && submit())}
          placeholder="Priya"
          autoFocus
          autoComplete="given-name"
          enterKeyHint="done"
          className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-4 text-input font-medium text-text outline-none transition placeholder:text-subtle/60 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-body font-semibold text-muted">
          Default currency
        </span>
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-4 text-input font-medium text-text outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
        >
          {CURRENCIES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.flag} {entry.code} — {entry.name}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-caption text-subtle">
          You can use any currency on any expense; this is just the default.
        </span>
      </label>

      <div className="mt-auto pt-8">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

function EmojiChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-title-lg transition",
        "active:scale-90",
        active
          ? "bg-brand-soft ring-2 ring-brand"
          : "bg-surface-2 hover:bg-surface-3",
      )}
    >
      <span className={active ? "" : "opacity-80"}>{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function RecoveryStep({
  recoveryKey,
  onFinished,
}: {
  recoveryKey: string;
  onFinished: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Recovery key copied" });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard is blocked in some in-app browsers; the key is on screen and
      // selectable, so this is a degraded path rather than a failure.
      toast({
        tone: "info",
        title: "Copy it by hand",
        description: "Your browser blocked clipboard access.",
      });
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-6 mt-4 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-warning-soft">
        <KeyRound className="size-6 text-text" />
      </div>

      <h1 className="text-display-sm font-black tracking-[-0.03em] text-text">
        Save your recovery key
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        There is no password to reset and no email to send. This key is the only
        way back into your account on another device.
      </p>

      <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-4">
        <p
          className="select-all break-all font-mono text-body leading-relaxed text-text"
          // Selectable on purpose: this is the one string in the app a user
          // genuinely needs to copy by hand if the clipboard is unavailable.
          style={{ userSelect: "all", WebkitUserSelect: "all" }}
        >
          {recoveryKey}
        </p>
      </div>

      <Button
        variant={copied ? "positive" : "secondary"}
        size="md"
        fullWidth
        className="mt-3"
        onClick={() => void copy()}
        icon={copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
      >
        {copied ? "Copied" : "Copy key"}
      </Button>

      <div className="mt-6 flex gap-3 rounded-[var(--radius-md)] bg-negative-soft p-3.5">
        <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-negative-text" />
        <p className="text-body leading-relaxed text-negative-text">
          Anyone with this key can open your account. Keep it in a password
          manager or notes app — not in the group chat.
        </p>
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
        />
        <span className="text-body-lg leading-snug text-text">
          I have saved my recovery key somewhere safe.
        </span>
      </label>

      <div className="mt-auto pt-8">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!acknowledged}
          onClick={() => {
            haptic(10);
            clearRecoveryPending();
            // Releasing the gate is what shows the app. The dashboard has very
            // likely loaded already - the cookie was set back at the profile
            // step - so this is usually just a refresh, but asking for it keeps
            // the first painted screen current rather than however stale.
            void client.invalidateQueries({ queryKey: keys.dashboard });
            onFinished();
          }}
        >
          Start using Divvy
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RestoreStep({ onBack, onFinished }: { onBack: () => void; onFinished: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/api/identity/restore", { recoveryKey: key.trim() });
      await client.invalidateQueries();
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "Welcome back" });
      router.refresh();
      onFinished();
    } catch (error) {
      toast({
        tone: "error",
        title: "That key did not work",
        description:
          error instanceof ApiError ? error.message : "Check it and try again.",
      });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <button
        onClick={onBack}
        className="-ml-1 mb-8 self-start py-2 text-body-lg font-semibold text-muted"
      >
        Back
      </button>

      <h1 className="text-display-sm font-black tracking-[-0.03em] text-text">
        Enter your recovery key
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Paste the key you saved when you first set up Divvy. Everything comes
        back exactly as you left it.
      </p>

      <textarea
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder="dvy_…"
        rows={3}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="mt-7 w-full resize-none rounded-[var(--radius-md)] border border-line bg-surface p-4 font-mono text-body-lg text-text outline-none transition placeholder:text-subtle/60 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
      />

      <div className="mt-auto pt-8">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!key.trim()}
          onClick={() => void submit()}
        >
          Restore my account
        </Button>
      </div>
    </div>
  );
}

/**
 * A sensible currency default from the browser's locale.
 *
 * Only a guess, and always changeable - but "INR" preselected for someone in
 * Mumbai is a better first impression than "USD" for everyone.
 */
function guessCurrency(): string {
  if (typeof navigator === "undefined") return "USD";

  /*
   * Both halves of this line throw on inputs that exist in the wild.
   * `new Intl.Locale("")` is a RangeError, and `navigator.language` is empty
   * or non-standard in more embedded webviews than one would like; `maximize`
   * is absent in browsers older than the app otherwise supports, which makes
   * it a TypeError rather than an undefined. This runs on the very first
   * screen anybody sees, so an exception here is a blank page on first run —
   * the guess is not worth a single one of those.
   */
  let region: string | undefined;
  try {
    region = new Intl.Locale(navigator.language).maximize().region;
  } catch {
    return "USD";
  }

  const byRegion: Record<string, string> = {
    US: "USD", GB: "GBP", IN: "INR", JP: "JPY", AU: "AUD", CA: "CAD",
    CH: "CHF", CN: "CNY", SG: "SGD", HK: "HKD", NZ: "NZD", SE: "SEK",
    NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON",
    TR: "TRY", AE: "AED", SA: "SAR", IL: "ILS", ZA: "ZAR", NG: "NGN",
    KE: "KES", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP",
    KR: "KRW", TW: "TWD", TH: "THB", VN: "VND", ID: "IDR", MY: "MYR",
    PH: "PHP", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", EG: "EGP",
    DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR",
    IE: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR",
  };

  return (region && byRegion[region]) || "USD";
}
