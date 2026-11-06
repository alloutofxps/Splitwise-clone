"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, haptic } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { KeyboardPageFooter } from "@/components/ui/keyboard-page";
import { api, ApiError } from "@/lib/client/api";
import { openedFromHomeScreen } from "@/lib/client/home-screen";
import { SIGN_IN_CODE_HELP, claimSignInCode } from "@/lib/client/sign-in-code";
import { clearRecoveryPending } from "@/lib/client/recovery";
import type { MeDto } from "@/lib/types";

/**
 * The invite page, for someone who already has Divvy.
 *
 * An invite link opens in the browser even on a phone with Divvy on its home
 * screen, and the two don't share a sign-in on an iPhone. So this person isn't
 * signed in here, and asking their name made them a second account (findings
 * item 60). They get two ways to their own account: take the code to the app,
 * or sign in on this page and join from it.
 *
 * `children` is what they're joining, which stays at the top of the page.
 */
export function AlreadyHaveDivvy({
  code,
  onSignedIn,
  onNew,
  children,
}: {
  code: string;
  onSignedIn: (me: MeDto) => void;
  onNew: () => void;
  children: React.ReactNode;
}) {
  const toast = useToast();
  // This only ever draws in the browser, after a tap.
  const [fromHomeScreen] = React.useState(openedFromHomeScreen);
  const [passkeyReady, setPasskeyReady] = React.useState(false);
  const [signingIn, setSigningIn] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [typing, setTyping] = React.useState<"key" | "code" | null>(null);
  const [key, setKey] = React.useState("");
  const [signInCode, setSignInCode] = React.useState("");
  const title = React.useRef<HTMLParagraphElement>(null);

  // The button that was tapped has gone, so keyboard and screen reader users
  // carry on from here.
  React.useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  // The passkey code is fetched only here: most people opening an invite are
  // new, and never come this way.
  React.useEffect(() => {
    let live = true;
    void import("./passkey")
      .then((passkey) => passkey.hasPlatformAuthenticator())
      .catch(() => false)
      .then((ready) => {
        if (live) setPasskeyReady(ready);
      });
    return () => {
      live = false;
    };
  }, []);

  const signedIn = (me: MeDto, hasWayBack: boolean) => {
    // Anything this device remembers about a key not being saved is out of date.
    // Not after a sign-in code, which says nothing about having a way back.
    if (hasWayBack) clearRecoveryPending();
    haptic([10, 40, 10]);
    toast({ tone: "success", title: "Welcome back" });
    onSignedIn(me);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Copied" });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Some in-app browsers block the clipboard. The code is on screen.
      toast({ tone: "info", title: "Couldn't copy", description: "Please copy the code by hand." });
    }
  };

  const withPasskey = async () => {
    setSigningIn(true);
    try {
      const { signInWithPasskey } = await import("./passkey");
      signedIn(await signInWithPasskey(), true);
    } catch (caught) {
      if ((caught as Error).name !== "PasskeyCancelled") {
        toast({
          tone: "error",
          title: "Couldn't sign you in",
          description: caught instanceof ApiError ? caught.message : "Try your recovery key instead.",
        });
      }
      setSigningIn(false);
    }
  };

  const withKey = async () => {
    if (!key.trim() || signingIn) return;
    setSigningIn(true);
    try {
      const { me } = await api.post<{ me: MeDto }>("/api/identity/restore", { recoveryKey: key.trim() });
      signedIn(me, true);
    } catch (caught) {
      toast({
        tone: "error",
        title: "That key didn't work",
        description: caught instanceof ApiError ? caught.message : "Check it and try again.",
      });
      setSigningIn(false);
    }
  };

  const withCode = async () => {
    if (!signInCode.trim() || signingIn) return;
    setSigningIn(true);
    try {
      signedIn(await claimSignInCode(signInCode), false);
    } catch (caught) {
      toast({
        tone: "error",
        title: "That code didn't work",
        description: caught instanceof ApiError ? caught.message : "Check it and try again.",
      });
      setSigningIn(false);
    }
  };

  if (typing === "code") {
    return (
      <>
        <div className="flex flex-1 flex-col">
          {children}
          <label className="mt-7 block">
            <span className="mb-1.5 block text-body font-semibold text-muted">Your sign-in code</span>
            <input
              value={signInCode}
              onChange={(event) => setSignInCode(event.target.value)}
              onKeyDown={(event) => void (event.key === "Enter" && withCode())}
              placeholder="k7fq-m2xp"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-14 w-full rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-4 text-center font-mono text-title-lg font-medium text-text outline-none transition placeholder:font-medium placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
            />
          </label>
          <p className="mt-2 text-caption leading-relaxed text-subtle">{SIGN_IN_CODE_HELP}</p>
        </div>
        <KeyboardPageFooter className="pt-5" pinned>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={signingIn}
            disabled={!signInCode.trim()}
            onClick={() => void withCode()}
          >
            Sign in
          </Button>
          <Button variant="ghost" size="md" fullWidth className="mt-2" onClick={() => setTyping(null)}>
            Back
          </Button>
        </KeyboardPageFooter>
      </>
    );
  }

  if (typing === "key") {
    return (
      <>
        <div className="flex flex-1 flex-col">
          {children}
          <label className="mt-7 block">
            <span className="mb-1.5 block text-body font-semibold text-muted">Your recovery key</span>
            <textarea
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="dvy_…"
              rows={3}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full resize-none rounded-[var(--radius-md)] border border-field-edge bg-surface-2 p-4 font-mono text-input text-text outline-none transition placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
            />
          </label>
        </div>
        <KeyboardPageFooter className="pt-5" pinned>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={signingIn}
            disabled={!key.trim()}
            onClick={() => void withKey()}
          >
            Sign in
          </Button>
          <Button variant="ghost" size="md" fullWidth className="mt-2" onClick={() => setTyping(null)}>
            Back
          </Button>
        </KeyboardPageFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col">
        {children}

        <p ref={title} tabIndex={-1} className="mt-7 text-body-lg font-semibold text-text outline-none">
          {fromHomeScreen ? "Sign in to join" : "Use your Divvy app"}
        </p>

        {fromHomeScreen ? null : (
          <>
            <p className="mt-1 text-body leading-relaxed text-muted">
              Links open in your browser, not the app. Copy this code, open Divvy from your home
              screen, tap Join and paste it.
            </p>
            <p
              className="mt-3 select-all rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-center font-mono text-title font-medium text-text"
              style={{ userSelect: "all", WebkitUserSelect: "all" }}
            >
              {code}
            </p>
            <Button
              variant={copied ? "positive" : "primary"}
              size="lg"
              fullWidth
              className="mt-2"
              onClick={() => void copy()}
              icon={copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
            >
              {copied ? "Copied" : "Copy code"}
            </Button>

            <p className="mt-7 text-body-lg font-semibold text-text">Or sign in and join from here</p>
          </>
        )}

        <div className="mt-3 space-y-2">
          {passkeyReady ? (
            <Button variant="secondary" size="lg" fullWidth loading={signingIn} onClick={() => void withPasskey()}>
              Sign in with fingerprint or face
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" fullWidth onClick={() => setTyping("key")}>
            Sign in with a recovery key
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={() => setTyping("code")}>
            Sign in with a code
          </Button>
        </div>
      </div>

      <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <Button variant="ghost" size="md" fullWidth onClick={onNew}>
          I&rsquo;m new to Divvy
        </Button>
      </div>
    </>
  );
}
