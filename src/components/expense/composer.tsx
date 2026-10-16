"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Camera, Check, ChevronDown, NotebookPen, Plus } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { AmountPad } from "../ui/numpad";
import { Avatar } from "../ui/avatar";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { SplitEditor, type ReceiptItem } from "./split-editor";
import { CategoryPicker } from "./category-picker";
import { PayerPicker } from "./payer-picker";
import { CurrencyPicker } from "./currency-picker";
import { ReceiptPicker } from "./receipt-picker";
import type { PendingAttachment } from "@/lib/client/attachments";
import { CategoryGlyph } from "./category-glyph";
import { keys, useDashboard, useCreateExpense, useDeleteExpense, useUpdateExpense } from "@/lib/client/queries";
import { formatMoney } from "@/lib/money";
import { ConversionNote } from "../ui/conversion-note";
import { resolveSplit, type SplitMode, type SplitParticipant } from "@/lib/split";
import { startingSplit, type DefaultSplit } from "@/lib/default-split";
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
  /** A new expense filled in from this one: "Duplicate". Dated today. */
  template?: ExpenseDto;
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
  /** More friends on the same non-group expense, beyond `friendId`. */
  extraFriendIds: string[];
  categoryId: string;
  date: Date;
  notes: string;
  splitMode: SplitMode;
  payers: { personId: string; amount: bigint }[];
  participants: SplitParticipant[];
  /** Receipt lines, for an itemised split. */
  items: ReceiptItem[];
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
  template,
}: ComposerProps) {
  const { data } = useDashboard();
  const toast = useToast();
  // `data?.me` is undefined on the very first render, before the dashboard has
  // loaded. The hook falls back to a pessimistic write in that case, which is
  // correct: the composer cannot be opened until the dashboard is in hand.
  const client = useQueryClient();
  const create = useCreateExpense(data?.me?.id);
  const update = useUpdateExpense(expense?.id ?? "", expense?.groupId);
  const remove = useDeleteExpense();

  const [panel, setPanel] = React.useState<
    null | "split" | "payer" | "category" | "currency" | "notes" | "receipt"
  >(null);

  const me = data?.me;
  const peopleById = React.useMemo(
    () => new Map((data?.people ?? []).map((person) => [person.id, person])),
    [data?.people],
  );

  const [draft, setDraft] = React.useState<Draft | null>(null);
  // Whether the number pad is showing. Typing the description hides it;
  // tapping the amount brings it back.
  const [keypad, setKeypad] = React.useState(true);
  // Item lines read off a receipt photo, offered as a split by item.
  const [foundItems, setFoundItems] = React.useState<{ name: string; amount: bigint }[] | null>(null);

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
    setFoundItems(null);
    setKeypad(!expense);
    if (expense) {
      setDraft(draftFromExpense(expense));
      setPanel(null);
      return;
    }

    if (template) {
      // A copy: same people, amounts and split, as a new expense dated
      // today. Item lines get new ids, since these belong to a new expense.
      const copy = draftFromExpense(template);
      const others = template.groupId
        ? []
        : [...new Set(copy.participants.map((p) => p.personId).filter((id) => id !== me.id))];
      setDraft({
        ...copy,
        date: new Date(),
        friendId: others[0] ?? null,
        extraFriendIds: others.slice(1),
        items: copy.items.map((item, index) => ({ ...item, id: `copy-${index}` })),
      });
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

  // Closed, or closing: nothing here needs rebuilding. A panel on its way out
  // keeps the content it left with, so this skips re-working the whole form
  // each time the data changes under it, which right after a save is several
  // times while the money moment is playing.
  if (!data || !me || !draft || !open) {
    return <Sheet open={open} onClose={onClose} title="Add an expense" tall />;
  }

  const group = draft.groupId ? data.groups.find((g) => g.id === draft.groupId) : undefined;

  // Outside a group, everyone the expense names is a member of it: you, the
  // friends picked for it, and - when editing - whoever is already on it.
  // Deriving this from the friend picker alone left an edited friend expense
  // listing only you, so their share vanished from the split editor.
  const members: PersonDto[] = group
    ? group.members
    : [
        ...new Set([
          me.id,
          ...(draft.friendId ? [draft.friendId] : []),
          ...draft.extraFriendIds,
          ...draft.participants.map((p) => p.personId),
          ...draft.payers.map((p) => p.personId),
        ]),
      ]
        .map((id) => (id === me.id ? me : peopleById.get(id)))
        .filter((p): p is PersonDto => Boolean(p));

  const amount = draft.amount ?? 0n;

  // Live split resolution. Recomputed on every keystroke, which is cheap and is
  // what makes the preview trustworthy.
  const split = resolveSplit({
    mode: draft.splitMode,
    total: amount,
    participants: draft.participants,
    payerIds: draft.payers.map((p) => p.personId),
    items: draft.items.map((item) => ({
      id: item.id,
      amount: item.amount ?? 0n,
      participantIds: item.participantIds,
    })),
  });

  const payersTotal = draft.payers.reduce((total, p) => total + p.amount, 0n);
  const payerMismatch = amount > 0n && payersTotal !== amount;

  const blockers: string[] = [];
  if (!draft.description.trim()) blockers.push("Add a description");
  if (amount <= 0n) blockers.push("Enter an amount");
  if (payerMismatch) blockers.push("What people paid has to add up to the total");
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
      // The version this sheet opened with. The server refuses the save if
      // somebody has replaced it since, rather than quietly overwriting them.
      expectedUpdatedAt: expense?.updatedAt,
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
      // The receipt lines themselves, so an itemised expense can be reopened
      // and shown line by line. Only meaningful in that mode.
      items:
        draft.splitMode === "ITEMIZED"
          ? draft.items
              .filter((item) => (item.amount ?? 0n) > 0n)
              .map((item) => ({
                name: item.name.trim() || "Item",
                amount: (item.amount ?? 0n).toString(),
                participantIds: item.participantIds,
              }))
          : [],
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
                title: "Saved on your phone",
                description: "It'll be sent when you're back online.",
              }
            : {
                tone: "success",
                title: `Added ${draft.description.trim()}`,
                // Undo is a delete of what was just added; the toast for it
                // says so, and the expense can still be brought back from
                // Activity like any other deletion.
                action: {
                  label: "Undo",
                  onClick: () =>
                    remove.mutate(
                      { id: payload.id, groupId: payload.groupId },
                      {
                        onSuccess: () => toast({ tone: "success", title: `Removed ${payload.description}` }),
                        onError: () => toast({ tone: "error", title: "Couldn\u2019t undo that" }),
                      },
                    ),
                },
              },
        );
      }
      haptic([8, 30, 8]);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        // Their copy is the current one, so close rather than leave a stale
        // draft on screen inviting a second attempt at the same overwrite.
        toast({
          tone: "error",
          title: "Someone changed this first",
          description: error.message,
        });
        void client.invalidateQueries({ queryKey: keys.expense(expense?.id ?? "") });
        onClose();
        return;
      }

      toast({
        tone: "error",
        title: "Couldn't save",
        description:
          error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
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
                  className="mb-2 text-center text-caption font-semibold text-negative-text"
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

          {/* Description: what it was for comes first, the way people say it. */}
          <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5">
            <button
              onClick={() => setPanel("category")}
              aria-label={`Category: ${category.name}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-text transition-opacity active:opacity-70"
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
              onFocus={() => setKeypad(false)}
              placeholder="What was it for?"
              enterKeyHint="done"
              className="min-w-0 flex-1 bg-transparent text-input font-medium text-text outline-none placeholder:text-subtle/70"
            />
          </div>

          {/* Amount --------------------------------------------------------- */}
          <div className="mt-4">
            <AmountPad
              value={draft.amount}
              onChange={(value) => patch({ amount: value })}
              currency={draft.currency}
              onSubmit={() => void save()}
              open={keypad}
              onOpenChange={setKeypad}
              leading={
                <button
                  onClick={() => setPanel("currency")}
                  aria-label={`Currency: ${draft.currency}`}
                  className="flex shrink-0 items-center gap-0.5 rounded-full border border-line px-2.5 py-1 text-caption font-medium text-text transition-colors hover:bg-surface-2"
                >
                  {draft.currency}
                  <ChevronDown className="size-3" />
                </button>
              }
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

          {/*
            Who paid and how it divides, as one sentence: "Paid by you · split
            equally between 4". Each half opens its own panel. Directly under
            the amount, so the people involved are never below the fold.
          */}
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-body text-muted">
            <SentenceButton onClick={() => setPanel("payer")} warning={payerMismatch}>
              {draft.payers.length === 1 && peopleById.get(draft.payers[0].personId) ? (
                <Avatar person={peopleById.get(draft.payers[0].personId)!} size="xs" />
              ) : null}
              Paid by {payerLabel(draft.payers, peopleById, me.id).replace(/^You$/, "you")}
            </SentenceButton>
            <span aria-hidden>·</span>
            <SentenceButton
              onClick={() => setPanel("split")}
              warning={split.errors.length > 0}
              ariaLabel={`Split ${splitLabel(draft.splitMode, split.splits.filter((s) => s.included).length).toLowerCase()}`}
            >
              split {splitSentence(draft.splitMode, split.splits.filter((s) => s.included).length)}
              {!expense && group?.defaultSplit && draft.splitMode !== "EQUAL" ? " · usual split" : ""}
            </SentenceButton>
          </p>
          {foundItems && draft.splitMode !== "ITEMIZED" ? (
            <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-line px-3.5 py-3">
              <p className="min-w-0 flex-1 text-body leading-snug text-text">
                The receipt has {foundItems.length} items. Split it by who had what?
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  haptic();
                  const included = members.map((m) => m.id);
                  patch({
                    splitMode: "ITEMIZED",
                    participants: included.map((personId) => ({ personId, included: true })),
                    // Everyone on every line to start with; untick in the editor.
                    items: foundItems.map((item, index) => ({
                      id: `receipt-${index}`,
                      name: item.name,
                      amount: item.amount,
                      participantIds: [...included],
                    })),
                  });
                  setFoundItems(null);
                  setPanel("split");
                }}
              >
                Split by item
              </Button>
            </div>
          ) : null}
          {!expense && group?.defaultSplit ? (
            <UsualSplitNote
              usual={startingSplit(group.defaultSplit, group.members.map((m) => m.id))}
              current={draft.splitMode}
            />
          ) : null}

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
            {/*
              A real date field laid invisibly over the chip. The chip used to
              build a date input in memory and ask the browser to open it, which
              browsers refuse for an element that is not on the page - so the
              date could not be changed at all. A tap on this field opens the
              native picker on phones; showPicker() covers desktop browsers.
            */}
            <span className="relative inline-flex">
              {/* Only a picture of a chip: the date field on top is the control,
                  so this must not be a second, dead button for a screen reader
                  or the Tab key to land on. */}
              <Chip icon={<CalendarDays className="size-3.5" />} active={!isToday(draft.date)} decorative>
                {formatDateChip(draft.date)}
              </Chip>
              <input
                type="date"
                aria-label="Date"
                value={toDateInput(draft.date)}
                onChange={(event) => {
                  if (event.target.value) patch({ date: fromDateInput(event.target.value) });
                }}
                onClick={(event) => {
                  try {
                    event.currentTarget.showPicker?.();
                  } catch {
                    // Not supported: the native tap behaviour still applies.
                  }
                }}
                className="absolute inset-0 h-full w-full cursor-pointer text-input opacity-0"
              />
            </span>

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
        items={draft.items}
        payerIds={draft.payers.map((p) => p.personId)}
        onChange={(mode, participants, items) => patch({ splitMode: mode, participants, items })}
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
        currency={draft.currency}
        onRead={(reading) => {
          // Fill in only what's still empty: never overwrite what was typed.
          const changes: Partial<Draft> = {};
          const filled: string[] = [];
          if (reading.total !== null && !draft.amount) {
            changes.amount = reading.total;
            filled.push(`the total (${formatMoney(reading.total, draft.currency)})`);
          }
          if (reading.merchant && !draft.description.trim()) {
            changes.description = reading.merchant;
            filled.push("the description");
            if (draft.categoryId === DEFAULT_CATEGORY_ID) {
              const guess = suggestCategory(reading.merchant);
              if (guess) changes.categoryId = guess.id;
            }
          }
          if (Object.keys(changes).length > 0) patch(changes);
          setFoundItems(reading.items.length >= 2 ? reading.items : null);
          haptic(10);
          toast({
            tone: "success",
            title: "Read the receipt",
            description:
              filled.length > 0
                ? `Filled in ${filled.join(" and ")}. Check it matches the receipt.`
                : reading.total !== null
                  ? `It says ${formatMoney(reading.total, draft.currency)} in total.`
                  : "Found the items, but no total.",
          });
        }}
      />

      <Sheet open={panel === "notes"} onClose={() => setPanel(null)} title="Note">
        <div className="px-5 pb-6">
          <textarea
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value.slice(0, 2000) })}
            rows={5}
            autoFocus
            placeholder="Add a note…"
            className="w-full resize-none rounded-[var(--radius-md)] border border-transparent bg-surface-2 p-3.5 text-input leading-relaxed text-text outline-none transition placeholder:text-subtle/70 focus:ring-[1.5px] focus:ring-text"
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
  data: { groups: { id: string; currency: string; members: PersonDto[]; defaultSplit?: DefaultSplit | null }[] },
): Draft {
  const group = groupId ? data.groups.find((g) => g.id === groupId) : undefined;
  const members = group?.members ?? [];
  // The group's usual split, if it has one, applied to who is in it now.
  const usual = group ? startingSplit(group.defaultSplit ?? null, members.map((m) => m.id)) : null;

  return {
    description: "",
    amount: null,
    // A group's own currency is a better default than the user's, because
    // that is what the trip is being tracked in.
    currency: group?.currency ?? currency,
    groupId: group?.id ?? null,
    friendId: null,
    extraFriendIds: [],
    categoryId: DEFAULT_CATEGORY_ID,
    date: new Date(),
    notes: "",
    splitMode: usual?.mode ?? "EQUAL",
    // Whoever is adding the expense almost always paid for it.
    payers: [{ personId: meId, amount: 0n }],
    participants:
      usual?.participants ??
      (members.length > 0 ? members.map((m) => m.id) : [meId]).map((personId) => ({
        personId,
        included: true,
      })),
    items: [],
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
    extraFriendIds: [],
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
    items: expense.items.map((item) => ({
      id: item.id,
      name: item.name,
      amount: BigInt(item.amount),
      participantIds: item.participantIds,
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
  data: { groups: { id: string; name: string; emoji: string; currency: string; members: PersonDto[]; defaultSplit?: DefaultSplit | null }[]; friends: { person: PersonDto; isFriend?: boolean }[]; me: PersonDto };
  onChange: (changes: Partial<Draft>) => void;
  /** Editing: the scope is fixed and shown as a label rather than a control. */
  locked?: boolean;
}) {
  const [picking, setPicking] = React.useState(false);
  const options = [
    ...data.groups.map((group) => ({
      key: `group:${group.id}`,
      label: `${group.emoji} ${group.name}`,
      leading: <span className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] bg-surface-2 text-title">{group.emoji}</span>,
      name: group.name,
      apply: (): Partial<Draft> => {
        const usual = startingSplit(group.defaultSplit ?? null, group.members.map((m) => m.id));
        return {
          groupId: group.id,
          friendId: null,
          extraFriendIds: [],
          currency: group.currency,
          exchangeRate: "1",
          splitMode: usual?.mode ?? "EQUAL",
          participants: usual?.participants ?? group.members.map((m) => ({ personId: m.id, included: true })),
          // Payers from another group or friend are meaningless here.
          payers: [{ personId: data.me.id, amount: draft.amount ?? 0n }],
          items: [],
        };
      },
    })),
    // Only people added as friends: someone you only share a group with can
    // be split with inside that group, and the server refuses it out here.
    ...data.friends.filter((friend) => friend.isFriend !== false).map((friend) => ({
      key: `friend:${friend.person.id}`,
      label: friend.person.displayName,
      leading: <Avatar person={friend.person} size="md" />,
      name: friend.person.displayName,
      apply: (): Partial<Draft> => ({
        groupId: null,
        friendId: friend.person.id,
        extraFriendIds: [],
        payers: [{ personId: data.me.id, amount: draft.amount ?? 0n }],
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
    // A non-group expense has no option to match, so name the people on it.
    const friendNames = data.friends
      .filter((f) => draft.participants.some((p) => p.personId === f.person.id))
      .map((f) => f.person.displayName);
    const label =
      options.find((option) => option.key === current)?.label ??
      (draft.groupId ? undefined : friendNames.join(", ") || undefined);
    if (!label) return null;
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5">
        <span className="shrink-0 text-body font-semibold text-muted">With</span>
        <span className="min-w-0 flex-1 truncate text-subhead font-semibold text-text">
          {label}
        </span>
        <span className="shrink-0 text-caption text-subtle">Can&rsquo;t be moved</span>
      </div>
    );
  }

  // Splitting one bill with several friends outside a group: the first is
  // picked above, the rest are toggled in here.
  const others = draft.friendId
    ? data.friends.filter((f) => f.person.id !== draft.friendId && f.isFriend !== false)
    : [];
  const toggleFriend = (id: string) => {
    const on = draft.extraFriendIds.includes(id);
    if (on) {
      const payers = draft.payers.filter((p) => p.personId !== id);
      onChange({
        extraFriendIds: draft.extraFriendIds.filter((x) => x !== id),
        participants: draft.participants.filter((p) => p.personId !== id),
        payers: payers.length > 0 ? payers : [{ personId: data.me.id, amount: draft.amount ?? 0n }],
        items: draft.items.map((item) => ({
          ...item,
          participantIds: item.participantIds.filter((x) => x !== id),
        })),
      });
    } else {
      onChange({
        extraFriendIds: [...draft.extraFriendIds, id],
        participants: [...draft.participants, { personId: id, included: true }],
      });
    }
  };

  return (
    <div className="space-y-2">
    {/* A chip that opens a proper list, rather than the browser's own
        drop-down, which can't show a group's emoji or a friend's face. */}
    <button
      type="button"
      onClick={() => {
        haptic();
        setPicking(true);
      }}
      className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-line px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="shrink-0 text-body text-muted">With</span>
      <span className="min-w-0 flex-1 truncate text-body-lg font-medium text-text">
        {options.find((o) => o.key === current)?.label ?? "Pick a group or a friend"}
      </span>
      <ChevronDown className="size-4 shrink-0 text-subtle" />
    </button>
    <Sheet open={picking} onClose={() => setPicking(false)} title="Add it to">
      <div className="space-y-5 px-5 pb-6">
        {[
          { title: "Groups", list: options.filter((o) => o.key.startsWith("group:")) },
          { title: "Friends", list: options.filter((o) => o.key.startsWith("friend:")) },
        ]
          .filter((section) => section.list.length > 0)
          .map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 px-1 text-caption font-medium text-subtle">{section.title}</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line">
                {section.list.map((option) => (
                  <li key={option.key}>
                    <button
                      type="button"
                      onClick={() => {
                        haptic();
                        onChange(option.apply());
                        setPicking(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      {option.leading}
                      <span className="min-w-0 flex-1 truncate text-body-lg font-medium text-text">{option.name}</span>
                      {option.key === current ? <Check className="size-5 shrink-0 text-text" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </Sheet>
    {others.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5 px-1" role="group" aria-label="Also split with">
        <span className="mr-0.5 text-caption font-semibold text-subtle">Also with</span>
        {others.map((friend) => {
          const on = draft.extraFriendIds.includes(friend.person.id);
          return (
            <button
              key={friend.person.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleFriend(friend.person.id)}
              className={cn(
                "flex h-8 items-center gap-1 rounded-full border px-3 text-body font-semibold transition active:opacity-70",
                on
                  ? "border-text bg-text text-inverse"
                  : "border-line bg-surface text-text",
              )}
            >
              {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {friend.person.displayName}
            </button>
          );
        })}
      </div>
    ) : null}
    </div>
  );
}

/**
 * One half of "Paid by you · split equally between 4": a word you can tap.
 * Underlined so it reads as a control inside a sentence; red when what it
 * describes doesn't add up yet.
 */
function SentenceButton({
  children,
  onClick,
  warning,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  warning?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onClick();
      }}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 font-medium underline decoration-1 underline-offset-4 transition-colors hover:bg-surface-2",
        warning ? "text-negative-text decoration-negative" : "text-text decoration-line-strong",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  icon,
  active,
  onClick,
  decorative,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Drawn as a chip but not a control; something laid over it is. */
  decorative?: boolean;
}) {
  const Tag = decorative ? "span" : "button";
  return (
    <Tag
      {...(decorative
        ? { "aria-hidden": true }
        : {
            type: "button" as const,
            onClick: () => {
              haptic();
              onClick?.();
            },
          })}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body font-medium transition-colors",
        active
          ? "border-text bg-text text-inverse"
          : "border-line bg-surface text-text hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </Tag>
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
      <div className="rounded-[var(--radius-lg)] bg-surface-2 p-3.5">
        <p className="mb-2.5 text-caption font-medium text-subtle">
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
                <span className="min-w-0 flex-1 truncate text-body font-medium text-text">
                  {split.personId === meId ? "You" : person.displayName}
                </span>
                <span className="tabular text-body font-semibold text-muted">
                  {formatMoney(split.amount, currency)}
                </span>
                {net !== 0n ? (
                  <span
                    className={cn(
                      "tabular min-w-[68px] shrink-0 text-right text-caption font-semibold",
                      net > 0n ? "text-positive-text" : "text-negative-text",
                    )}
                  >
                    {formatMoney(net, currency, { signed: true })}
                  </span>
                ) : (
                  <span className="min-w-[68px] shrink-0 text-right text-caption font-semibold text-subtle">
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

function splitSentence(mode: SplitMode, count: number): string {
  switch (mode) {
    case "EQUAL":
      return count === 1 ? "to one person" : `equally between ${count}`;
    case "EXACT":
      return "by exact amounts";
    case "PERCENT":
      return "by percent";
    case "SHARES":
      return "by shares";
    case "ADJUSTMENT":
      return "with extras";
    case "ITEMIZED":
      return "by item";
    default:
      return "equally";
  }
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

/** Says why a new expense isn't splitting equally, or why it is despite a usual split. */
function UsualSplitNote({
  usual,
  current,
}: {
  usual: ReturnType<typeof startingSplit>;
  current: SplitMode;
}) {
  if (!usual) return null;
  if (usual.stale) {
    return (
      <p className="mt-2 px-1 text-caption leading-relaxed text-warning-soft-text">
        This group&rsquo;s usual split no longer adds up, because someone in it left. Splitting
        equally instead. You can update the usual split in group settings.
      </p>
    );
  }
  if (current !== usual.mode) return null;
  return (
    <p className="mt-2 px-1 text-caption leading-relaxed text-subtle">
      Using this group&rsquo;s usual split. Tap Split to change it for this expense.
    </p>
  );
}
