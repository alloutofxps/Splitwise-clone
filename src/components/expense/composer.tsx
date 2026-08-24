"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Camera, ChevronDown, NotebookPen, Users } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { AmountPad } from "../ui/numpad";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { SplitEditor } from "./split-editor";
import { CategoryPicker } from "./category-picker";
import { PayerPicker } from "./payer-picker";
import { CurrencyPicker } from "./currency-picker";
import { ReceiptPicker } from "./receipt-picker";
import type { PendingAttachment } from "@/lib/client/attachments";
import { CategoryGlyph } from "./category-glyph";
import { useDashboard, useCreateExpense, useUpdateExpense } from "@/lib/client/queries";
import { convert, toDecimalString } from "@/lib/money";
import { resolveSplit, type SplitMode, type SplitParticipant } from "@/lib/split";
import { suggestCategory, DEFAULT_CATEGORY_ID, categoryById } from "@/lib/categories";
import { ApiError } from "@/lib/client/api";
import { newId } from "@/lib/ids";
import type { ExpenseDto, PersonDto } from "@/lib/types";
import { useResetOnOpen } from "../ui/use-reset-on-open";

/**
 * The expense composer.
 *
 * This screen is the app. Everything else is reporting on what happens here, so
 * it is built around one rule: **the common case must take three taps and no
 * thought.** Open it, type a number, save. Description, split, payer, category
 * and date all have defaults good enough to skip, and every one of them is one
 * tap away when the default is wrong.
 *
 * The split preview under the amount updates live, so nobody has to save an
 * expense to find out what it did to the balances.
 */

export interface ComposerProps {
  open: boolean;
  onClose: () => void;
  /** Preselects a group. */
  groupId?: string;
  /** Editing an existing expense rather than creating one. */
  expense?: ExpenseDto;
  /**
   * Receipts the composer should open with, from the OS share sheet.
   *
   * Applied to a new expense only. Sharing a photo into an *edit* would be an
   * odd thing to have meant, and silently attaching it to whichever expense
   * happened to be open would be worse than ignoring it.
   */
  initialAttachments?: PendingAttachment[];
  /** A description to start from, e.g. the text that came with a share. */
  initialDescription?: string;
}

interface Draft {
  description: string;
  amount: bigint | null;
  currency: string;
  groupId: string | null;
  friendId: string | null;
  categoryId: string;
  date: Date;
  notes: string;
  splitMode: SplitMode;
  payers: { personId: string; amount: bigint }[];
  participants: SplitParticipant[];
  attachments: PendingAttachment[];
  exchangeRate: string;
}

