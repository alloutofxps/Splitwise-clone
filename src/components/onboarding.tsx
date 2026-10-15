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
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { Button, cn, haptic } from "./ui/primitives";
import { useToast } from "./ui/toast";
import { Wordmark } from "./app-shell";
import { api, ApiError } from "@/lib/client/api";
import { keys } from "@/lib/client/queries";
import {
  clearRecoveryPending,
  clearStashedRecoveryKey,
  markRecoveryPending,
  stashRecoveryKey,
  stashedRecoveryKey,
} from "@/lib/client/recovery";
import { EMOJI_QUICK_PICKS } from "@/lib/emoji";
import { EmojiPicker } from "./ui/emoji-picker";
import { colorForName, hueVar, initials } from "@/lib/avatar";
import {
  PasskeyCancelled,
  hasPlatformAuthenticator,
  signInWithPasskey,
} from "./identity/passkey";
import { CURRENCIES } from "@/lib/money";
import { guessCurrency } from "@/lib/guess-currency";
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


export function Onboarding({ onFinished }: { onFinished: () => void }) {
  /*
   * Setup resumes where it was interrupted.
   *
   * Saving the key means leaving for a password manager, and a phone will
   * happily discard a backgrounded tab while that happens. Reading the stash
   * during the initial state means the reloaded page comes back to the
   * recovery screen rather than to the welcome screen — which was the worse
   * outcome twice over: the key was unrecoverable, and the obvious next move
   * was to sign up again and end up with a second, empty account.
   */
  const resumed = typeof window === "undefined" ? null : stashedRecoveryKey();
  const [step, setStep] = React.useState<Step>(resumed ? "recovery" : "welcome");
  const [recoveryKey, setRecoveryKey] = React.useState<string | null>(resumed);

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
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
                stashRecoveryKey(key);
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
      exit={{ opacity: 0, x: -24, pointerEvents: "none" }}
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
          title: "Couldn't sign you in",
          description:
            error instanceof ApiError
              ? error.message
              : "Try your recovery key instead.",
        });
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center py-6">
        <Wordmark className="mb-6" />

        <h1 className="mt-4 font-display text-display-lg font-semibold leading-[1.02] tracking-[-0.045em] text-text">
          Split bills with friends.
          <br />
          <span className="text-muted">See who owes what.</span>
        </h1>

        <p className="mt-4 text-input leading-relaxed text-muted">
          Add what you spent on a trip, at home or on a night out. Divvy works
          out who owes who, and the easiest way to pay each other back.
        </p>

        <ul className="mt-6 flex flex-wrap gap-2">
          <Feature icon={<KeyRound className="size-3.5" />}>No email or password</Feature>
          <Feature icon={<ShieldCheck className="size-3.5" />}>Free, no ads</Feature>
          <Feature icon={<WifiOff className="size-3.5" />}>Works offline</Feature>
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
            Sign in with fingerprint or face
          </Button>
        ) : null}
        <Button variant="ghost" size="md" fullWidth onClick={onRestore}>
          Sign in with a recovery key
        </Button>
      </div>
    </div>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-body font-semibold text-text">
      <span className="text-brand">{icon}</span>
      {children}
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
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [currency, setCurrency] = React.useState(() => guessCurrency());
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
        title: "Something went wrong",
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

      <h1 className="text-display-sm font-semibold tracking-[-0.03em] text-text">
        What&rsquo;s your name?
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Your friends will see this next to your expenses.
      </p>

      <div className="mt-8 flex flex-col items-center">
        <span
          className="flex size-20 items-center justify-center rounded-full text-display-sm font-semibold text-[var(--on-person)] transition-colors duration-300"
          style={{ background: hueVar(color) }}
        >
          {emoji ?? (name.trim() ? initials(name) : "?")}
        </span>

        {/*
          `overflow-x-auto` clips the *other* axis too — the CSS spec computes
          `overflow-y` to `auto` as soon as one axis is not `visible` — so the
          selected chip's ring was being sliced off top and bottom. The padding
          gives the ring somewhere to live and the negative margin takes the
          space back, keeping the strip's spacing as designed.
        */}
        <div className="no-scrollbar -my-1.5 mt-4 flex w-full gap-2 overflow-x-auto px-0.5 py-1.5">
          <EmojiChip active={emoji === null} onClick={() => setEmoji(null)}>
            {name.trim() ? initials(name) : "Aa"}
          </EmojiChip>
          {EMOJI_QUICK_PICKS.map((choice) => (
            <EmojiChip key={choice} active={emoji === choice} onClick={() => setEmoji(choice)}>
              {choice}
            </EmojiChip>
          ))}
          {/* A strip of twelve is a shortlist, not the choice. */}
          <EmojiChip
            active={emoji !== null && !EMOJI_QUICK_PICKS.includes(emoji)}
            onClick={() => setPickerOpen(true)}
            label="More emoji"
          >
            {emoji !== null && !EMOJI_QUICK_PICKS.includes(emoji) ? emoji : "···"}
          </EmojiChip>
        </div>

        <EmojiPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          value={emoji}
          onSelect={setEmoji}
          initials={name.trim() ? initials(name) : "Aa"}
        />
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
          className="h-12 w-full rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-4 text-input font-medium text-text outline-none transition placeholder:text-subtle/60 focus:ring-[1.5px] focus:ring-text"
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-body font-semibold text-muted">
          Default currency
        </span>
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="h-12 w-full rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-4 text-input font-medium text-text outline-none transition focus:ring-[1.5px] focus:ring-text"
        >
          {CURRENCIES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.code} · {entry.name} ({entry.symbol})
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-caption text-subtle">
          We&rsquo;ll pick this one first. You can change it on any expense.
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
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** For the chips whose content is not readable aloud, like the "more" dots. */
  label?: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-title-lg transition",
        "active:opacity-70",
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
      toast({ tone: "success", title: "Copied" });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard is blocked in some in-app browsers; the key is on screen and
      // selectable, so this is a degraded path rather than a failure.
      toast({
        tone: "info",
        title: "Couldn't copy",
        description: "Please copy it by hand or write it down.",
      });
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-6 mt-4 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-warning-soft">
        <KeyRound className="size-6 text-text" />
      </div>

      <h1 className="text-display-sm font-semibold tracking-[-0.03em] text-text">
        Save your recovery key
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Divvy doesn&rsquo;t use passwords or email. If you lose this phone or get a
        new one, this key is the only way to get your account back.
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
          Anyone with this key can open your account. Keep it somewhere private,
          like a password manager, and don&rsquo;t share it.
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
          I&rsquo;ve saved my key somewhere safe.
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
            // The stash exists only to survive an interrupted setup. Once the
            // key is confirmed saved, keeping it would be storing a live
            // credential for no remaining reason.
            clearStashedRecoveryKey();
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
        title: "That key didn't work",
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

      <h1 className="text-display-sm font-semibold tracking-[-0.03em] text-text">
        Enter your recovery key
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Paste the key you saved when you first used Divvy. All your groups and
        expenses will come back.
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
        className="mt-7 w-full resize-none rounded-[var(--radius-md)] border border-transparent bg-surface-2 p-4 font-mono text-input text-text outline-none transition placeholder:text-subtle/60 focus:ring-[1.5px] focus:ring-text"
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
          Get my account back
        </Button>
      </div>
    </div>
  );
}

