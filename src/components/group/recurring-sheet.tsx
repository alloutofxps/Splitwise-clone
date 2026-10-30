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
import { apportion, resolveSplit } from "@/lib/split";
import { startingSplit } from "@/lib/default-split";
import { formatMoney } from "@/lib/money";
import { suggestCategory, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { RECURRENCE_FREQUENCIES, type GroupDetailDto, type RecurrenceFrequency } from "@/lib/types";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { fromDateInput, toDateInput } from "@/lib/date-input";

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
      toast({ tone: "error", title: "Couldn't change that" });
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
        description: "Expenses it already added won't change.",
      });
    } catch {
      toast({ tone: "error", title: "Couldn't stop that" });
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
              description="Add rent or a monthly bill once, and Divvy adds it for you each time."
            />
          ) : (
            <ul className="space-y-2">
              {recurrences.map((recurrence) => (
                <li
                  key={recurrence.id}
                  className={cn(
                    "rounded-[var(--radius-lg)] border border-[var(--card-border)] bg-surface p-3.5",
                    !recurrence.active && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand-soft text-brand-soft-text">
                      <Repeat className="size-[17px]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="truncate text-left text-body-lg font-semibold text-text">
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
                      {!recurrence.active && recurrence.lastError ? (
                        // Why it stopped - somebody left, the currency changed -
                        // so the fix is obvious instead of the rent just vanishing.
                        <p className="mt-1 text-tiny font-semibold text-danger">
                          {recurrence.lastError}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => void toggle(recurrence.id, !recurrence.active)}
                        aria-label={recurrence.active ? "Pause" : "Resume"}
                        className="flex size-8 items-center justify-center rounded-full text-subtle transition active:opacity-70 hover:bg-surface-2"
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
                        className="flex size-8 items-center justify-center rounded-full text-subtle transition active:opacity-70 hover:bg-danger-soft hover:text-danger"
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
  // The group's usual split if it has one, otherwise equal between everyone.
  const usual = startingSplit(group.defaultSplit, memberIds);
  const useUsual = Boolean(usual && !usual.stale);
  const usualSplit =
    useUsual && usual && amount
      ? resolveSplit({ mode: usual.mode, total: amount, participants: usual.participants, payerIds: [payerId] })
      : null;
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
        splitMode: usualSplit && usual ? usual.mode : "EQUAL",
        payers: [{ personId: payerId, amount: amount.toString() }],
        splits:
          usualSplit && usualSplit.errors.length === 0
            ? usualSplit.splits.map((s) => ({
                personId: s.personId,
                amount: s.amount.toString(),
                included: s.included,
                weight: s.weight ?? null,
                percent: s.percent ?? null,
              }))
            : memberIds.map((personId, index) => ({
                personId,
                amount: shares[index].toString(),
                included: true,
              })),
        frequency,
        interval: 1,
        startDate: startDate.toISOString(),
        // So "the 1st" is worked out on this person's calendar, not the server's.
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      haptic([8, 30, 8]);
      toast({ tone: "success", title: "Set to repeat" });
      onCreated();
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't set that up",
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
          dir="auto"
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 140))}
          placeholder="Rent"
          autoFocus
          className="h-12 w-full rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-3.5 text-input font-semibold text-text outline-none transition placeholder:text-subtle focus:ring-[1.5px] focus:ring-text"
        />

        <div className="mt-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-5">
          <AmountInput
            value={amount}
            onChange={setAmount}
            currency={group.currency}
            size="hero"
          />
        </div>

        <p className="mb-2 mt-5 text-caption font-medium text-subtle">
          How often
        </p>
        <div className="flex flex-wrap gap-2">
          {RECURRENCE_FREQUENCIES.map((option) => (
            <button
              key={option}
              aria-pressed={frequency === option}
              onClick={() => {
                haptic();
                setFrequency(option);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-body font-semibold transition active:opacity-70",
                frequency === option
                  ? "border-text bg-text text-inverse"
                  : "border-line bg-surface text-text hover:bg-surface-2",
              )}
            >
              {FREQUENCY_LABELS[option]}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="mb-1.5 block text-caption font-medium text-subtle">
            Starting
          </span>
          <input
            type="date"
            value={toDateInput(startDate)}
            onChange={(event) => {
              if (event.target.value) setStartDate(fromDateInput(event.target.value));
            }}
            className="h-12 w-full rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-3.5 text-input text-text outline-none focus:ring-[1.5px] focus:ring-text"
          />
        </label>

        <p className="mb-2 mt-5 text-caption font-medium text-subtle">
          Paid by
        </p>
        <div className="flex flex-wrap gap-2">
          {group.members.map((member) => (
            <button
              key={member.id}
              aria-pressed={payerId === member.id}
              onClick={() => {
                haptic();
                setPayerId(member.id);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-body font-semibold transition active:opacity-70",
                payerId === member.id
                  ? "border-text bg-text text-inverse"
                  : "border-line bg-surface text-text hover:bg-surface-2",
              )}
            >
              <bdi>{member.id === meId ? "You" : member.displayName.split(" ")[0]}</bdi>
            </button>
          ))}
        </div>

        <p className="mt-5 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-3 text-caption leading-relaxed text-muted">
          {useUsual
            ? "Split the group's usual way, as set in group settings."
            : `Split equally between all ${group.members.length} people.`}{" "}
          The split stays the same even if people join or leave later. You can
          change or stop it any time. Expenses it already added won&rsquo;t change.
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
