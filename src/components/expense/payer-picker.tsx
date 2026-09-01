"use client";

import * as React from "react";
import { Check, Users } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { currencySymbol, decimalsFor, parseAmount, toDecimalString } from "@/lib/money";
import { apportion } from "@/lib/split";
import type { PersonDto } from "@/lib/types";

/**
 * Who fronted the money.
 *
 * One payer is the overwhelmingly common case, so that is a single-tap list.
 * Multiple payers - two people split the hotel deposit on separate cards -
 * exists behind a toggle rather than in the main flow, because putting an
 * amount field next to every name would slow down the case that happens ninety
 * percent of the time.
 */
export function PayerPicker({
  open,
  onClose,
  members,
  meId,
  currency,
  total,
  payers,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  members: PersonDto[];
  meId: string;
  currency: string;
  total: bigint;
  payers: { personId: string; amount: bigint }[];
  onChange: (payers: { personId: string; amount: bigint }[]) => void;
}) {
  const [multiple, setMultiple] = React.useState(payers.length > 1);
  const [local, setLocal] = React.useState(payers);

  React.useEffect(() => {
    if (!open) return;
    setLocal(payers);
    setMultiple(payers.length > 1);
  }, [open, payers]);

  const assigned = local.reduce((sum, payer) => sum + payer.amount, 0n);
  const remaining = total - assigned;

  const pickSingle = (personId: string) => {
    haptic();
    // A single payer always covers the whole amount, so there is nothing to
    // type - the choice and the amount are the same action.
    onChange([{ personId, amount: total }]);
    onClose();
  };

  const toggleMultiple = (personId: string) => {
    haptic();
    setLocal((current) => {
      const exists = current.some((payer) => payer.personId === personId);
      const next = exists
        ? current.filter((payer) => payer.personId !== personId)
        : [...current, { personId, amount: 0n }];

      // Re-spread the total across whoever is now selected, so switching
      // someone on gives a sensible starting number instead of a zero.
      if (next.length === 0) return next;
      const shares = apportion(total, next.map(() => 1));
      return next.map((payer, index) => ({ ...payer, amount: shares[index] }));
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Who paid?"
      footer={
        multiple ? (
          <div>
            <p
              className={cn(
                "mb-2.5 text-center text-body font-semibold",
                remaining === 0n ? "text-positive-text" : "text-negative-text",
              )}
            >
              {remaining === 0n
                ? "Adds up exactly"
                : remaining > 0n
                  ? `${currencySymbol(currency)}${toDecimalString(remaining, currency)} still unaccounted for`
                  : `${currencySymbol(currency)}${toDecimalString(-remaining, currency)} over the total`}
            </p>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={remaining !== 0n || local.length === 0}
              onClick={() => {
                onChange(local);
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="px-5 pb-6">
        <button
          onClick={() => {
            haptic();
            const next = !multiple;
            setMultiple(next);
            if (!next && local.length > 0) {
              setLocal([{ personId: local[0].personId, amount: total }]);
            }
          }}
          className={cn(
            "mb-4 flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left transition active:scale-[0.985]",
            multiple ? "border-brand/40 bg-brand-soft" : "border-line bg-surface",
          )}
        >
          <Users className={cn("size-4", multiple ? "text-brand" : "text-subtle")} />
          <span className="flex-1 text-body-lg font-semibold text-text">
            More than one person paid
          </span>
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2 transition",
              multiple ? "border-brand bg-brand" : "border-line-strong",
            )}
          >
            {multiple ? <Check className="size-3 text-white" strokeWidth={3} /> : null}
          </span>
        </button>

        <ul className="space-y-1.5">
          {members.map((member) => {
            const payer = local.find((entry) => entry.personId === member.id);
            const selected = Boolean(payer);

            return (
              <li key={member.id}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition",
                    selected ? "border-brand/40 bg-brand-soft/40" : "border-line bg-surface",
                  )}
                >
                  <button
                    onClick={() =>
                      multiple ? toggleMultiple(member.id) : pickSingle(member.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar person={member} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                      {member.id === meId ? "You" : member.displayName}
                    </span>
                    {!multiple && selected ? (
                      <Check className="size-[18px] shrink-0 text-brand" strokeWidth={3} />
                    ) : null}
                  </button>

                  {multiple && selected ? (
                    <PayerAmount
                      value={payer!.amount}
                      currency={currency}
                      onChange={(amount) =>
                        setLocal((current) =>
                          current.map((entry) =>
                            entry.personId === member.id
                              ? { ...entry, amount: amount ?? 0n }
                              : entry,
                          ),
                        )
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}

function PayerAmount({
  value,
  currency,
  onChange,
}: {
  value: bigint;
  currency: string;
  onChange: (value: bigint | null) => void;
}) {
  const decimals = decimalsFor(currency);
  const [text, setText] = React.useState(() =>
    value === 0n ? "" : toDecimalString(value, currency),
  );

  React.useEffect(() => {
    if (parseAmount(text, currency) !== value) {
      setText(value === 0n ? "" : toDecimalString(value, currency));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);

  return (
    <div className="flex shrink-0 items-baseline gap-0.5 rounded-[var(--radius-xs)] bg-surface-2 px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--brand-ring)]">
      <span className="text-caption font-semibold text-subtle">{currencySymbol(currency)}</span>
      <input
        inputMode="decimal"
        value={text}
        placeholder="0"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          let next = event.target.value.replace(/[^\d.,]/g, "").replace(/,/g, ".");
          const dot = next.indexOf(".");
          if (dot !== -1) {
            next =
              decimals === 0
                ? next.slice(0, dot)
                : `${next.slice(0, dot)}.${next.slice(dot + 1).replace(/\./g, "").slice(0, decimals)}`;
          }
          setText(next);
          onChange(next === "" ? 0n : parseAmount(next, currency));
        }}
        className="tabular w-[76px] bg-transparent text-right text-body-lg font-bold text-text outline-none placeholder:text-subtle/60"
      />
    </div>
  );
}
