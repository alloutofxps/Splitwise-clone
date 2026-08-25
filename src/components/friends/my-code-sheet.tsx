"use client";

import * as React from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import type { MeDto } from "@/lib/types";

/**
 * Your personal code.
 *
 * The counterpart to a group invite: hand this to someone and they can split
 * with you directly, without either of you creating a group first. It is not a
 * secret - having it only lets somebody add you, which enables splitting and
 * reveals no history in either direction.
 */
export function MyCodeSheet({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: MeDto;
}) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/join/${me.inviteCode}` : "";
  const message = `Add me on Divvy to split expenses.\n\nCode: ${me.inviteCode}\n${url}`;

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

  const share = async () => {
    haptic();
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Add me on Divvy", text: message });
        return;
      } catch {
        return; // Dismissed the share sheet.
      }
    }
    await copy(message);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your code">
      <div className="px-5 pb-6">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-6 text-center">
          <p className="text-caption font-bold uppercase tracking-[0.07em] text-subtle">
            Personal code
          </p>
          <p className="mt-2 select-all break-words text-heading font-black tracking-[-0.01em] text-text">
            {me.inviteCode}
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
            Share my code
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => void copy(me.inviteCode)}
            icon={copied ? <Check className="size-[17px]" /> : <Copy className="size-[17px]" />}
          >
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>

        <p className="mt-5 text-center text-caption leading-relaxed text-muted">
          Anyone with this can add you as a friend. It does not give them access
          to your groups or any of your history.
        </p>
      </div>
    </Sheet>
  );
}
