"use client";

import * as React from "react";
import { Check, Copy, MessageCircle, RefreshCw, Share2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { useMirror } from "../ui/state-hooks";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { api } from "@/lib/client/api";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/lib/client/queries";
import type { GroupDetailDto } from "@/lib/types";
import { QrCode } from "../ui/qr-code";

/**
 * Sharing a group.
 *
 * The invite code is the entire authentication story, so it is presented the
 * way a code meant to be *read out loud* should be: large, spaced, and made of
 * words rather than characters. "mango-tiger-42" survives being shouted across
 * a dinner table; a random string does not.
 *
 * Web Share where available, clipboard everywhere else.
 */
export function InviteSheet({
  open,
  onClose,
  group,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetailDto;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const [copied, setCopied] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [code, setCode] = useMirror(group.inviteCode);
  const [more, setMore] = React.useState(false);

  const url =
    typeof window !== "undefined" ? `${window.location.origin}/join/${code}` : "";

  const message = `Join "${group.name}" on Divvy so we can split costs.\n\nCode: ${code}\n${url}`;

  const share = async () => {
    haptic();
    // navigator.share needs a user gesture and only exists on mobile and Safari;
    // the clipboard path is the fallback rather than an error case.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `Join ${group.name}`, text: message });
        return;
      } catch (error) {
        // Cancelling the share sheet is a choice, not a failure. Anything else -
        // no share targets, a browser that refuses - falls back to copying,
        // instead of the button silently doing nothing.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy(message);
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      haptic();
      setTimeout(() => setCopied(false), 2200);
      toast({ tone: "success", title: "Copied" });
    } catch {
      toast({ tone: "info", title: "Copy it by hand", description: value });
    }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const result = await api.post<{ inviteCode: string }>(
        `/api/groups/${group.id}/invite`,
        { action: "rotate" },
      );
      setCode(result.inviteCode);
      await client.invalidateQueries({ queryKey: keys.group(group.id) });
      toast({
        tone: "success",
        title: "New code made",
        description: "The old code and link don't work any more.",
      });
    } catch {
      toast({ tone: "error", title: "Couldn't change the code" });
    } finally {
      setRotating(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Invite to ${group.name}`}>
      <div className="px-5 pb-6">
        {/* For someone next to you: point their camera at it. */}
        <div className="flex flex-col items-center">
          <QrCode value={url} label={`Invite to ${group.name}`} />
          <p className="mt-4 select-all break-all text-center font-mono text-title font-medium text-text">{code}</p>
          <p className="mt-1 text-center text-caption text-muted">Scan it, open the link, or type the code in Divvy.</p>
        </div>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="mt-5"
          onClick={() => void share()}
          icon={<Share2 className="size-[18px]" />}
        >
          Share invite
        </Button>
        <div className="mt-2 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => void copy(code)}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-body font-medium text-text underline-offset-2 hover:underline"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" strokeWidth={1.75} />}
            {copied ? "Copied" : "Copy code"}
          </button>
          <button
            type="button"
            onClick={() => setMore(!more)}
            aria-expanded={more}
            className="rounded-[var(--radius-sm)] px-2 py-1.5 text-body text-muted underline-offset-2 hover:underline"
          >
            More…
          </button>
        </div>

        {more ? (
        <div className="mt-4 rounded-[var(--radius-md)] bg-surface-2 p-3.5">
          <p className="flex items-start gap-2 text-caption leading-relaxed text-muted">
            <MessageCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Anyone with this code can join and see the group&rsquo;s expenses. If
              it gets shared by mistake, make a new one. People already in the
              group stay in.
            </span>
          </p>
          <button
            onClick={() => void rotate()}
            disabled={rotating}
            className="mt-2.5 flex items-center gap-1.5 text-caption font-medium text-text transition-opacity disabled:opacity-50"
          >
            <RefreshCw className={rotating ? "size-3.5 animate-spin" : "size-3.5"} />
            Make a new code
          </button>
          <button
            type="button"
            onClick={() => void copy(url)}
            className="mt-2 block text-caption font-medium text-text"
          >
            Copy the link instead
          </button>
        </div>
        ) : null}
      </div>
    </Sheet>
  );
}
