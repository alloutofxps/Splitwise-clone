"use client";

import * as React from "react";
import { Equal, Hash, Percent, Plus, Receipt, SlidersHorizontal, Trash2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { currencySymbol, toDecimalString } from "@/lib/money";
import { CompactAmountInput } from "../ui/money";
import { resolveSplit, type SplitMode, type SplitParticipant } from "@/lib/split";
import type { PersonDto } from "@/lib/types";

/**
 * The split editor.
 *
 * Six ways to divide a bill, all of which people genuinely use:
 *
 *   equally      four of us had dinner
 *   exact        I know precisely what each person's share is
 *   percent      we split the rent 60/40
 *   shares       the couple counts as two, I count as one
 *   extras       we split evenly, but Sam also had the £6 cocktail
 *   itemised     here is the receipt, tick what you ordered
 *
 * The running total at the bottom is the thing that makes any of this usable:
 * it says how much is still unassigned, in the currency, at all times. Nobody
 * should have to do mental arithmetic to satisfy a form.
 */

const MODES: { value: SplitMode; label: string; icon: React.ReactNode; blurb: string }[] = [
  { value: "EQUAL", label: "Equally", icon: <Equal className="size-4" />, blurb: "Split the total evenly between everyone selected." },
  { value: "EXACT", label: "Exactly", icon: <Hash className="size-4" />, blurb: "Type each person's share. They have to add up to the total." },
  { value: "PERCENT", label: "Percent", icon: <Percent className="size-4" />, blurb: "Divide by percentage. Has to reach 100%." },
  { value: "SHARES", label: "Shares", icon: <SlidersHorizontal className="size-4" />, blurb: "Give people a weight — two shares for a couple, one each for the rest." },
  { value: "ADJUSTMENT", label: "Extras", icon: <Plus className="size-4" />, blurb: "Split evenly, then add what individual people had on top." },
  { value: "ITEMIZED", label: "By item", icon: <Receipt className="size-4" />, blurb: "Enter the receipt line by line and tick who had what." },
];

export interface SplitEditorProps {
  open: boolean;
  onClose: () => void;
  members: PersonDto[];
  meId: string;
  currency: string;
  total: bigint;
  mode: SplitMode;
  participants: SplitParticipant[];
  payerIds: string[];
  onChange: (mode: SplitMode, participants: SplitParticipant[]) => void;
}

export function SplitEditor({
  open,
  onClose,
  members,
  meId,
  currency,
  total,
  mode,
  participants,
  payerIds,
  onChange,
}: SplitEditorProps) {
  const [localMode, setLocalMode] = React.useState<SplitMode>(mode);
  const [local, setLocal] = React.useState<SplitParticipant[]>(participants);
  const [items, setItems] = React.useState<ReceiptItem[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setLocalMode(mode);
    // Anyone who joined the group since this draft was started still needs a
    // row, or they silently drop out of the split.
    setLocal(
      members.map(
        (member) =>
          participants.find((p) => p.personId === member.id) ?? {
            personId: member.id,
            included: true,
          },
      ),
    );
  }, [open, mode, participants, members]);

  const resolved = resolveSplit({
    mode: localMode,
    total,
    participants: local,
    payerIds,
    items: items.map((item) => ({
      id: item.id,
      amount: item.amount ?? 0n,
      participantIds: item.participantIds,
    })),
  });

  const update = (personId: string, changes: Partial<SplitParticipant>) => {
    setLocal((current) =>
      current.map((entry) =>
        entry.personId === personId ? { ...entry, ...changes } : entry,
      ),
    );
  };

  /**
   * Switching modes seeds the new one from the current split rather than
   * resetting it, so moving from "equally" to "exactly" to nudge one number
   * does not wipe the other three.
   */
  const switchMode = (next: SplitMode) => {
    haptic();
    const current = resolveSplit({ mode: localMode, total, participants: local, payerIds });
    const byId = new Map(current.splits.map((s) => [s.personId, s]));
    const includedCount = current.splits.filter((s) => s.included).length || 1;

    setLocal((entries) =>
      entries.map((entry) => {
        const split = byId.get(entry.personId);
        const share = split?.amount ?? 0n;
        const included = split?.included ?? true;

        switch (next) {
          case "EXACT":
            return { ...entry, included, amount: share };
          case "PERCENT":
            return {
              ...entry,
              included,
              percent:
                total > 0n
                  ? Math.round((Number(share) / Number(total)) * 1000) / 10
                  : included
                    ? Math.round((100 / includedCount) * 10) / 10
                    : 0,
            };
          case "SHARES":
            return { ...entry, included, weight: included ? (entry.weight ?? 1) : 0 };
          case "ADJUSTMENT":
            return { ...entry, included, adjustment: entry.adjustment ?? 0n };
          default:
            return { ...entry, included };
        }
      }),
    );
    setLocalMode(next);
  };

  const commit = () => {
    // Itemised splits resolve to plain amounts before saving, so the stored
    // expense is a normal one and every balance path stays identical.
    if (localMode === "ITEMIZED") {
      onChange(
        "ITEMIZED",
        resolved.splits.map((split) => ({
          personId: split.personId,
          included: split.included,
          amount: split.amount,
        })),
      );
    } else {
      onChange(localMode, local);
    }
    onClose();
  };

  const activeMode = MODES.find((m) => m.value === localMode)!;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="How does it split?"
      footer={
        <div>
          <RunningTotal
            mode={localMode}
            resolved={resolved}
            total={total}
            currency={currency}
            local={local}
          />
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="mt-3"
            disabled={resolved.errors.length > 0}
            onClick={commit}
          >
            Done
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-6">
        {/* Mode picker ---------------------------------------------------- */}
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {MODES.map((option) => (
            <button
              key={option.value}
              onClick={() => switchMode(option.value)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-body font-semibold transition active:scale-95",
                option.value === localMode
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted hover:bg-surface-2",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-body leading-relaxed text-muted">{activeMode.blurb}</p>

        {/* Itemised gets its own editor ----------------------------------- */}
        {localMode === "ITEMIZED" ? (
          <ItemEditor
            items={items}
            setItems={setItems}
            members={members}
            meId={meId}
            currency={currency}
            total={total}
          />
        ) : (
          <>
            {localMode === "EQUAL" ? (
              <div className="mt-4 flex gap-2">
                <MiniButton onClick={() => setLocal((c) => c.map((e) => ({ ...e, included: true })))}>
                  Everyone
                </MiniButton>
                <MiniButton
                  onClick={() =>
                    setLocal((c) => c.map((e) => ({ ...e, included: e.personId === meId })))
                  }
                >
                  Just me
                </MiniButton>
              </div>
            ) : null}

            <ul className="mt-4 space-y-1.5">
              {members.map((member) => {
                const entry = local.find((e) => e.personId === member.id);
                if (!entry) return null;
                const split = resolved.splits.find((s) => s.personId === member.id);

                return (
                  <ParticipantRow
                    key={member.id}
                    member={member}
                    isMe={member.id === meId}
                    entry={entry}
                    mode={localMode}
                    currency={currency}
                    resolvedAmount={split?.amount ?? 0n}
                    onUpdate={(changes) => update(member.id, changes)}
                  />
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function ParticipantRow({
  member,
  isMe,
  entry,
  mode,
  currency,
  resolvedAmount,
  onUpdate,
}: {
  member: PersonDto;
  isMe: boolean;
  entry: SplitParticipant;
  mode: SplitMode;
  currency: string;
  resolvedAmount: bigint;
  onUpdate: (changes: Partial<SplitParticipant>) => void;
}) {
  const included = entry.included !== false;

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition",
        included ? "border-line bg-surface" : "border-transparent bg-surface-2/50 opacity-55",
      )}
    >
      <button
        onClick={() => {
          haptic();
          onUpdate({ included: !included });
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-pressed={included}
      >
        <Avatar person={member} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-lg font-semibold text-text">
            {isMe ? "You" : member.displayName}
          </span>
          {included && mode !== "EXACT" ? (
            <span className="tabular block text-caption text-subtle">
              {currencySymbol(currency)}
              {toDecimalString(resolvedAmount, currency)}
            </span>
          ) : null}
        </span>
      </button>

      {included ? (
        <ModeInput
          mode={mode}
          entry={entry}
          currency={currency}
          onUpdate={onUpdate}
          personName={isMe ? "you" : member.displayName}
        />
      ) : null}
    </li>
  );
}

function ModeInput({
  mode,
  entry,
  currency,
  onUpdate,
  personName,
}: {
  mode: SplitMode;
  entry: SplitParticipant;
  currency: string;
  onUpdate: (changes: Partial<SplitParticipant>) => void;
  personName: string;
}) {
  switch (mode) {
    case "EXACT":
      return (
        <CompactAmountInput
          value={entry.amount ?? 0n}
          currency={currency}
          onChange={(amount) => onUpdate({ amount })}
          label={`Share for ${personName}`}
        />
      );

    case "PERCENT":
      return (
        <div className="flex shrink-0 items-baseline gap-1">
          <input
            inputMode="decimal"
            value={entry.percent ?? 0}
            onChange={(event) => {
              const value = Number(event.target.value.replace(/[^\d.]/g, ""));
              onUpdate({ percent: Number.isFinite(value) ? value : 0 });
            }}
            onFocus={(event) => event.currentTarget.select()}
            className="tabular w-14 rounded-[var(--radius-xs)] bg-surface-2 px-2 py-1.5 text-right text-input font-bold text-text outline-none focus:ring-2 focus:ring-[var(--brand-ring)]"
          />
          <span className="text-body font-semibold text-subtle">%</span>
        </div>
      );

    case "SHARES":
      return (
        <Stepper
          value={entry.weight ?? 1}
          onChange={(weight) => onUpdate({ weight })}
        />
      );

    case "ADJUSTMENT":
      return (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-body font-bold text-subtle">+</span>
          <CompactAmountInput
            value={entry.adjustment ?? 0n}
            currency={currency}
            onChange={(adjustment) => onUpdate({ adjustment })}
            label={`Extra for ${personName}`}
          />
        </div>
      );

    default:
      return null;
  }
}


function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 p-1">
      <button
        onClick={() => {
          haptic();
          onChange(Math.max(0, value - 1));
        }}
        aria-label="One fewer share"
        className="flex size-7 items-center justify-center rounded-full text-input font-bold text-muted transition active:scale-90 hover:bg-surface-3"
      >
        −
      </button>
      <span className="tabular w-6 text-center text-body-lg font-bold text-text">{value}</span>
      <button
        onClick={() => {
          haptic();
          onChange(Math.min(99, value + 1));
        }}
        aria-label="One more share"
        className="flex size-7 items-center justify-center rounded-full text-input font-bold text-muted transition active:scale-90 hover:bg-surface-3"
      >
        +
      </button>
    </div>
  );
}

function MiniButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-muted transition active:scale-95 hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * The line that says whether the split is finished.
 *
 * Phrased as what is *left*, not what is assigned, because "12.50 to go" tells
 * you what to do next and "87.50 of 100 assigned" makes you subtract.
 */
function RunningTotal({
  mode,
  resolved,
  total,
  currency,
  local,
}: {
  mode: SplitMode;
  resolved: ReturnType<typeof resolveSplit>;
  total: bigint;
  currency: string;
  local: SplitParticipant[];
}) {
  if (resolved.errors.length > 0) {
    return (
      <p className="rounded-[var(--radius-sm)] bg-negative-soft px-3 py-2 text-center text-body font-semibold text-negative-text">
        {friendlyError(resolved.errors[0], currency)}
      </p>
    );
  }

  const assigned = resolved.splits.reduce((sum, split) => sum + split.amount, 0n);
  const included = resolved.splits.filter((s) => s.included).length;

  if (mode === "PERCENT") {
    const percent = local.reduce((sum, entry) => sum + (entry.percent ?? 0), 0);
    return (
      <p className="text-center text-body font-semibold text-positive-text">
        {Math.round(percent * 10) / 10}% assigned across {included}{" "}
        {included === 1 ? "person" : "people"}
      </p>
    );
  }

  return (
    <p className="text-center text-body font-semibold text-muted">
      <span className="tabular text-text">
        {currencySymbol(currency)}
        {toDecimalString(assigned, currency)}
      </span>{" "}
      of{" "}
      <span className="tabular text-text">
        {currencySymbol(currency)}
        {toDecimalString(total, currency)}
      </span>{" "}
      · {included} {included === 1 ? "person" : "people"}
    </p>
  );
}

/**
 * The split engine reports gaps in raw minor units, since it has no formatter.
 * Rewrite those into the user's currency before showing them.
 */
function friendlyError(message: string, currency: string): string {
  return message.replace(/\b(\d+)\b/g, (match) => {
    const value = BigInt(match);
    // Percentages and people counts are small; amounts are in minor units.
    if (message.includes("%")) return match;
    return `${currencySymbol(currency)}${toDecimalString(value, currency)}`;
  });
}

// ---------------------------------------------------------------------------
// Itemised
// ---------------------------------------------------------------------------

interface ReceiptItem {
  id: string;
  name: string;
  amount: bigint | null;
  participantIds: string[];
}

/**
 * Receipt-level splitting.
 *
 * Whatever the items do not cover - tax, tip, service - is shared in proportion
 * to what each person ordered, which is how a tip actually works: the person
 * who had the lobster pays more of it than the person who had tap water.
 */
function ItemEditor({
  items,
  setItems,
  members,
  meId,
  currency,
  total,
}: {
  items: ReceiptItem[];
  setItems: React.Dispatch<React.SetStateAction<ReceiptItem[]>>;
  members: PersonDto[];
  meId: string;
  currency: string;
  total: bigint;
}) {
  const itemised = items.reduce((sum, item) => sum + (item.amount ?? 0n), 0n);
  const extras = total - itemised;

  const addItem = () => {
    haptic();
    setItems((current) => [
      ...current,
      {
        id: `item_${Date.now()}_${current.length}`,
        name: "",
        amount: null,
        // Default to everyone: the common line is one the table shared.
        participantIds: members.map((m) => m.id),
      },
    ]);
  };

  return (
    <div className="mt-4">
      <ul className="space-y-2.5">
        {items.map((item, index) => (
          <li key={item.id} className="rounded-[var(--radius-md)] border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <input
                value={item.name}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  )
                }
                placeholder={`Item ${index + 1}`}
                className="min-w-0 flex-1 bg-transparent text-input font-semibold text-text outline-none placeholder:text-subtle/70"
              />
              <CompactAmountInput
                value={item.amount ?? 0n}
                currency={currency}
                onChange={(amount) =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id ? { ...entry, amount } : entry,
                    ),
                  )
                }
                label={item.name.trim() ? `Price of ${item.name.trim()}` : `Price of item ${index + 1}`}
                className="w-[72px]"
              />
              <button
                onClick={() => {
                  haptic();
                  setItems((current) => current.filter((entry) => entry.id !== item.id));
                }}
                aria-label="Remove item"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-negative-soft hover:text-negative"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {members.map((member) => {
                const active = item.participantIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      haptic();
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                participantIds: active
                                  ? entry.participantIds.filter((id) => id !== member.id)
                                  : [...entry.participantIds, member.id],
                              }
                            : entry,
                        ),
                      );
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-caption font-semibold transition active:scale-95",
                      active
                        ? "border-brand/40 bg-brand-soft text-brand-soft-text"
                        : "border-line bg-surface-2 text-subtle",
                    )}
                  >
                    <Avatar person={member} size="xs" className={active ? "" : "opacity-50"} />
                    {member.id === meId ? "You" : member.displayName.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={addItem}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-line-strong py-3 text-body-lg font-semibold text-muted transition active:scale-[0.98] hover:bg-surface-2"
      >
        <Plus className="size-4" />
        Add an item
      </button>

      {items.length > 0 ? (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-center text-caption font-semibold text-muted">
          {extras > 0n ? (
            <>
              <span className="tabular text-text">
                {currencySymbol(currency)}
                {toDecimalString(extras, currency)}
              </span>{" "}
              of tax and tip shared in proportion to what each person ordered
            </>
          ) : extras < 0n ? (
            <span className="text-negative-text">
              Items exceed the total by {currencySymbol(currency)}
              {toDecimalString(-extras, currency)}
            </span>
          ) : (
            "Items account for the whole bill"
          )}
        </p>
      ) : null}
    </div>
  );
}
