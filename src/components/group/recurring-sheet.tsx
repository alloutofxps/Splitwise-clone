"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pause, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { AmountInput } from "../ui/money";
import { Button, EmptyState, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useRecurrences, keys } from "@/lib/client/queries";
import { api, ApiError } from "@/lib/client/api";
import { apportion } from "@/lib/split";
import { formatMoney } from "@/lib/money";
import { suggestCategory, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { RECURRENCE_FREQUENCIES, type GroupDetailDto, type RecurrenceFrequency } from "@/lib/types";
import { useResetOnOpen } from "../ui/use-reset-on-open";

/**
 * Repeating expenses.
 *
 * Rent, the wifi bill, the shared Netflix. These post themselves, dated
 * correctly, whether or not anyone remembers - the server catches up on every
 * app open, so a month nobody opened the app still produces that month's rent
 * on the 1st rather than on the day somebody noticed.
 *
 * The split is frozen at creation. If someone moves out, the recurrence keeps
 * posting the old split until a human changes it, which is the safe direction:
 * quietly re-splitting somebody's rent behind their back would be worse than
 * making them edit it.
 */
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Every month",
  QUARTERLY: "Every 3 months",
  YEARLY: "Every year",
};

export function RecurringSheet({
  open,
  onClose,
  group,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetailDto;
  meId: string;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const { data: recurrences, isLoading } = useRecurrences(group.id);

  const [creating, setCreating] = React.useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: keys.recurrences });

  const toggle = async (id: string, active: boolean) => {
    haptic();
    try {
      await api.patch(`/api/recurrences/${id}`, { active });
      await refresh();
    } catch {
      toast({ tone: "error", title: "Could not update that" });
    }
  };

  const remove = async (id: string) => {
    haptic();
    try {
      await api.del(`/api/recurrences/${id}`);
      await refresh();
      toast({
        tone: "success",
        title: "Stopped repeating",
        description: "Expenses it already posted are unchanged.",
      });
    } catch {
      toast({ tone: "error", title: "Could not stop that" });
    }
  };

  return (
    <>
      <Sheet
        open={open && !creating}
        onClose={onClose}
        tall
        title="Repeating expenses"
        footer={
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => setCreating(true)}
            icon={<Plus className="size-[18px]" strokeWidth={2.6} />}
          >
            New repeating expense
          </Button>
        }
      >
        <div className="px-5 pb-6">
          {isLoading ? null : !recurrences || recurrences.length === 0 ? (
            <EmptyState
              icon={<Repeat className="size-6" />}
              title="Nothing repeats yet"
              description="Set up the rent or a monthly bill once and it posts itself from then on."
            />
          ) : (
            <ul className="space-y-2">
              {recurrences.map((recurrence) => (
                <li
                  key={recurrence.id}
                  className={cn(
                    "rounded-[var(--radius-lg)] border border-line bg-surface p-3.5",
                    !recurrence.active && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand-soft text-brand-soft-text">
                      <Repeat className="size-[17px]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-lg font-semibold text-text">
                        {recurrence.description}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-caption text-muted">
                        <span className="tabular font-semibold">
                          {formatMoney(BigInt(recurrence.amount), recurrence.currency)}
                        </span>
                        <span>·</span>
                        <span>{FREQUENCY_LABELS[recurrence.frequency]}</span>
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-tiny text-subtle">
                        <CalendarClock className="size-3" />
                        {recurrence.active
                          ? `Next on ${new Date(recurrence.nextRunAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                          : "Paused"}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => void toggle(recurrence.id, !recurrence.active)}
                        aria-label={recurrence.active ? "Pause" : "Resume"}
                        className="flex size-8 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-surface-2"
                      >
                        {recurrence.active ? (
                          <Pause className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </button>
                      <button
                        onClick={() => void remove(recurrence.id)}
                        aria-label="Stop repeating"
                        className="flex size-8 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-negative-soft hover:text-negative"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      <NewRecurrenceSheet
        open={creating}
        onClose={() => setCreating(false)}
        group={group}
        meId={meId}
        onCreated={() => void refresh()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function NewRecurrenceSheet({
  open,
  onClose,
  group,
  meId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetailDto;
  meId: string;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState<bigint | null>(null);
  const [frequency, setFrequency] = React.useState<RecurrenceFrequency>("MONTHLY");
  const [payerId, setPayerId] = React.useState(meId);
  const [startDate, setStartDate] = React.useState(() => nextFirstOfMonth());
  const [saving, setSaving] = React.useState(false);

  useResetOnOpen(open, () => {
    setDescription("");
    setAmount(null);
    setFrequency("MONTHLY");
    setPayerId(meId);
    setStartDate(nextFirstOfMonth());
  });

  const memberIds = group.members.map((member) => member.id);
  const shares = amount ? apportion(amount, memberIds.map(() => 1), memberIds.map((id) => (id === payerId ? 0 : 1))) : [];

  const submit = async () => {
    if (!description.trim() || !amount || amount <= 0n) return;
    setSaving(true);
    try {
      await api.post("/api/recurrences", {
        groupId: group.id,
        description: description.trim(),
        amount: amount.toString(),
        currency: group.currency,
        categoryId: suggestCategory(description)?.id ?? DEFAULT_CATEGORY_ID,
        splitMode: "EQUAL",
        payers: [{ personId: payerId, amount: amount.toString() }],
        splits: memberIds.map((personId, index) => ({
          personId,
          amount: shares[index].toString(),
          included: true,
        })),
        frequency,
        interval: 1,
        startDate: startDate.toISOString(),
      });
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Set to repeat" });
      onCreated();
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not set that up",
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="New repeating expense"
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          disabled={!description.trim() || !amount || amount <= 0n}
          onClick={() => void submit()}
        >
          Start repeating
        </Button>
      }
    >
      <div className="px-5 pb-6">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 140))}
          placeholder="Rent"
          autoFocus
          className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input font-semibold text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
        />

        <div className="mt-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-5">
          <AmountInput
            value={amount}
            onChange={setAmount}
            currency={group.currency}
            size="hero"
          />
        </div>

        <p className="mb-2 mt-5 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
          How often
        </p>
        <div className="flex flex-wrap gap-2">
          {RECURRENCE_FREQUENCIES.map((option) => (
            <button
              key={option}
              onClick={() => {
                haptic();
                setFrequency(option);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-body font-semibold transition active:scale-95",
                frequency === option
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted",
              )}
            >
              {FREQUENCY_LABELS[option]}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="mb-1.5 block text-caption font-bold uppercase tracking-[0.06em] text-subtle">
            Starting
          </span>
          <input
            type="date"
            value={toDateInput(startDate)}
            onChange={(event) => {
              if (event.target.value) {
                const [year, month, day] = event.target.value.split("-").map(Number);
                setStartDate(new Date(year, month - 1, day, 12));
              }
            }}
            className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
          />
        </label>

        <p className="mb-2 mt-5 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
          Paid by
        </p>
        <div className="flex flex-wrap gap-2">
          {group.members.map((member) => (
            <button
              key={member.id}
              onClick={() => {
                haptic();
                setPayerId(member.id);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-body font-semibold transition active:scale-95",
                payerId === member.id
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-muted",
              )}
            >
              {member.id === meId ? "You" : member.displayName.split(" ")[0]}
            </button>
          ))}
        </div>

        <p className="mt-5 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-3 text-caption leading-relaxed text-muted">
          Splits equally between all {group.members.length} members, and keeps
          that split even if the group changes. Edit or stop it any time — past
          expenses it created stay put.
        </p>
      </div>
    </Sheet>
  );
}

function nextFirstOfMonth(): Date {
  const now = new Date();
  // Default to the 1st of next month, which is when rent and bills land.
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
}

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
