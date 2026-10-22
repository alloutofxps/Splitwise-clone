"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DURATION, EASE_ENTER, EASE_EXIT } from "./ui/motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Download,
  Copy,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { Button, haptic } from "./ui/primitives";
import { useToast } from "./ui/toast";
import { Wordmark } from "./app-shell";
import { api, ApiError } from "@/lib/client/api";
import { keys } from "@/lib/client/queries";
import {
  clearRecoveryPending,
  clearStashedRecoveryKey,
  markRecoveryPending,
  saveRecoveryKeyFile,
  stashRecoveryKey,
  stashedRecoveryKey,
} from "@/lib/client/recovery";
import { EmojiPicker } from "./ui/emoji-picker";
import { colorForName, hueVar, initials } from "@/lib/avatar";
import {
  PasskeyCancelled,
  hasPlatformAuthenticator,
  registerPasskey,
  signInWithPasskey,
} from "./identity/passkey";
import { CurrencyPicker } from "./expense/currency-picker";
import { guessCurrency } from "@/lib/guess-currency";
import type { MeDto } from "@/lib/types";
import { FlowMap } from "./flow/flow-map";

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

type Step = "welcome" | "profile" | "protect" | "recovery" | "restore";


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
                setStep("protect");
              }}
              onBack={() => setStep("welcome")}
            />
          </StepShell>
        ) : null}

        {step === "protect" ? (
          <StepShell key="protect">
            <ProtectStep
              onRecoveryKey={() => setStep("recovery")}
              onFinished={onFinished}
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
      exit={{ opacity: 0, x: -24, pointerEvents: "none", transition: { duration: DURATION.quick, ease: EASE_EXIT } }}
      transition={{ duration: DURATION.arrive, ease: EASE_ENTER }}
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
  const [returning, setReturning] = React.useState(false);

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
      <div className="flex flex-1 flex-col justify-center py-4">
        <Wordmark className="mb-2" />

        {/* The product in three seconds: who owes whom, untangled. */}
        <WelcomeFlow />

        <h1 className="mt-2 text-display font-semibold leading-[1.1] tracking-[-0.03em] text-text">
          Split costs with friends.
        </h1>
        <p className="mt-3 text-body-lg leading-relaxed text-muted">
          Divvy keeps track of who owes who, and the easiest way to pay back.
        </p>

        <ul className="mt-5 flex flex-wrap gap-2">
          <Feature icon={<KeyRound className="size-3.5" />}>No email or password</Feature>
          <Feature icon={<ShieldCheck className="size-3.5" />}>Free, no ads</Feature>
          <Feature icon={<WifiOff className="size-3.5" />}>Works offline</Feature>
        </ul>
      </div>

      <div className="space-y-2">
        <Button variant="primary" size="lg" fullWidth onClick={onStart}>
          Get started
          <ArrowRight className="size-[18px]" />
        </Button>
        {returning ? (
          <>
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
            <Button variant="secondary" size="lg" fullWidth onClick={onRestore}>
              Sign in with a recovery key
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="md" fullWidth onClick={() => setReturning(true)}>
            I already use Divvy
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Four people and six tangled lines, which untangle into two: what Divvy
 * does, shown rather than described. Plays once. With Reduce Motion it simply
 * shows the two lines.
 */
const DEMO_PEOPLE = [
  { id: "demo-you", displayName: "You", avatarColor: "cobalt", avatarEmoji: null, isGhost: false },
  { id: "demo-ana", displayName: "Ana", avatarColor: "coral", avatarEmoji: null, isGhost: false },
  { id: "demo-sam", displayName: "Sam", avatarColor: "teal", avatarEmoji: null, isGhost: false },
  { id: "demo-leo", displayName: "Leo", avatarColor: "amber", avatarEmoji: null, isGhost: false },
] as const;
const TANGLE = [
  ["demo-ana", "demo-you", 30n],
  ["demo-sam", "demo-you", 20n],
  ["demo-leo", "demo-ana", 15n],
  ["demo-sam", "demo-leo", 10n],
  ["demo-you", "demo-leo", 5n],
  ["demo-ana", "demo-sam", 8n],
] as const;
const UNTANGLED = [
  ["demo-sam", "demo-you", 22n],
  ["demo-ana", "demo-you", 23n],
] as const;

function WelcomeFlow() {
  const reduce = useReducedMotion();
  const [stage, setStage] = React.useState<0 | 1 | 2>(reduce ? 2 : 0);

  React.useEffect(() => {
    if (reduce) return;
    const draw = window.setTimeout(() => setStage(1), 250);
    const untangle = window.setTimeout(() => setStage(2), 2100);
    return () => {
      window.clearTimeout(draw);
      window.clearTimeout(untangle);
    };
  }, [reduce]);

  const edges = (stage === 0 ? [] : stage === 1 ? TANGLE : UNTANGLED).map(([fromPersonId, toPersonId, amount]) => ({
    fromPersonId,
    toPersonId,
    amount,
  }));

  return (
    <FlowMap
      people={DEMO_PEOPLE.map((person) => ({ ...person }))}
      edges={edges}
      currency="EUR"
      meId="demo-you"
      labels={false}
      size={260}
      className="pointer-events-none -my-2"
    />
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-caption font-medium text-text">
      <span className="text-muted">{icon}</span>
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
  const [currencyOpen, setCurrencyOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // A colour is picked for you from your name until you choose one yourself.
  const [chosenColor, setChosenColor] = React.useState<string | null>(null);

  const color = chosenColor ?? colorForName(name || "divvy");
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
        className="-ml-1 mb-8 flex items-center gap-1 self-start py-2 text-body-lg font-medium text-text"
      >
        <ChevronLeft className="size-5" strokeWidth={1.75} />
        Back
      </button>

      <h1 className="text-heading font-semibold tracking-[-0.02em] text-text">
        What&rsquo;s your name?
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Your friends will see this next to your expenses.
      </p>

      {/* One field, with you beside it in your colour, updating as you type. */}
      <div className="mt-8 flex items-center gap-3">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-title-lg font-semibold text-[var(--on-person)] transition-colors duration-300"
          style={{ background: hueVar(color) }}
          aria-hidden
        >
          {emoji ?? (name.trim() ? initials(name) : "?")}
        </span>
        <input
          dir="auto"
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 60))}
          onKeyDown={(event) => void (event.key === "Enter" && submit())}
          placeholder="Priya"
          aria-label="Your name"
          autoFocus
          autoComplete="given-name"
          enterKeyHint="done"
          className="h-12 min-w-0 flex-1 rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-4 text-input font-medium text-text outline-none transition placeholder:text-subtle/60 focus:ring-[1.5px] focus:ring-text"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          haptic();
          setPickerOpen(true);
        }}
        className="mt-2 self-start rounded-[var(--radius-sm)] px-1 py-1 text-body text-muted underline-offset-2 hover:text-text hover:underline"
      >
        Change colour or emoji
      </button>

      <EmojiPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={emoji}
        onSelect={setEmoji}
        initials={name.trim() ? initials(name) : "Aa"}
        color={color}
        onColor={setChosenColor}
      />

      {/* Worked out from where the phone is; one tap to change. */}
      <p className="mt-6 text-body text-muted">
        Your currency: <span className="font-medium text-text">{currency}</span>
        {" · "}
        <button
          type="button"
          onClick={() => {
            haptic();
            setCurrencyOpen(true);
          }}
          className="text-text underline underline-offset-2"
        >
          Change
        </button>
      </p>
      <CurrencyPicker
        open={currencyOpen}
        onClose={() => setCurrencyOpen(false)}
        value={currency}
        onChange={(code) => {
          setCurrency(code);
          setCurrencyOpen(false);
        }}
      />

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


// ---------------------------------------------------------------------------

/**
 * Protect your account (DESIGN-PLAN 3.1), instead of a wall of recovery key.
 *
 * The easy way first: a passkey, so Face ID or a fingerprint gets you back in
 * on a new phone. The recovery key is the alternative, and "Not now" is
 * allowed: Home then shows a quiet "Back up your account" until one of them
 * is done, and You → Recovery key makes a key at any time.
 */
function ProtectStep({
  onRecoveryKey,
  onFinished,
}: {
  onRecoveryKey: () => void;
  onFinished: () => void;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const [canPasskey, setCanPasskey] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void hasPlatformAuthenticator()
      .catch(() => false)
      .then((available) => alive && setCanPasskey(available));
    return () => {
      alive = false;
    };
  }, []);

  const finish = (protectedNow: boolean) => {
    // The key made at sign-up is not kept: it was never shown, and storing a
    // live credential for no reason is how it leaks. A new one can be made
    // from You whenever it's wanted.
    clearStashedRecoveryKey();
    if (protectedNow) clearRecoveryPending();
    void client.invalidateQueries({ queryKey: keys.dashboard });
    onFinished();
  };

  const withPasskey = async () => {
    setBusy(true);
    try {
      await registerPasskey("This phone");
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "You can get back in with your face or fingerprint" });
      finish(true);
    } catch (error) {
      if (!(error instanceof PasskeyCancelled)) {
        toast({
          tone: "error",
          title: "That didn\u2019t work",
          description: "Try again, or save a recovery key instead.",
        });
      }
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-text">
          <ShieldCheck className="size-6" strokeWidth={1.75} />
        </span>
        <h1 className="mt-5 text-heading font-semibold tracking-[-0.02em] text-text">Protect your account</h1>
        <p className="mt-2 text-body-lg leading-relaxed text-muted">
          Divvy has no email or password. To get back in on a new phone, use your face or
          fingerprint, or save a recovery key.
        </p>
      </div>

      <div className="space-y-2 pt-8">
        {canPasskey ? (
          <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void withPasskey()}>
            Use Face ID or fingerprint
          </Button>
        ) : null}
        <Button
          variant={canPasskey ? "secondary" : "primary"}
          size="lg"
          fullWidth
          onClick={onRecoveryKey}
        >
          Save a recovery key instead
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={() => finish(false)}>
          Not now
        </Button>
      </div>
    </div>
  );
}

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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant={copied ? "positive" : "secondary"}
          size="md"
          fullWidth
          onClick={() => void copy()}
          icon={copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
        >
          {copied ? "Copied" : "Copy key"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          fullWidth
          onClick={() => saveRecoveryKeyFile(recoveryKey)}
          icon={<Download className="size-[18px]" strokeWidth={1.75} />}
        >
          Save as file
        </Button>
      </div>

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

