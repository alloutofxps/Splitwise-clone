"use client";

import * as React from "react";
import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { AmountInput } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useCreateSettlement } from "@/lib/client/queries";
import { toDecimalString } from "@/lib/money";
import { ApiError } from "@/lib/client/api";
import { paymentLink, PAYMENT_KINDS } from "@/lib/payments";
import type { GroupDetailDto, PaymentMethodDto, PersonDto } from "@/lib/types";
import { useResetOnOpen } from "../ui/use-reset-on-open";

/**
 * Settling up.
 *
 * Divvy deliberately does not move money. That is what keeps every feature free
 * — there is no payment rail to fund, no cut to take and no financial
 * regulation to sit under. What it does instead is remove the friction around
 * the transfer: it shows the exact amount, hands you a deep link into the payee's
 * own banking app where one exists, and records the payment when you come back.
 *
 * The flow is arranged around that: pick who, confirm how much, then *optionally*
 * pay, then mark it done. Recording the payment is never gated behind actually
 * using a link, because most people will settle in cash or through a transfer
 * the app never sees.
 */
export function SettleUpSheet({
  open,
  onClose,
  group,
  meId,
  people,
  /** Fixed counterparty, used from a friend's page where there is only one. */
  fixedPersonId,
  /** Currency for a direct settlement outside any group. */
  directCurrency,
}: {
  open: boolean;
  onClose: () => void;
  group?: GroupDetailDto;
  meId: string;
  people: Map<string, PersonDto>;
  fixedPersonId?: string;
  directCurrency?: string;
}) {
  const toast = useToast();
  const settle = useCreateSettlement(meId);

  const currency = group?.currency ?? directCurrency ?? "USD";

  // Suggested payments involving the viewer, from the group's settlement plan.
  const suggestions = React.useMemo(() => {
    if (!group) return [];
    const edges = group.simplifyDebts
      ? group.balances.simplified
      : group.balances.pairwise;
    return edges.filter(
      (edge) => edge.fromPersonId === meId || edge.toPersonId === meId,
    );
  }, [group, meId]);

  const [selected, setSelected] = React.useState<{
    fromPersonId: string;
    toPersonId: string;
    amount: bigint;
  } | null>(null);
  const [amount, setAmount] = React.useState<bigint | null>(null);
  const [method, setMethod] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  useResetOnOpen(open, () => {
    setNote("");
    setMethod(null);

    if (fixedPersonId) {
      setSelected({ fromPersonId: meId, toPersonId: fixedPersonId, amount: 0n });
      setAmount(null);
      return;
    }

    // Preselect when there is exactly one thing to settle, which is the common
    // case and saves a tap that carries no information.
    if (suggestions.length === 1) {
      const edge = suggestions[0];
      setSelected({
        fromPersonId: edge.fromPersonId,
        toPersonId: edge.toPersonId,
        amount: BigInt(edge.amount),
      });
      setAmount(BigInt(edge.amount));
    } else {
      setSelected(null);
      setAmount(null);
    }
  });

  const other = selected
    ? people.get(selected.fromPersonId === meId ? selected.toPersonId : selected.fromPersonId)
    : undefined;

  const iAmPaying = selected?.fromPersonId === meId;

  const submit = async () => {
    if (!selected || !amount || amount <= 0n) return;
    try {
      await settle.mutateAsync({
        groupId: group?.id ?? null,
        fromPersonId: selected.fromPersonId,
        toPersonId: selected.toPersonId,
        amount: amount.toString(),
        currency,
        note: note.trim() || null,
        method,
      });
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Payment recorded" });
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not record that",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settle up"
      tall={Boolean(selected)}
      footer={
        selected ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!amount || amount <= 0n}
            loading={settle.isPending}
            onClick={() => void submit()}
          >
            Record this payment
          </Button>
        ) : undefined
      }
    >
      <div className="px-5 pb-6">
        {!selected ? (
          <SuggestionList
            suggestions={suggestions}
            group={group}
            meId={meId}
            people={people}
            currency={currency}
            onPick={(edge) => {
              haptic();
              setSelected({
                fromPersonId: edge.fromPersonId,
                toPersonId: edge.toPersonId,
                amount: BigInt(edge.amount),
              });
              setAmount(BigInt(edge.amount));
            }}
          />
        ) : (
          <>
            {/* Direction ---------------------------------------------------- */}
            <div className="flex items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-4">
              <div className="flex flex-col items-center gap-1.5">
                <Avatar
                  person={iAmPaying ? people.get(meId)! : other!}
                  size="md"
                />
                <span className="text-[12px] font-semibold text-text">
                  {iAmPaying ? "You" : (other?.displayName.split(" ")[0] ?? "")}
                </span>
              </div>

              <ArrowRight className="size-5 shrink-0 text-subtle" />

              <div className="flex flex-col items-center gap-1.5">
                <Avatar person={iAmPaying ? other! : people.get(meId)!} size="md" />
                <span className="text-[12px] font-semibold text-text">
                  {iAmPaying ? (other?.displayName.split(" ")[0] ?? "") : "You"}
                </span>
              </div>

              {!fixedPersonId && suggestions.length > 1 ? (
                <button
                  onClick={() => {
                    haptic();
                    setSelected(null);
                  }}
                  className="ml-2 text-[12px] font-semibold text-brand"
                >
                  Change
                </button>
              ) : null}
            </div>

            {/* Amount ------------------------------------------------------- */}
            <div className="mt-4 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-5">
              <AmountInput
                value={amount}
                onChange={setAmount}
                currency={currency}
                size="hero"
                autoFocus
              />
              {selected.amount > 0n && amount !== selected.amount ? (
                <button
                  onClick={() => {
                    haptic();
                    setAmount(selected.amount);
                  }}
                  className="mx-auto mt-2 block text-[12px] font-semibold text-brand"
                >
                  Settle the full {toDecimalString(selected.amount, currency)}
                </button>
              ) : null}
            </div>

            {/* Pay them ----------------------------------------------------- */}
            {iAmPaying && other ? (
              <PayThem person={other} amount={amount} currency={currency} />
            ) : null}

            {/* How ---------------------------------------------------------- */}
            <div className="mt-4">
              <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
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
                      "rounded-full border px-3 py-1.5 text-[13px] font-semibold transition active:scale-95",
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
              className="mt-4 h-11 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-[15px] text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
            />
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function SuggestionList({
  suggestions,
  group,
  meId,
  people,
  currency,
  onPick,
}: {
  suggestions: { fromPersonId: string; toPersonId: string; amount: string }[];
  group?: GroupDetailDto;
  meId: string;
  people: Map<string, PersonDto>;
  currency: string;
  onPick: (edge: { fromPersonId: string; toPersonId: string; amount: string }) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[15px] font-semibold text-text">Nothing to settle</p>
        <p className="mt-1.5 text-[13px] text-muted">
          You are square with everyone in this group.
        </p>
        {group ? (
          <div className="mt-5">
            <p className="mb-2 text-[12px] font-semibold text-subtle">
              Record a payment anyway
            </p>
            <ul className="space-y-1.5">
              {group.members
                .filter((member) => member.id !== meId)
                .map((member) => (
                  <li key={member.id}>
                    <button
                      onClick={() =>
                        onPick({ fromPersonId: meId, toPersonId: member.id, amount: "0" })
                      }
                      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2.5 text-left transition active:scale-[0.985]"
                    >
                      <Avatar person={member} size="sm" />
                      <span className="flex-1 truncate text-[14px] font-semibold text-text">
                        Pay {member.displayName}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {suggestions.map((edge, index) => {
        const from = people.get(edge.fromPersonId);
        const to = people.get(edge.toPersonId);
        if (!from || !to) return null;
        const iAmPaying = edge.fromPersonId === meId;

        return (
          <li key={`${edge.fromPersonId}-${edge.toPersonId}-${index}`}>
            <button
              onClick={() => onPick(edge)}
              className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3 text-left transition active:scale-[0.985] hover:border-line-strong"
            >
              <Avatar person={iAmPaying ? to : from} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-text">
                  {iAmPaying
                    ? `Pay ${to.displayName.split(" ")[0]}`
                    : `${from.displayName.split(" ")[0]} pays you`}
                </span>
                <span className="tabular mt-0.5 block text-[12px] text-subtle">
                  {toDecimalString(BigInt(edge.amount), currency)} {currency}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-subtle" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/**
 * Payment handles, turned into something tappable.
 *
 * A UPI id becomes a `upi://` link that opens GPay or PhonePe with the amount
 * already filled in; a PayPal.me slug becomes a prefilled URL. Where no deep
 * link exists — a bare IBAN — the handle is offered as a copy button instead,
 * which is still better than making someone switch apps to look it up.
 */
function PayThem({
  person,
  amount,
  currency,
}: {
  person: PersonDto;
  amount: bigint | null;
  currency: string;
}) {
  const toast = useToast();
  const [methods, setMethods] = React.useState<PaymentMethodDto[] | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${person.id}/payment-methods`)
      .then((response) => (response.ok ? response.json() : { paymentMethods: [] }))
      .then((payload: { paymentMethods?: PaymentMethodDto[] }) => {
        if (!cancelled) setMethods(payload.paymentMethods ?? []);
      })
      .catch(() => !cancelled && setMethods([]));
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  if (!methods || methods.length === 0) return null;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      haptic();
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ tone: "info", title: "Copy it by hand", description: value });
    }
  };

  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
      <p className="mb-2.5 text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
        Pay {person.displayName.split(" ")[0]}
      </p>
      <ul className="space-y-1.5">
        {methods.map((entry) => {
          const kind = PAYMENT_KINDS.find((k) => k.value === entry.kind);
          const link = paymentLink(entry, amount, currency, person.displayName);

          return (
            <li key={entry.id}>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => haptic()}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5 transition active:scale-[0.985]"
                >
                  <span className="text-[16px]">{kind?.emoji ?? "💸"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-text">
                      {entry.label || kind?.label || entry.kind}
                    </span>
                    <span className="block truncate text-[11px] text-subtle">
                      {entry.value}
                    </span>
                  </span>
                  <ExternalLink className="size-4 shrink-0 text-brand" />
                </a>
              ) : (
                <button
                  onClick={() => void copy(entry.value)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5 text-left transition active:scale-[0.985]"
                >
                  <span className="text-[16px]">{kind?.emoji ?? "💸"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-text">
                      {entry.label || kind?.label || entry.kind}
                    </span>
                    <span className="block truncate text-[11px] text-subtle">
                      {entry.value}
                    </span>
                  </span>
                  {copied === entry.value ? (
                    <Check className="size-4 shrink-0 text-positive" strokeWidth={3} />
                  ) : (
                    <Copy className="size-4 shrink-0 text-subtle" />
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[11px] leading-relaxed text-subtle">
        Divvy never touches your money — these just open your own banking app.
        Record the payment below once it has gone through.
      </p>
    </div>
  );
}