export function ExpenseComposer({
  open,
  onClose,
  groupId,
  expense,
  initialAttachments,
  initialDescription,
}: ComposerProps) {
  const { data } = useDashboard();
  const toast = useToast();
  // `data?.me` is undefined on the very first render, before the dashboard has
  // loaded. The hook falls back to a pessimistic write in that case, which is
  // correct: the composer cannot be opened until the dashboard is in hand.
  const create = useCreateExpense(data?.me?.id);
  const update = useUpdateExpense(expense?.id ?? "", expense?.groupId);

  const [panel, setPanel] = React.useState<
    null | "split" | "payer" | "category" | "currency" | "notes" | "receipt"
  >(null);

  const me = data?.me;
  const peopleById = React.useMemo(
    () => new Map((data?.people ?? []).map((person) => [person.id, person])),
    [data?.people],
  );

  const [draft, setDraft] = React.useState<Draft | null>(null);

  // Rebuild the draft when the sheet opens, so a cancelled entry never leaks
  // into the next one.
  //
  // Gated on the dashboard being loaded as well as on `open`, because the draft
  // is built from it - reopening before it arrives would otherwise leave the
  // previous draft on screen.
  //
  // This was an effect with `data` in its dependency list, which had a worse
  // failure than the stale frame: `useDashboard` refetches on window focus, so
  // returning to a backgrounded phone rebuilt the draft and wiped whatever was
  // half-typed into it. Keying on the open transition instead means the draft
  // is built once, when it should be.
  useResetOnOpen(open && Boolean(me && data), () => {
    if (!me || !data) return;
    if (expense) {
      setDraft(draftFromExpense(expense));
      setPanel(null);
      return;
    }

    const draft = freshDraft(me.id, groupId ?? null, me.defaultCurrency, data);
    setDraft({
      ...draft,
      description: initialDescription?.trim() || draft.description,
      attachments: initialAttachments ?? draft.attachments,
    });
    // Open straight onto the receipts if that is what was shared, so the person
    // can see the photo actually arrived rather than having to go looking.
    setPanel(initialAttachments && initialAttachments.length > 0 ? "receipt" : null);
  });

  if (!data || !me || !draft) {
    return <Sheet open={open} onClose={onClose} title="Add an expense" tall />;
  }

  const group = draft.groupId ? data.groups.find((g) => g.id === draft.groupId) : undefined;

  const members: PersonDto[] = group
    ? group.members
    : draft.friendId
      ? [me, peopleById.get(draft.friendId)].filter(Boolean as unknown as (p: PersonDto | undefined) => p is PersonDto)
      : [me];

  const amount = draft.amount ?? 0n;

  // Live split resolution. Recomputed on every keystroke, which is cheap and is
  // what makes the preview trustworthy.
  const split = resolveSplit({
    mode: draft.splitMode,
    total: amount,
    participants: draft.participants,
    payerIds: draft.payers.map((p) => p.personId),
  });

  const payersTotal = draft.payers.reduce((total, p) => total + p.amount, 0n);
  const payerMismatch = amount > 0n && payersTotal !== amount;

  const blockers: string[] = [];
  if (!draft.description.trim()) blockers.push("Add a description");
  if (amount <= 0n) blockers.push("Enter an amount");
  if (payerMismatch) blockers.push("Payments must add up to the total");
  blockers.push(...split.errors);

  const canSave = blockers.length === 0;
  const saving = create.isPending || update.isPending;

  /**
   * Applies a change, keeping a lone payer's amount equal to the total.
   *
   * With one payer there is nothing to decide - they paid all of it - so
   * carrying a separate figure only creates a way for the two to disagree.
   * They used to: the amount was typed here and the payer's share stayed at
   * zero, so "Payments must add up to the total" blocked every expense entered
   * through the default path until the user opened the payer sheet and typed
   * the same number again.
   *
   * Several payers is a genuine choice, and the mismatch warning is doing real
   * work there, so those are left exactly as entered.
   */
  const patch = (changes: Partial<Draft>) =>
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...changes };
      const payers = changes.payers ?? next.payers;
      if (payers.length === 1) {
        const total = next.amount ?? 0n;
        if (payers[0].amount !== total) {
          next.payers = [{ ...payers[0], amount: total }];
        }
      }
      return next;
    });

  const save = async () => {
    if (!canSave || saving) return;

    const payload = {
      id: expense?.id ?? newId("exp"),
      groupId: draft.groupId,
      friendId: draft.friendId,
      description: draft.description.trim(),
      notes: draft.notes.trim() || null,
      amount: amount.toString(),
      currency: draft.currency,
      exchangeRate: draft.exchangeRate,
      splitMode: draft.splitMode,
      categoryId: draft.categoryId,
      date: draft.date.toISOString(),
      payers: draft.payers.map((p) => ({
        personId: p.personId,
        amount: p.amount.toString(),
      })),
      splits: split.splits.map((s) => ({
        personId: s.personId,
        amount: s.amount.toString(),
        included: s.included,
        weight: s.weight ?? null,
        percent: s.percent ?? null,
        adjustment: s.adjustment?.toString() ?? null,
      })),
      attachments: draft.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        dataUrl: attachment.dataUrl,
      })),
    };

    try {
      if (expense) {
        await update.mutateAsync(payload);
        toast({ tone: "success", title: "Expense updated" });
      } else {
        const result = await create.mutateAsync(payload);
        toast(
          result === null
            ? {
                tone: "offline",
                title: "Saved on your device",
                description: "It will sync as soon as you are back online.",
              }
            : { tone: "success", title: `${draft.description.trim()} added` },
        );
      }
      haptic([8, 30, 8]);
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not save",
        description:
          error instanceof ApiError ? error.message : "Something went wrong. Try again.",
      });
    }
  };

  const category = categoryById(draft.categoryId);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        tall
        title={expense ? "Edit expense" : "Add an expense"}
        footer={
          <div>
            <AnimatePresence>
              {blockers.length > 0 && (draft.description || amount > 0n) ? (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2 text-center text-[12px] font-semibold text-negative-text"
                >
                  {blockers[0]}
                </motion.p>
              ) : null}
            </AnimatePresence>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canSave}
              loading={saving}
              onClick={() => void save()}
            >
              {expense ? "Save changes" : "Add expense"}
            </Button>
          </div>
        }
      >
        <div className="px-5 pb-6">
          {/* Where it goes ------------------------------------------------- */}
          <ScopePicker
            draft={draft}
            data={data}
            onChange={(changes) => patch(changes)}
            // An existing expense cannot change hands. The server's
            // `updateExpense` does not write `groupId`, so the picker used to
            // accept the change, report success, and leave the expense exactly
            // where it was. Moving one properly is not a small fix - the
            // destination group has different members, so every split would
            // have to be re-derived against people who may not be in it - so
            // the control stops claiming it rather than half-doing it.
            locked={Boolean(expense)}
          />

          {/* Amount --------------------------------------------------------- */}
          <div className="mt-5 flex flex-col items-center rounded-[--radius-lg] bg-surface-2 px-4 py-6">
            <button
              onClick={() => setPanel("currency")}
              className="mb-2 flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[12px] font-bold text-muted transition active:scale-95"
            >
              {draft.currency}
              <ChevronDown className="size-3" />
            </button>

            <AmountPad
              value={draft.amount}
              onChange={(value) => patch({ amount: value })}
              currency={draft.currency}
              onSubmit={() => void save()}
              className="w-full"
            />

            {group && group.currency !== draft.currency ? (
              <ConversionNote
                amount={amount}
                from={draft.currency}
                to={group.currency}
                rate={draft.exchangeRate}
                onRateChange={(rate) => patch({ exchangeRate: rate })}
              />
            ) : null}
          </div>

          {/* Description ---------------------------------------------------- */}
          <div className="mt-4 flex items-center gap-3 rounded-[--radius-lg] border border-line bg-surface px-3.5 py-3">
            <button
              onClick={() => setPanel("category")}
              aria-label={`Category: ${category.name}`}
              className="flex size-10 shrink-0 items-center justify-center rounded-[--radius-md] transition active:scale-90"
              style={{
                background: `color-mix(in oklch, var(--avatar-${category.color}) 16%, transparent)`,
                color: `var(--avatar-${category.color})`,
              }}
            >
              <CategoryGlyph name={category.icon} />
            </button>

            <input
              value={draft.description}
              onChange={(event) => {
                const description = event.target.value.slice(0, 140);
                // Only auto-assign while the user has not chosen a category
                // themselves - overriding a deliberate choice is infuriating.
                const suggestion =
                  draft.categoryId === DEFAULT_CATEGORY_ID ? suggestCategory(description) : null;
                patch({
                  description,
                  ...(suggestion ? { categoryId: suggestion.id } : {}),
                });
              }}
              placeholder="What was it for?"
              enterKeyHint="done"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-medium text-text outline-none placeholder:text-subtle/70"
            />
          </div>

          {/* Who paid / how it splits --------------------------------------- */}
          <div className="mt-4 space-y-2">
            <Row
              label="Paid by"
              value={payerLabel(draft.payers, peopleById, me.id)}
              onClick={() => setPanel("payer")}
              warning={payerMismatch}
              icon={
                draft.payers.length === 1 && peopleById.get(draft.payers[0].personId) ? (
                  <Avatar person={peopleById.get(draft.payers[0].personId)!} size="xs" />
                ) : (
                  <Users className="size-4 text-subtle" />
                )
              }
            />
            <Row
              label="Split"
              value={splitLabel(draft.splitMode, split.splits.filter((s) => s.included).length)}
              onClick={() => setPanel("split")}
              warning={split.errors.length > 0}
            />
          </div>

          {/* Live preview ---------------------------------------------------- */}
          {amount > 0n && split.errors.length === 0 ? (
            <SplitPreview
              splits={split.splits}
              peopleById={peopleById}
              currency={draft.currency}
              meId={me.id}
              payers={draft.payers}
            />
          ) : null}

          {/* Extras ---------------------------------------------------------- */}
          <div className="mt-5 flex flex-wrap gap-2">
            <Chip
              icon={<CalendarDays className="size-3.5" />}
              active={!isToday(draft.date)}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "date";
                input.value = toDateInput(draft.date);
                input.onchange = () => {
                  if (input.value) patch({ date: fromDateInput(input.value) });
                };
                input.showPicker?.();
                input.click();
              }}
            >
              {formatDateChip(draft.date)}
            </Chip>

            <Chip
              icon={<Camera className="size-3.5" />}
              active={draft.attachments.length > 0}
              onClick={() => setPanel("receipt")}
            >
              {draft.attachments.length > 0
                ? `${draft.attachments.length} receipt${draft.attachments.length === 1 ? "" : "s"}`
                : "Receipt"}
            </Chip>

            <Chip
              icon={<NotebookPen className="size-3.5" />}
              active={draft.notes.length > 0}
              onClick={() => setPanel("notes")}
            >
              {draft.notes ? "Note added" : "Note"}
            </Chip>
          </div>
        </div>
      </Sheet>

      {/* Sub-sheets ------------------------------------------------------- */}
      <SplitEditor
        open={panel === "split"}
        onClose={() => setPanel(null)}
        members={members}
        meId={me.id}
        currency={draft.currency}
        total={amount}
        mode={draft.splitMode}
        participants={draft.participants}
        payerIds={draft.payers.map((p) => p.personId)}
        onChange={(mode, participants) => patch({ splitMode: mode, participants })}
      />

      <PayerPicker
        open={panel === "payer"}
        onClose={() => setPanel(null)}
        members={members}
        meId={me.id}
        currency={draft.currency}
        total={amount}
        payers={draft.payers}
        onChange={(payers) => patch({ payers })}
      />

      <CategoryPicker
        open={panel === "category"}
        onClose={() => setPanel(null)}
        value={draft.categoryId}
        onChange={(categoryId) => {
          patch({ categoryId });
          setPanel(null);
        }}
      />

      <CurrencyPicker
        open={panel === "currency"}
        onClose={() => setPanel(null)}
        value={draft.currency}
        onChange={(currency) => {
          patch({ currency, exchangeRate: "1" });
          setPanel(null);
        }}
      />

      <ReceiptPicker
        open={panel === "receipt"}
        onClose={() => setPanel(null)}
        attachments={draft.attachments}
        onChange={(attachments) => patch({ attachments })}
      />

      <Sheet open={panel === "notes"} onClose={() => setPanel(null)} title="Note">
        <div className="px-5 pb-6">
          <textarea
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value.slice(0, 2000) })}
            rows={5}
            autoFocus
            placeholder="Anything worth remembering about this expense…"
            className="w-full resize-none rounded-[--radius-md] border border-line bg-surface p-3.5 text-[15px] leading-relaxed text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[--brand-ring]"
          />
          <Button
            variant="primary"
            fullWidth
            className="mt-4"
            onClick={() => setPanel(null)}
          >
            Done
          </Button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Draft construction
