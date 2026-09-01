"use client";

import * as React from "react";
import { ArrowRight, Check } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Amount } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useSettleWithPerson } from "@/lib/client/queries";
import { formatMoney } from "@/lib/money";
import { ApiError } from "@/lib/client/api";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import type { PersonDto, SharedLedgerDto } from "@/lib/types";

/**
 * Squaring up with a person, across everywhere the two of you owe each other.
 *
 * The debt accumulates in several places — a trip, a flat, the taxi last
 * Tuesday — and gets settled the way people actually settle it, with one
 * transfer for the net. Making somebody open five groups and record five
 * payments to represent one bank transfer is arithmetic homework, and the app
 * already knows every figure it would ask them for.
 *
 * What it does *not* do is hide what it is writing. Each ledger is listed with
 * its own amount and direction, because that is exactly what lands in the
 * database: one row per ledger, so every group's books stay correct for the
 * people in it who were never part of this conversation. Unticking a ledger
 * leaves it alone.
 *
 * Directions can point both ways at once, and that is not an error to smooth
 * over: being owed for the holiday and owing for the rent is ordinary, and the
 * net is what changes hands.
 */
export function SettleAcrossSheet({
  open,
  onClose,
  person,
  me,
  ledgers,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  person: PersonDto;
  me: PersonDto;
  /** Every shared ledger in `currency` with something outstanding. */
  ledgers: SharedLedgerDto[];
  currency: string;
}) {
  const toast = useToast();
  const settle = useSettleWithPerson();

  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [method, setMethod] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  useResetOnOpen(open, () => {
    setSkipped(new Set());
    setMethod(null);
    setNote("");
  });

  const key = (ledger: SharedLedgerDto) => ledger.groupId ?? "direct";
  const chosen = ledgers.filter((ledger) => !skipped.has(key(ledger)));

  // The net of what is ticked: what actually changes hands.
  const net = chosen.reduce((total, ledger) => total + BigInt(ledger.net), 0n);
  const theyPayMe = net > 0n;
  const magnitude = net < 0n ? -net : net;

  const submit = async () => {
    if (chosen.length === 0) return;
    try {
      const result = await settle.mutateAsync({
        personId: person.id,
        currency,
        method,
        note: note.trim() || null,
        rows: chosen.map((ledger) => ({
          groupId: ledger.groupId,
          amount: (BigInt(ledger.net) < 0n ? -BigInt(ledger.net) : BigInt(ledger.net)).toString(),
        })),
      });
      haptic([8, 30, 8]);
      toast(
        result === null
          ? {
              tone: "offline",
              title: "Saved on your device",
              description: "It will sync as soon as you are back online.",
            }
          : {
              tone: "success",
              title: chosen.length === 1 ? "Payment recorded" : `Settled ${chosen.length} balances`,
              description:
                chosen.length === 1
                  ? undefined
                  : "Each one is recorded in its own group. Undoing it undoes all of them.",
            },
      );
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not record that",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  const payer = theyPayMe ? person : me;
  const payee = theyPayMe ? me : person;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settle up"
      tall
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={chosen.length === 0 || net === 0n}
          loading={settle.isPending}
          onClick={() => void submit()}
        >
          {chosen.length === 0
            ? "Nothing selected"
            : net === 0n
              ? "These cancel out"
              : `Record ${formatMoney(magnitude, currency)}`}
        </Button>
      }
    >
      <div className="px-5 pb-6">
        {/* Direction and net ------------------------------------------------ */}
        <div className="flex items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-4">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar person={payer} size="md" />
            <span className="text-caption font-semibold text-text">
              {payer.id === me.id ? "You" : payer.displayName.split(" ")[0]}
            </span>
          </div>
          <ArrowRight className="size-5 shrink-0 text-subtle" />
          <div className="flex flex-col items-center gap-1.5">
            <Avatar person={payee} size="md" />
            <span className="text-caption font-semibold text-text">
              {payee.id === me.id ? "You" : payee.displayName.split(" ")[0]}
            </span>
          </div>
        </div>

        <p className="mt-4 text-center">
          <Amount value={magnitude} currency={currency} size="hero" tone="plain" />
        </p>
        <p className="mt-1 text-center text-body text-muted">
          {net === 0n
            ? "What you owe each other cancels out exactly."
            : chosen.length === 1
              ? "One balance"
              : `The net of ${chosen.length} balances`}
        </p>

        {/* What gets written ------------------------------------------------ */}
        <p className="mb-2 mt-6 px-1 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
          This records
        </p>
        <ul className="space-y-1.5">
          {ledgers.map((ledger) => {
            const id = key(ledger);
            const included = !skipped.has(id);
            const value = BigInt(ledger.net);
            const owedToMe = value > 0n;

            return (
              <li key={id}>
                <button
                  onClick={() => {
                    haptic();
                    setSkipped((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  aria-pressed={included}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border px-3.5 py-3 text-left transition active:scale-[0.985]",
                    included ? "border-brand/40 bg-brand-soft/30" : "border-line bg-surface opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition",
                      included ? "border-brand bg-brand text-white" : "border-line-strong",
                    )}
                  >
                    {included ? <Check className="size-3.5" strokeWidth={3.5} /> : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-lg font-semibold text-text">
                      {ledger.emoji ? `${ledger.emoji} ` : ""}
                      {ledger.name ?? "Just between you"}
                    </span>
                    <span className="mt-0.5 block text-caption text-subtle">
                      {owedToMe
                        ? `${person.displayName.split(" ")[0]} owes you here`
                        : `You owe ${person.displayName.split(" ")[0]} here`}
                    </span>
                  </span>

                  <Amount
                    value={value < 0n ? -value : value}
                    currency={ledger.currency}
                    size="sm"
                    tone={owedToMe ? "positive" : "negative"}
                    className="shrink-0"
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-2 px-1 text-tiny leading-relaxed text-subtle">
          Each of these is recorded separately in its own group, so everyone else
          sees only what happened in theirs. Undoing the payment undoes all of them.
        </p>

        {/* How -------------------------------------------------------------- */}
        <div className="mt-5">
          <p className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
            How was it paid?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Cash", "Bank transfer", "UPI", "PayPal", "Venmo", "Other"].map((option) => (
              <button
                key={option}
                onClick={() => {
                  haptic();
                  setMethod(method === option ? null : option);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-body font-semibold transition active:scale-95",
                  method === option
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-muted",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          placeholder="Add a note (optional)"
          className="mt-4 h-11 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
        />
      </div>
    </Sheet>
  );
}
