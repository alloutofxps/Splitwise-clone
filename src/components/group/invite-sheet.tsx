"use client";

import * as React from "react";
import { Check, Copy, MessageCircle, RefreshCw, Share2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { api } from "@/lib/client/api";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/lib/client/queries";
import type { GroupDetailDto } from "@/lib/types";

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
  const [code, setCode] = React.useState(group.inviteCode);

  React.useEffect(() => setCode(group.inviteCode), [group.inviteCode]);

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
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-6 text-center">
          <p className="text-caption font-bold uppercase tracking-[0.07em] text-subtle">
            Invite code
          </p>
          <p className="mt-2 select-all break-words text-display-sm font-black tracking-[-0.01em] text-text">
            {code}
          </p>
          <p className="mt-2 text-caption text-muted">
            They can type this in Divvy, or just open the link.
          </p>
        </div>

        <div className="mt-4 space-y-2.5">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void share()}
            icon={<Share2 className="size-[18px]" />}
          >
            Share invite
          </Button>

          <div className="flex gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void copy(code)}
              icon={
                copied ? <Check className="size-[17px]" /> : <Copy className="size-[17px]" />
              }
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => void copy(url)}>
              Copy link
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-[var(--radius-md)] bg-surface-2 p-3.5">
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
            className="mt-2.5 flex items-center gap-1.5 text-caption font-bold text-brand transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={rotating ? "size-3.5 animate-spin" : "size-3.5"} />
            Make a new code
          </button>
        </div>
      </div>
    </Sheet>
  );
}