// ---------------------------------------------------------------------------

function freshDraft(
  meId: string,
  groupId: string | null,
  currency: string,
  data: { groups: { id: string; currency: string; members: PersonDto[] }[] },
): Draft {
  const group = groupId ? data.groups.find((g) => g.id === groupId) : undefined;
  const members = group?.members ?? [];

  return {
    description: "",
    amount: null,
    // A group's own currency is a better default than the user's, because
    // that is what the trip is being tracked in.
    currency: group?.currency ?? currency,
    groupId: group?.id ?? null,
    friendId: null,
    categoryId: DEFAULT_CATEGORY_ID,
    date: new Date(),
    notes: "",
    splitMode: "EQUAL",
    // Whoever is adding the expense almost always paid for it.
    payers: [{ personId: meId, amount: 0n }],
    participants: (members.length > 0 ? members.map((m) => m.id) : [meId]).map((personId) => ({
      personId,
      included: true,
    })),
    attachments: [],
    exchangeRate: "1",
  };
}

function draftFromExpense(expense: ExpenseDto): Draft {
  return {
    description: expense.description,
    amount: BigInt(expense.amount),
    currency: expense.currency,
    groupId: expense.groupId,
    friendId: null,
    categoryId: expense.categoryId,
    date: new Date(expense.date),
    notes: expense.notes ?? "",
    splitMode: expense.splitMode,
    payers: expense.payers.map((p) => ({ personId: p.personId, amount: BigInt(p.amount) })),
    participants: expense.splits.map((s) => ({
      personId: s.personId,
      included: s.included,
      amount: BigInt(s.amount),
      weight: s.weight ?? undefined,
      percent: s.percent ?? undefined,
      adjustment: s.adjustment ? BigInt(s.adjustment) : undefined,
    })),
    attachments: [],
    exchangeRate: expense.exchangeRate,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScopePicker({
  draft,
  data,
  onChange,
  locked,
}: {
  draft: Draft;
  data: { groups: { id: string; name: string; emoji: string; currency: string; members: PersonDto[] }[]; friends: { person: PersonDto }[]; me: PersonDto };
  onChange: (changes: Partial<Draft>) => void;
  /** Editing: the scope is fixed and shown as a label rather than a control. */
  locked?: boolean;
}) {
  const options = [
    ...data.groups.map((group) => ({
      key: `group:${group.id}`,
      label: `${group.emoji} ${group.name}`,
      apply: (): Partial<Draft> => ({
        groupId: group.id,
        friendId: null,
        currency: group.currency,
        exchangeRate: "1",
        participants: group.members.map((m) => ({ personId: m.id, included: true })),
      }),
    })),
    ...data.friends.map((friend) => ({
      key: `friend:${friend.person.id}`,
      label: friend.person.displayName,
      apply: (): Partial<Draft> => ({
        groupId: null,
        friendId: friend.person.id,
        participants: [
          { personId: data.me.id, included: true },
          { personId: friend.person.id, included: true },
        ],
      }),
    })),
  ];

  const current = draft.groupId
    ? `group:${draft.groupId}`
    : draft.friendId
      ? `friend:${draft.friendId}`
      : "";

  if (options.length === 0) return null;

  if (locked) {
    const label = options.find((option) => option.key === current)?.label;
    if (!label) return null;
    return (
      <div className="flex items-center gap-2 rounded-[--radius-md] bg-surface-2 px-3 py-2.5">
        <span className="shrink-0 text-[13px] font-semibold text-muted">With</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">
          {label}
        </span>
        <span className="shrink-0 text-[12px] text-subtle">Can&rsquo;t be moved</span>
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 rounded-[--radius-md] bg-surface-2 px-3 py-2.5">
      <span className="shrink-0 text-[13px] font-semibold text-muted">With</span>
      <select
        value={current}
        onChange={(event) => {
          const option = options.find((o) => o.key === event.target.value);
          if (option) onChange(option.apply());
        }}
        className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-text outline-none"
      >
        {current === "" ? <option value="">Choose a group or friend…</option> : null}
        {data.groups.length > 0 ? (
          <optgroup label="Groups">
            {options
              .filter((o) => o.key.startsWith("group:"))
              .map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ) : null}
        {data.friends.length > 0 ? (
          <optgroup label="Friends">
            {options
              .filter((o) => o.key.startsWith("friend:"))
              .map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

function Row({
  label,
  value,
  onClick,
  icon,
  warning,
}: {
  label: string;
  value: string;
  onClick: () => void;
  icon?: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-[--radius-md] border bg-surface px-3.5 py-3 text-left transition active:scale-[0.985]",
        warning ? "border-negative/50 bg-negative-soft/40" : "border-line",
      )}
    >
      <span className="shrink-0 text-[13px] font-semibold text-muted">{label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {icon}
        <span
          className={cn(
            "truncate text-[14px] font-semibold",
            warning ? "text-negative-text" : "text-text",
          )}
        >
          {value}
        </span>
        <ChevronDown className="size-4 shrink-0 -rotate-90 text-subtle" />
      </span>
    </button>
  );
}

function Chip({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition active:scale-95",
        active
          ? "border-brand/40 bg-brand-soft text-brand-soft-text"
          : "border-line bg-surface text-muted hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * The running total of who owes what, under the amount.
 *
 * The whole point of showing it here is that a split mistake is obvious *before*
 * saving, rather than being discovered by whoever checks the balances later.
 */
function SplitPreview({
  splits,
  peopleById,
  currency,
  meId,
  payers,
}: {
  splits: { personId: string; amount: bigint; included: boolean }[];
  peopleById: Map<string, PersonDto>;
  currency: string;
  meId: string;
  payers: { personId: string; amount: bigint }[];
}) {
  const included = splits.filter((s) => s.included);
  if (included.length === 0) return null;

  const paidBy = new Map(payers.map((p) => [p.personId, p.amount]));

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="mt-4 overflow-hidden"
    >
      <div className="rounded-[--radius-lg] bg-surface-2 p-3.5">
        <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-subtle">
          Who owes what
        </p>
        <ul className="space-y-2">
          {included.map((split) => {
            const person = peopleById.get(split.personId);
            if (!person) return null;
            const net = (paidBy.get(split.personId) ?? 0n) - split.amount;

            return (
              <li key={split.personId} className="flex items-center gap-2.5">
                <Avatar person={person} size="xs" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                  {split.personId === meId ? "You" : person.displayName}
                </span>
                <span className="tabular text-[13px] font-semibold text-muted">
                  {toDecimalString(split.amount, currency)}
                </span>
                {net !== 0n ? (
                  <span
                    className={cn(
                      "tabular w-[68px] shrink-0 text-right text-[12px] font-bold",
                      net > 0n ? "text-positive-text" : "text-negative-text",
                    )}
                  >
                    {net > 0n ? "+" : "−"}
                    {toDecimalString(net > 0n ? net : -net, currency)}
                  </span>
                ) : (
                  <span className="w-[68px] shrink-0 text-right text-[12px] font-semibold text-subtle">
                    even
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </motion.div>
  );
}

/** Manual rate entry, shown when the expense currency differs from the group's. */
function ConversionNote({
  amount,
  from,
  to,
  rate,
  onRateChange,
}: {
  amount: bigint;
  from: string;
  to: string;
  rate: string;
  onRateChange: (rate: string) => void;
}) {
  const [fetching, setFetching] = React.useState(false);

  // Fetch a live rate on first appearance, falling back to manual entry.
  React.useEffect(() => {
    let cancelled = false;
    setFetching(true);
    fetch(`/api/rates?base=${from}&quote=${to}`)
      .then((response) => response.json())
      .then((payload: { rate?: { rate: string } | null }) => {
        if (!cancelled && payload.rate?.rate) onRateChange(payload.rate.rate);
      })
      .catch(() => {
        // Offline: the manual field below is the fallback.
      })
      .finally(() => !cancelled && setFetching(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const converted =
    amount > 0n && rate ? convertPreview(amount, from, to, rate) : null;

  return (
    <div className="mt-3 w-full rounded-[--radius-md] bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-semibold text-muted">
          Group settles in {to}
        </span>
        {fetching ? (
          <span className="text-subtle">finding rate…</span>
        ) : (
          <span className="tabular text-subtle">
            1 {from} ={" "}
            <input
              value={rate}
              onChange={(event) => onRateChange(event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="w-16 bg-transparent text-right font-semibold text-text outline-none"
              aria-label={`Exchange rate from ${from} to ${to}`}
            />{" "}
            {to}
          </span>
        )}
      </div>
      {converted ? (
        <p className="tabular mt-1 text-[13px] font-bold text-text">≈ {converted} {to}</p>
      ) : null}
    </div>
  );
}

/**
 * Reuses the same integer conversion the server will apply, so the preview is
 * the number that actually gets stored rather than an approximation of it.
 */
function convertPreview(amount: bigint, from: string, to: string, rate: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(rate)) return null;
  return toDecimalString(convert(amount, from, to, rate), to);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function payerLabel(
  payers: { personId: string; amount: bigint }[],
  peopleById: Map<string, PersonDto>,
  meId: string,
): string {
  if (payers.length === 0) return "Nobody";
  if (payers.length > 1) return `${payers.length} people`;
  const person = peopleById.get(payers[0].personId);
  if (!person) return "Someone";
  return payers[0].personId === meId ? "You" : person.displayName;
}

function splitLabel(mode: SplitMode, count: number): string {
  switch (mode) {
    case "EQUAL":
      return `Equally · ${count}`;
    case "EXACT":
      return "Exact amounts";
    case "PERCENT":
      return "By percentage";
    case "SHARES":
      return "By shares";
    case "ADJUSTMENT":
      return "Plus extras";
    case "ITEMIZED":
      return "By item";
    default:
      return "Custom";
  }
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDateChip(date: Date): string {
  if (isToday(date)) return "Today";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function fromDateInput(value: string): Date {
  // Parsed as local midnight rather than UTC, so a date picked in Sydney does
  // not land on the previous day.
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}
