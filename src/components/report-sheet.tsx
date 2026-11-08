"use client";

import * as React from "react";
import { Sheet } from "./ui/sheet";
import { Button, haptic } from "./ui/primitives";
import { useToast } from "./ui/toast";
import { useResetOnOpen } from "./ui/use-reset-on-open";
import { api, ApiError } from "@/lib/client/api";

/**
 * "Something wrong?": a few words to whoever runs Divvy, without having to know
 * how to reach them. Works signed out, because not getting in is often the
 * problem.
 */
export function ReportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);

  useResetOnOpen(open, () => {
    setText("");
    setSending(false);
  });

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post("/api/reports", {
        text,
        path: window.location.pathname.slice(0, 200),
        build: process.env.NEXT_PUBLIC_BUILD_ID,
      });
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Sent. Thank you." });
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't send it",
        description: error instanceof ApiError ? error.message : "Please try again in a moment.",
      });
      setSending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Something wrong?"
      footer={
        <Button variant="primary" size="lg" fullWidth loading={sending} disabled={!text.trim()} onClick={() => void send()}>
          Send
        </Button>
      }
    >
      <div className="px-5 pb-6">
        <label className="block">
          <span className="mb-1.5 block text-body font-semibold text-muted">What happened?</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 2000))}
            rows={5}
            autoFocus
            placeholder="I tapped the invite link and…"
            className="w-full resize-none rounded-[var(--radius-md)] border border-field-edge bg-surface-2 p-4 text-input text-text outline-none transition placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
          />
        </label>
        <p className="mt-2 text-caption leading-relaxed text-subtle">
          It goes to the people who run Divvy, with the screen you&rsquo;re on, the version of Divvy and your type
          of phone, and your name if you&rsquo;re signed in. Don&rsquo;t include your recovery key.
        </p>
      </div>
    </Sheet>
  );
}
