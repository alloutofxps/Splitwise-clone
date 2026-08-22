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

  const message = `Join "${group.name}" on Divvy to split expenses with me.\n\nCode: ${code}\n${url}`;

  const share = async () => {
    haptic();
    // navigator.share needs a user gesture and only exists on mobile and Safari;
    // the clipboard path is the fallback rather than an error case.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `Join ${group.name}`, text: message });
        return;
      } catch {
        // The user dismissed the share sheet - not a failure worth reporting.
        return;
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
        title: "New code generated",
        description: "The old link no longer works.",
      });
    } catch {
      toast({ tone: "error", title: "Could not change the code" });
    } finally {
      setRotating(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Invite to ${group.name}`}>
      <div className="px-5 pb-6">
        <div className="rounded-[--radius-lg] border border-line bg-surface-2 px-4 py-6 text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.07em] text-subtle">
            Invite code
          </p>
          <p className="mt-2 select-all break-words text-[26px] font-black tracking-[-0.01em] text-text">
            {code}
          </p>
          <p className="mt-2 text-[12px] text-muted">
            They enter this in Divvy, or open the link below.
          </p>
        </div>

        <div className="mt-4 space-y-2.5">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={share}
            icon={<Share2 className="size-[18px]" />}
          >
            Share invite
          </Button>

          <div className="flex gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => copy(code)}
              icon={
                copied ? <Check className="size-[17px]" /> : <Copy className="size-[17px]" />
              }
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => copy(url)}>
              Copy link
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-[--radius-md] bg-surface-2 p-3.5">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <MessageCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Anyone with this code can join the group and see its expenses. If
              it ends up somewhere it should not, generate a new one — everyone
              already in the group stays in.
            </span>
          </p>
          <button
            onClick={rotate}
            disabled={rotating}
            className="mt-2.5 flex items-center gap-1.5 text-[12px] font-bold text-brand transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={rotating ? "size-3.5 animate-spin" : "size-3.5"} />
            Generate a new code
          </button>
        </div>
      </div>
    </Sheet>
  );
}
