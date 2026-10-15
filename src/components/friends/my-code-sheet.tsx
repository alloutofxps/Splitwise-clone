"use client";

import * as React from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import type { MeDto } from "@/lib/types";
import { QrCode } from "../ui/qr-code";

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
      } catch (error) {
        // Cancelling the share sheet is a choice, not a failure. Anything else -
        // no share targets, a browser that refuses - falls back to copying,
        // instead of the button silently doing nothing.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy(message);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your code">
      <div className="px-5 pb-6">
        <div className="flex flex-col items-center">
          <QrCode value={url} label="Your friend code" />
          <p className="mt-4 select-all break-all text-center font-mono text-title font-medium text-text">
            {me.inviteCode}
          </p>
          <p className="mt-1 text-center text-caption text-muted">Scan it, open the link, or type the code in Divvy.</p>
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
          Anyone with this code can add you as a friend. They can&rsquo;t see your
          groups or anything you&rsquo;ve added.
        </p>
      </div>
    </Sheet>
  );
}
