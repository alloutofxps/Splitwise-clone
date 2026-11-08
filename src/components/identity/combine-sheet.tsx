"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { api, ApiError } from "@/lib/client/api";
import type { MeDto, PersonDto } from "@/lib/types";

interface Preview {
  other: PersonDto;
  groups: number;
  expenses: number;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Moving another account of yours into this one.
 *
 * Two steps, because it can't be undone: prove the other account is yours and see
 * what would move, then say yes. The first step spends nothing, so changing your
 * mind leaves the code still good.
 */
export function CombineSheet({ open, onClose, me }: { open: boolean; onClose: () => void; me: MeDto }) {
  const toast = useToast();
  const client = useQueryClient();
  const [proof, setProof] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState(false);

  useResetOnOpen(open, () => {
    setProof("");
    setPreview(null);
    setBusy(false);
  });

  const check = async () => {
    if (!proof.trim() || busy) return;
    setBusy(true);
    try {
      setPreview(await api.post<Preview>("/api/identity/combine", { proof }));
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't use that",
        description: error instanceof ApiError ? error.message : "Check it and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const combine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/api/identity/combine", { proof, confirm: true });
      await client.invalidateQueries();
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "Accounts combined" });
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't combine them",
        description: error instanceof ApiError ? error.message : "Nothing has changed. Please try again.",
      });
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Combine two accounts"
      footer={
        preview ? (
          <div className="space-y-2">
            <Button variant="danger" size="lg" fullWidth loading={busy} onClick={() => void combine()}>
              Combine accounts
            </Button>
            <Button variant="ghost" size="md" fullWidth onClick={() => setPreview(null)}>
              Back
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" fullWidth loading={busy} disabled={!proof.trim()} onClick={() => void check()}>
            Continue
          </Button>
        )
      }
    >
      {preview ? (
        <div className="px-5 pb-6">
          <div className="flex items-center gap-3">
            <Avatar person={preview.other} size="lg" />
            <p className="min-w-0 text-subhead font-semibold text-text">
              Move <bdi>{preview.other.displayName}</bdi> into <bdi>{me.displayName}</bdi>?
            </p>
          </div>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted">
            <li>
              {count(preview.groups, "group", "groups")} and {count(preview.expenses, "expense", "expenses")} come
              across. Balances stay the same.
            </li>
            <li>Its recovery key and passkeys will open this account too.</li>
            <li>
              Phones signed in to it stay signed in, as <bdi>{me.displayName}</bdi>.
            </li>
            <li>
              The name <bdi>{preview.other.displayName}</bdi> goes away, and its invite code stops working.
            </li>
          </ul>
          <p className="mt-4 text-body font-semibold text-text">This can&rsquo;t be undone.</p>
        </div>
      ) : (
        <div className="px-5 pb-6">
          <p className="text-body-lg leading-relaxed text-muted">
            Ended up with two Divvy accounts? Move the other one into this one. Everything comes across, and
            balances stay the same.
          </p>
          <p className="mt-3 text-body leading-relaxed text-muted">
            This account stays, with its name, <bdi className="font-semibold text-text">{me.displayName}</bdi>. To
            keep the other one instead, do this from there.
          </p>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-body font-semibold text-muted">
              The other account&rsquo;s sign-in code or recovery key
            </span>
            <input
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              onKeyDown={(event) => void (event.key === "Enter" && check())}
              placeholder="k7fq-m2xp"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-12 w-full rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-4 font-mono text-input font-medium text-text outline-none transition placeholder:font-medium placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
            />
          </label>
          <p className="mt-2 text-caption leading-relaxed text-subtle">
            For a code, open the other account and go to You, Your devices, Add another device.
          </p>
        </div>
      )}
    </Sheet>
  );
}
