"use client";

import * as React from "react";
import { Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { Sheet, ConfirmSheet } from "../ui/sheet";
import { Amount } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { Button, Skeleton, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { CategoryGlyph } from "./category-glyph";
import { ExpenseComposer } from "./composer";
import {
  useAddComment,
  useComments,
  useDeleteAttachment,
  useDeleteExpense,
  useRestoreExpense,
  useExpense,
} from "@/lib/client/queries";
import { categoryById } from "@/lib/categories";
import { formatMoney, toDecimalString } from "@/lib/money";
import type { PersonDto } from "@/lib/types";

/**
 * One expense, in full.
 *
 * The split breakdown is the point: anyone in the group can open any expense
 * and see exactly how the number they owe was arrived at. Making that
 * inspectable is what stops a shared ledger turning into an argument.
 */
export function ExpenseDetailSheet({
  expenseId,
  onClose,
  meId,
  people,
}: {
  expenseId: string | null;
  onClose: () => void;
  meId: string;
  people: Map<string, PersonDto>;
}) {
  const toast = useToast();
  const { data: expense, isLoading } = useExpense(expenseId ?? undefined);
  const { data: comments } = useComments(expenseId ?? undefined);
  const addComment = useAddComment(expenseId ?? "");
  const deleteExpense = useDeleteExpense();
  const restoreExpense = useRestoreExpense();
  const deleteAttachment = useDeleteAttachment(expenseId ?? "");

  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmRemoveReceipt, setConfirmRemoveReceipt] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  // Cleared when the sheet closes, not when it opens: the detail sheet renders
  // from a query rather than from a draft, so there is nothing stale to flash,
  // and doing it on close keeps a half-written comment from reappearing.
  React.useEffect(() => {
    if (!expenseId) {
      setEditing(false);
      setConfirmDelete(false);
      setConfirmRemoveReceipt(null);
      setDraft("");
    }
  }, [expenseId]);

  const remove = async () => {
    if (!expense) return;
    // Captured before the mutation: the sheet closes and its query goes with
    // it, so by the time anyone taps Undo there is nothing left to read this
    // from.
    const { id, groupId, description } = expense;
    try {
      await deleteExpense.mutateAsync({ id, groupId });
      haptic([10, 40, 10]);
      toast({
        tone: "success",
        title: `${description} deleted`,
        // The row is tombstoned rather than destroyed and every balance is
        // derived, so putting it back costs one field. Offering that is the
        // difference between a delete people can risk and one they cannot.
        action: {
          label: "Undo",
          onClick: () => {
            restoreExpense.mutate(
              { id, groupId },
              {
                onSuccess: () => toast({ tone: "success", title: `${description} restored` }),
                onError: () => toast({ tone: "error", title: "Could not put that back" }),
              },
            );
          },
        },
      });
      setConfirmDelete(false);
      onClose();
    } catch {
      toast({ tone: "error", title: "Could not delete that" });
    }
  };

  const removeReceipt = async () => {
    if (!expense || !confirmRemoveReceipt) return;
    try {
      await deleteAttachment.mutateAsync({
        id: confirmRemoveReceipt,
        groupId: expense.groupId,
      });
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "Receipt removed" });
    } catch {
      toast({ tone: "error", title: "Could not remove that receipt" });
    } finally {
      setConfirmRemoveReceipt(null);
    }
  };

  const category = expense ? categoryById(expense.categoryId) : null;

  return (
    <>
      <Sheet open={Boolean(expenseId) && !editing} onClose={onClose} tall>
        {isLoading || !expense ? (
          <div className="space-y-3 px-5 py-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-24 w-full rounded-[var(--radius-lg)]" />
          </div>
        ) : (
          <div className="px-5 pb-6">
            {/* Head ------------------------------------------------------- */}
            <div className="flex items-start gap-3.5 pt-1">
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
                style={{
                  background: `color-mix(in oklch, var(--avatar-${category!.color}) 16%, transparent)`,
                  color: `var(--avatar-${category!.color})`,
                }}
              >
                <CategoryGlyph name={category!.icon} className="size-5" />
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="text-title-lg font-bold leading-tight tracking-[-0.02em] text-text">
                  {expense.description}
                </h2>
                <p className="mt-1 text-body text-muted">
                  {category!.name} ·{" "}
                  {new Date(expense.date).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <Amount
                value={expense.amount}
                currency={expense.currency}
                size="xl"
                tone="plain"
              />
              {expense.currency !== "" && expense.exchangeRate !== "1" ? (
                <span className="tabular text-body text-subtle">
                  ≈ {toDecimalString(BigInt(expense.convertedAmount), expense.currency)}
                </span>
              ) : null}
            </div>

            {/* Paid by ---------------------------------------------------- */}
            <div className="mt-5">
              <SectionLabel>Paid by</SectionLabel>
              <ul className="space-y-1.5">
                {expense.payers.map((payer) => {
                  const person = people.get(payer.personId);
                  if (!person) return null;
                  return (
                    <li
                      key={payer.personId}
                      className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5"
                    >
                      <Avatar person={person} size="sm" />
                      <span className="flex-1 truncate text-body-lg font-semibold text-text">
                        {payer.personId === meId ? "You" : person.displayName}
                      </span>
                      <Amount
                        value={payer.amount}
                        currency={expense.currency}
                        size="sm"
                        tone="plain"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Split ------------------------------------------------------ */}
            <div className="mt-5">
              <SectionLabel>{splitLabel(expense.splitMode)}</SectionLabel>
              <ul className="space-y-1.5">
                {expense.splits
                  .filter((split) => split.included || BigInt(split.amount) !== 0n)
                  .map((split) => {
                    const person = people.get(split.personId);
                    if (!person) return null;
                    const paid = expense.payers
                      .filter((p) => p.personId === split.personId)
                      .reduce((total, p) => total + BigInt(p.amount), 0n);
                    const net = paid - BigInt(split.amount);

                    return (
                      <li
                        key={split.personId}
                        className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5"
                      >
                        <Avatar person={person} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-lg font-semibold text-text">
                            {split.personId === meId ? "You" : person.displayName}
                          </span>
                          {split.percent !== null || split.weight !== null ? (
                            <span className="block text-tiny text-subtle">
                              {split.percent !== null
                                ? `${split.percent}%`
                                : `${split.weight} ${split.weight === 1 ? "share" : "shares"}`}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-right">
                          <span className="tabular block text-body-lg font-semibold text-text">
                            {formatMoney(BigInt(split.amount), expense.currency)}
                          </span>
                          {net !== 0n ? (
                            <span
                              className={cn(
                                "block text-tiny font-semibold",
                                net > 0n ? "text-positive-text" : "text-negative-text",
                              )}
                            >
                              {net > 0n ? "lent " : "borrowed "}
                              {formatMoney(net > 0n ? net : -net, expense.currency)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>

            {/* Items ------------------------------------------------------ */}
            {expense.items.length > 0 ? (
              <div className="mt-5">
                <SectionLabel>Receipt</SectionLabel>
                <ul className="divide-y divide-line rounded-[var(--radius-md)] bg-surface-2 px-3">
                  {expense.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-text">
                          {item.name}
                        </span>
                        <span className="block truncate text-tiny text-subtle">
                          {item.participantIds
                            .map((id) =>
                              id === meId
                                ? "you"
                                : (people.get(id)?.displayName.split(" ")[0] ?? "?"),
                            )
                            .join(", ")}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-body font-semibold text-muted">
                        {formatMoney(BigInt(item.amount), expense.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Attachments ------------------------------------------------ */}
            {expense.attachments.length > 0 ? (
              <div className="mt-5">
                <SectionLabel>Receipts</SectionLabel>
                <ul className="grid grid-cols-3 gap-2">
                  {expense.attachments.map((attachment) => (
                    <li key={attachment.id} className="relative">
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-2 transition active:scale-95"
                      >
                        {attachment.mimeType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={attachment.url}
                            alt={attachment.filename}
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center text-subtle">
                            <Paperclip className="size-6" />
                          </span>
                        )}
                      </a>
                      {/*
                        Sits outside the link rather than inside it, so tapping
                        the receipt opens it and only the corner removes it. A
                        44px target would cover a third of a thumbnail, so this
                        one is smaller by design and the confirm step below is
                        what actually protects against a fat finger.
                      */}
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.filename}`}
                        disabled={deleteAttachment.isPending}
                        onClick={() => {
                          haptic();
                          setConfirmRemoveReceipt(attachment.id);
                        }}
                        className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-line bg-surface shadow-card text-muted transition active:scale-90 disabled:opacity-40"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Notes ------------------------------------------------------ */}
            {expense.notes ? (
              <div className="mt-5">
                <SectionLabel>Note</SectionLabel>
                <p className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-3 text-body-lg leading-relaxed text-text">
                  {expense.notes}
                </p>
              </div>
            ) : null}

            {/* Comments --------------------------------------------------- */}
            <div className="mt-5">
              <SectionLabel>
                {comments && comments.length > 0
                  ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
                  : "Comments"}
              </SectionLabel>

              {comments && comments.length > 0 ? (
                <ul className="mb-3 space-y-2.5">
                  {comments.map((comment) => {
                    const person = people.get(comment.personId);
                    return (
                      <li key={comment.id} className="flex gap-2.5">
                        {person ? <Avatar person={person} size="xs" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block text-caption font-semibold text-muted">
                            {comment.personId === meId
                              ? "You"
                              : (person?.displayName ?? "Someone")}
                          </span>
                          <span className="mt-0.5 block whitespace-pre-wrap text-body-lg leading-snug text-text">
                            {comment.body}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && draft.trim()) {
                      addComment.mutate(draft.trim());
                      setDraft("");
                    }
                  }}
                  placeholder="Add a comment"
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
                />
                <button
                  onClick={() => {
                    if (!draft.trim()) return;
                    haptic();
                    addComment.mutate(draft.trim());
                    setDraft("");
                  }}
                  disabled={!draft.trim()}
                  aria-label="Post comment"
                  className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand text-white transition active:scale-90 disabled:opacity-40"
                >
                  <Send className="size-[18px]" />
                </button>
              </div>
            </div>

            {/* Actions ---------------------------------------------------- */}
            <div className="mt-6 flex gap-2.5">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setEditing(true)}
                icon={<Pencil className="size-[17px]" />}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setConfirmDelete(true)}
                icon={<Trash2 className="size-[17px]" />}
                className="text-negative-text"
              >
                Delete
              </Button>
            </div>

            <p className="mt-3 text-center text-tiny text-subtle">
              Added by{" "}
              {expense.createdByPersonId === meId
                ? "you"
                : (people.get(expense.createdByPersonId)?.displayName ?? "someone")}
            </p>
          </div>
        )}
      </Sheet>

      {expense ? (
        <ExpenseComposer
          open={editing}
          expense={expense}
          onClose={() => setEditing(false)}
        />
      ) : null}

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        loading={deleteExpense.isPending}
        title="Delete this expense?"
        description="Everyone's balance in this group will be recalculated without it."
        confirmLabel="Delete"
      />

      <ConfirmSheet
        open={Boolean(confirmRemoveReceipt)}
        onClose={() => setConfirmRemoveReceipt(null)}
        onConfirm={() => void removeReceipt()}
        loading={deleteAttachment.isPending}
        title="Remove this receipt?"
        description="The image is deleted from the server. The expense and everyone's balances stay exactly as they are."
        confirmLabel="Remove"
      />
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-tiny font-bold uppercase tracking-[0.07em] text-subtle">
      {children}
    </p>
  );
}

function splitLabel(mode: string): string {
  switch (mode) {
    case "EQUAL":
      return "Split equally";
    case "EXACT":
      return "Split by exact amounts";
    case "PERCENT":
      return "Split by percentage";
    case "SHARES":
      return "Split by shares";
    case "ADJUSTMENT":
      return "Split evenly plus extras";
    case "ITEMIZED":
      return "Split by item";
    default:
      return "Split";
  }
}
