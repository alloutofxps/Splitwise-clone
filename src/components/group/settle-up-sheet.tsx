"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, ExternalLink, Wallet } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { AmountInput } from "../ui/money";
import { Avatar, usePersonHue } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useCreateSettlement, useDashboard, useDeleteSettlement } from "@/lib/client/queries";
import { convert, exactRate, formatMoney, inverseRate } from "@/lib/money";
import { ConversionNote } from "../ui/conversion-note";
import { CurrencyPicker } from "../expense/currency-picker";
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
  /** A specific transfer to open on, from tapping one in the balances list. */
  initialEdge,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  group?: GroupDetailDto;
  meId: string;
  people: Map<string, PersonDto>;
  fixedPersonId?: string;
  directCurrency?: string;
  initialEdge?: { fromPersonId: string; toPersonId: string; amount: string };
  /** Told who paid whom once it is saved, so the screen can show it moving. */
  /**
   * A payment was saved: who paid whom, the debt it was paid against (in the
   * group's currency), and whether it paid that debt off.
   */
  onSaved?: (payment: { fromPersonId: string; toPersonId: string; amount: bigint; cleared: boolean }) => void;
}) {
  const toast = useToast();
  const settle = useCreateSettlement(meId);
  const removeSettlement = useDeleteSettlement();
  const { data: dashboard } = useDashboard();
  // The payee's own ways of being paid: fetched for someone else, already in
  // hand for yourself.
  const [payeeMethods, setPayeeMethods] = React.useState<PaymentMethodDto[]>([]);
  const [settlingAll, setSettlingAll] = React.useState(false);

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

  /**
   * Everyone else in the group, so the picker is never narrower than the group.
   *
   * The suggestions are a *plan*, not the set of people you are allowed to pay:
   * a plan of one still leaves three other members you might be squaring up
   * with over dinner.
   */
  const others = React.useMemo(
    () => (group?.members ?? []).filter((member) => member.id !== meId),
    [group, meId],
  );

  const [selected, setSelected] = React.useState<{
    fromPersonId: string;
    toPersonId: string;
    amount: bigint;
  } | null>(null);
  const [amount, setAmount] = React.useState<bigint | null>(null);
  const [method, setMethod] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  // Paying in another currency than the group counts in: a euro debt paid in
  // dollars. Only offered in a group - a direct balance lives in the currency
  // it was made in, so a payment in another one would open a second balance.
  const [payCurrency, setPayCurrency] = React.useState(currency);
  const [rate, setRate] = React.useState("1");
  const [pickingCurrency, setPickingCurrency] = React.useState(false);

  useResetOnOpen(open, () => {
    setNote("");
    setMethod(null);
    setPayCurrency(currency);
    setRate("1");

    // Arrived by tapping a specific transfer: open straight on it, whatever
    // the plan would otherwise have suggested.
    if (initialEdge) {
      setSelected({
        fromPersonId: initialEdge.fromPersonId,
        toPersonId: initialEdge.toPersonId,
        amount: BigInt(initialEdge.amount),
      });
      setAmount(BigInt(initialEdge.amount));
      return;
    }

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

  const foreign = payCurrency !== currency;
  const rateOk = isPositiveDecimal(rate);
  // The whole debt, in the currency being paid in.
  const fullAmount =
    selected && selected.amount > 0n
      ? foreign
        ? rateOk
          ? convert(selected.amount, currency, payCurrency, inverseRate(rate))
          : null
        : selected.amount
      : null;

  // When the rate arrives or changes, keep a full payment full.
  const [lastFull, setLastFull] = React.useState<bigint | null>(null);
  if (fullAmount !== lastFull) {
    setLastFull(fullAmount);
    if (fullAmount !== null && (amount === null || amount === lastFull)) setAmount(fullAmount);
  }

  // Closed, or closing: the panel on its way out keeps the content it left
  // with, so there is nothing to rebuild while the payment plays out behind it.
  if (!open) return <Sheet open={false} onClose={onClose} title="Settle up" />;

  const submit = async () => {
    if (!selected || !amount || amount <= 0n) return;
    try {
      const saved = await settle.mutateAsync({
        groupId: group?.id ?? null,
        fromPersonId: selected.fromPersonId,
        toPersonId: selected.toPersonId,
        amount: amount.toString(),
        currency: payCurrency,
        ...(foreign
          ? {
              // Paying the whole debt sends the rate that turns this amount
              // into exactly what was owed, so nothing is left over from
              // rounding; any other amount uses the rate as shown.
              exchangeRate:
                selected.amount > 0n && amount === fullAmount
                  ? exactRate(selected.amount, currency, amount, payCurrency)
                  : rate,
            }
          : {}),
        note: note.trim() || null,
        method,
      });
      haptic([8, 30, 8]);
      toast({
        tone: "success",
        title: "Payment saved",
        action: saved
          ? {
              label: "Undo",
              onClick: () =>
                removeSettlement.mutate(
                  { id: saved.id, groupId: group?.id ?? null },
                  {
                    onSuccess: () => toast({ tone: "success", title: "Payment removed" }),
                    onError: () => toast({ tone: "error", title: "Couldn\u2019t undo that" }),
                  },
                ),
            }
          : undefined,
      });
      onSaved?.({
        fromPersonId: selected.fromPersonId,
        toPersonId: selected.toPersonId,
        amount: selected.amount,
        cleared: fullAmount !== null && amount === fullAmount,
      });
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't save that",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <>
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
            disabled={!amount || amount <= 0n || (foreign && !rateOk)}
            loading={settle.isPending}
            onClick={() => void submit()}
          >
            Save payment
          </Button>
        ) : undefined
      }
    >
      <div className="px-5 pb-6">
        {!selected ? (
          <SuggestionList
            suggestions={suggestions}
            others={others}
            meId={meId}
            people={people}
            currency={currency}
            settlingAll={settlingAll}
            onSettleAll={
              group
                ? async (edges) => {
                    setSettlingAll(true);
                    try {
                      for (const edge of edges) {
                        await settle.mutateAsync({
                          groupId: group.id,
                          fromPersonId: edge.fromPersonId,
                          toPersonId: edge.toPersonId,
                          amount: edge.amount,
                          currency,
                          note: null,
                          method: null,
                        });
                      }
                      haptic([8, 30, 8]);
                      toast({ tone: "success", title: `Saved ${edges.length} payments` });
                      onSaved?.({
                        fromPersonId: edges[0].fromPersonId,
                        toPersonId: edges[0].toPersonId,
                        amount: BigInt(edges[0].amount),
                        cleared: true,
                      });
                      onClose();
                    } catch (error) {
                      toast({
                        tone: "error",
                        title: "Couldn\u2019t save all of them",
                        description: error instanceof ApiError ? error.message : undefined,
                      });
                    } finally {
                      setSettlingAll(false);
                    }
                  }
                : undefined
            }
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
            {/* Payer and payee, joined by the line the money travels along. */}
            <PairLine
              from={people.get(selected.fromPersonId)}
              to={people.get(selected.toPersonId)}
              meId={meId}
              label={amount && amount > 0n ? formatMoney(amount, payCurrency) : null}
            />
            {!fixedPersonId && others.length > 0 ? (
              <button
                onClick={() => {
                  haptic();
                  setSelected(null);
                }}
                className="mx-auto mt-1 block rounded-[var(--radius-sm)] px-2 py-1 text-caption font-medium text-muted underline-offset-2 hover:text-text hover:underline"
              >
                Someone else
              </button>
            ) : null}

            {/* Amount ------------------------------------------------------- */}
            <div className="mt-4 px-4 py-2">
              {group ? (
                <button
                  onClick={() => {
                    haptic();
                    setPickingCurrency(true);
                  }}
                  className="mx-auto mb-2 flex items-center gap-1 rounded-full border border-line px-3 py-1 text-caption font-medium text-text"
                  aria-label={`Currency: ${payCurrency}`}
                >
                  Paying in {payCurrency}
                  <ChevronDown className="size-3.5" />
                </button>
              ) : null}
              <AmountInput
                value={amount}
                onChange={setAmount}
                currency={payCurrency}
                size="hero"
                autoFocus
              />
              {foreign ? (
                <ConversionNote
                  amount={amount ?? 0n}
                  from={payCurrency}
                  to={currency}
                  rate={rate}
                  onRateChange={setRate}
                />
              ) : null}
              {fullAmount !== null && amount !== fullAmount ? (
                <button
                  onClick={() => {
                    haptic();
                    setAmount(fullAmount);
                  }}
                  className="mx-auto mt-2 block text-caption font-medium text-text underline underline-offset-2"
                >
                  Pay the full {formatMoney(fullAmount, payCurrency)}
                </button>
              ) : null}
            </div>

            {/* Pay them ----------------------------------------------------- */}
            {iAmPaying && other ? (
              <PayThem person={other} amount={amount} currency={payCurrency} onMethods={setPayeeMethods} />
            ) : null}

            {/* How ---------------------------------------------------------- */}
            <div className="mt-4">
              <p className="mb-2 px-1 text-caption font-medium text-subtle">
                How was it paid?
              </p>
              <div className="flex flex-wrap gap-2">
                {methodChoices(iAmPaying ? payeeMethods : (dashboard?.me.paymentMethods ?? [])).map((option) => (
                  <button
                    key={option}
                    aria-pressed={method === option}
                    onClick={() => {
                      haptic();
                      setMethod(method === option ? null : option);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-body font-medium transition-colors",
                      method === option
                        ? "border-text bg-text text-inverse"
                        : "border-line bg-surface text-text hover:bg-surface-2",
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
              className="mt-4 h-11 w-full rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:ring-[1.5px] focus:ring-text"
            />
          </>
        )}
      </div>
    </Sheet>
    <CurrencyPicker
      open={pickingCurrency}
      onClose={() => setPickingCurrency(false)}
      value={payCurrency}
      onChange={(next) => {
        setPayCurrency(next);
        setRate("1");
        // Start from the full debt again in the new currency.
        setAmount(null);
        setPickingCurrency(false);
      }}
    />
    </>
  );
}

// ---------------------------------------------------------------------------

function SuggestionList({
  suggestions,
  others,
  meId,
  people,
  currency,
  onPick,
  onSettleAll,
  settlingAll,
}: {
  /** Records every payment you owe in the group at once. */
  onSettleAll?: (edges: { fromPersonId: string; toPersonId: string; amount: string }[]) => void | Promise<void>;
  settlingAll?: boolean;
  suggestions: { fromPersonId: string; toPersonId: string; amount: string }[];
  /** Every other member of the group, whether or not the plan mentions them. */
  others: PersonDto[];
  meId: string;
  people: Map<string, PersonDto>;
  currency: string;
  onPick: (edge: { fromPersonId: string; toPersonId: string; amount: string }) => void;
}) {
  // Someone already named by a suggestion is not repeated underneath it.
  const suggested = new Set(
    suggestions.map((edge) => (edge.fromPersonId === meId ? edge.toPersonId : edge.fromPersonId)),
  );
  const rest = others.filter((person) => !suggested.has(person.id));
  const mine = suggestions.filter((edge) => edge.fromPersonId === meId);
  const mineTotal = mine.reduce((total, edge) => total + BigInt(edge.amount), 0n);

  return (
    <div className="space-y-5">
      {onSettleAll && mine.length > 1 ? (
        <Button variant="primary" fullWidth loading={settlingAll} onClick={() => void onSettleAll(mine)}>
          Settle all in this group · {formatMoney(mineTotal, currency)} to {mine.length} people
        </Button>
      ) : null}
      {suggestions.length > 0 ? (
        <div>
          <p className="mb-2 px-1 text-caption font-medium text-subtle">
            {suggestions.length === 1 ? "Suggested" : "Suggested payments"}
          </p>
          <ul className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line">
            {suggestions.map((edge, index) => {
              const from = people.get(edge.fromPersonId);
              const to = people.get(edge.toPersonId);
              if (!from || !to) return null;
              const iAmPaying = edge.fromPersonId === meId;

              return (
                <li key={`${edge.fromPersonId}-${edge.toPersonId}-${index}`}>
                  <button
                    onClick={() => onPick(edge)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <Avatar person={iAmPaying ? to : from} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-lg font-semibold text-text">
                        {iAmPaying
                          ? `Pay ${to.displayName.split(" ")[0]}`
                          : `${from.displayName.split(" ")[0]} pays you`}
                      </span>
                      {/* Coloured and pointed the way Balances shows the same debt. */}
                      <span
                        className={cn(
                          "tabular mt-0.5 block text-caption",
                          iAmPaying ? "text-negative-text" : "text-positive-text",
                        )}
                      >
                        {iAmPaying ? (
                          <ArrowUpRight aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                        ) : (
                          <ArrowDownLeft aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                        )}
                        {formatMoney(BigInt(edge.amount), currency)}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-subtle" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="pt-4 text-center">
          <p className="text-subhead font-semibold text-text">Nothing to settle</p>
          <p className="mt-1.5 text-body text-muted">
            Nobody in this group owes you, and you don&rsquo;t owe anyone.
          </p>
        </div>
      )}

      {rest.length > 0 ? (
        <div>
          <p className="mb-2 px-1 text-caption font-medium text-subtle">
            {suggestions.length > 0 ? "Someone else" : "Add a payment anyway"}
          </p>
          <ul className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line">
            {rest.map((person) => (
              <li key={person.id}>
                <button
                  onClick={() => onPick({ fromPersonId: meId, toPersonId: person.id, amount: "0" })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <Avatar person={person} size="sm" />
                  <span className="flex-1 truncate text-body-lg font-semibold text-text">
                    Pay {person.displayName}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
  onMethods,
}: {
  person: PersonDto;
  amount: bigint | null;
  currency: string;
  /** Told what the payee accepts, so the "how" choices can lead with it. */
  onMethods?: (methods: PaymentMethodDto[]) => void;
}) {
  const toast = useToast();
  const [methods, setMethods] = React.useState<PaymentMethodDto[] | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${person.id}/payment-methods`)
      .then((response) => (response.ok ? response.json() : { paymentMethods: [] }))
      .then((payload: { paymentMethods?: PaymentMethodDto[] }) => {
        if (!cancelled) {
          setMethods(payload.paymentMethods ?? []);
          onMethods?.(payload.paymentMethods ?? []);
        }
      })
      .catch(() => !cancelled && setMethods([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="mt-5">
      <p className="mb-2 px-1 text-caption font-medium text-subtle">
        How {person.displayName.split(" ")[0]} would like to be paid
      </p>
      <ul className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line">
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
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text"><Wallet className="size-4" strokeWidth={1.75} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-text">
                      {entry.label || kind?.label || entry.kind}
                    </span>
                    <span className="block truncate text-tiny text-subtle">
                      {entry.value}
                    </span>
                  </span>
                  <ExternalLink className="size-4 shrink-0 text-text" />
                </a>
              ) : (
                <button
                  onClick={() => void copy(entry.value)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text"><Wallet className="size-4" strokeWidth={1.75} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-text">
                      {entry.label || kind?.label || entry.kind}
                    </span>
                    <span className="block truncate text-tiny text-subtle">
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
      <p className="mt-2.5 text-tiny leading-relaxed text-subtle">
        Divvy never moves money. These buttons open your own payment app. Once
        you&rsquo;ve paid, save the payment below.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paying in another currency
// ---------------------------------------------------------------------------

function isPositiveDecimal(value: string): boolean {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) return false;
  return Number(value) > 0;
}

/**
 * The ways a payment can be recorded as made: the payee's own methods first,
 * then cash, a bank transfer, or something else.
 */
function methodChoices(methods: PaymentMethodDto[]): string[] {
  const theirs = methods.map((entry) => PAYMENT_KINDS.find((kind) => kind.value === entry.kind)?.label ?? entry.label ?? "");
  return [...new Set([...theirs.filter(Boolean), "Cash", "Bank transfer", "Other"])];
}

/**
 * The payer and payee as two avatars joined by their line, with the amount
 * riding on it: the same picture as the flow map, for one payment.
 */
function PairLine({
  from,
  to,
  meId,
  label,
}: {
  from?: PersonDto;
  to?: PersonDto;
  meId: string;
  label: string | null;
}) {
  const hue = usePersonHue(from ?? { avatarColor: "sand" });
  if (!from || !to) return null;
  const name = (person: PersonDto) => (person.id === meId ? "You" : person.displayName.split(" ")[0]);
  return (
    <div className="flex items-center gap-2 px-2 pt-2">
      <span className="flex w-16 shrink-0 flex-col items-center gap-1">
        <Avatar person={from} size="md" />
        <span className="max-w-full truncate text-caption text-text">{name(from)}</span>
      </span>
      <span className="relative min-w-0 flex-1 self-start pt-3">
        <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="h-4 w-full" aria-hidden="true">
          <path d="M 0 10 Q 50 0 96 10" fill="none" stroke={hue} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </svg>
        <ArrowRight className="absolute -right-1 top-[13px] size-3.5" style={{ color: hue }} strokeWidth={2.5} />
        {label ? (
          <span className="tabular absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-caption font-medium text-text">
            {label}
          </span>
        ) : null}
      </span>
      <span className="flex w-16 shrink-0 flex-col items-center gap-1">
        <Avatar person={to} size="md" />
        <span className="max-w-full truncate text-caption text-text">{name(to)}</span>
      </span>
    </div>
  );
}
