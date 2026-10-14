/**
 * Write-side services.
 *
 * Three things worth calling out:
 *
 * **Idempotency.** The client generates the row id before sending. When an
 * offline mutation is replayed - the phone reconnected and the outbox flushed,
 * or the user tapped Save twice on a slow connection - the insert collides on
 * the primary key and we return the existing row instead of filing the dinner
 * twice. The existing row is only handed back to the person who created it and
 * only for the same ledger: answering a collision with whatever row owns the
 * id let anybody read any expense by quoting its id in a "create".
 *
 * **One statement per write.** Payers, splits, items and receipts are written
 * as nested creates on the expense itself, in a single batch with the ledger
 * version bump. That keeps each save to one short transaction - which matters
 * on SQLite, where a write holds the only lock - instead of a long interactive
 * transaction issuing a dozen round trips.
 *
 * **Edits rewrite rather than patch.** An expense's payers, splits and items
 * are replaced wholesale on update. Diffing them would be more efficient and
 * much easier to get subtly wrong, and these are rows with at most a dozen
 * children.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { MAX_MINOR_UNITS } from "@/lib/api";
import { validateExpenseBalance } from "@/lib/split";
import { convert, isKnownCurrency } from "@/lib/money";
import { DEFAULT_CATEGORY_ID, CATEGORY_BY_ID } from "@/lib/categories";
import type { ActivityData } from "@/lib/types";
import { bumpLedgerQuery } from "./ledger";

/** Prisma's code for a primary key / unique constraint collision. */
const UNIQUE_VIOLATION = "P2002";
/** Prisma's code for "the row the write was conditioned on is not there". */
const RECORD_NOT_FOUND = "P2025";

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
  );
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND
  );
}

// ---------------------------------------------------------------------------

export interface ExpenseWriteInput {
  id: string;
  groupId: string | null;
  description: string;
  notes: string | null;
  amount: bigint;
  currency: string;
  exchangeRate: string;
  /** Currency balances are settled in: the group's, or the expense's own. */
  settlementCurrency: string;
  splitMode: string;
  categoryId: string | null;
  date: Date;
  /** For a create, the author. For an edit, the person making the edit. */
  createdByPersonId: string;
  recurrenceId?: string | null;
  /** For an edit: the version the editor was looking at. */
  expectedUpdatedAt?: Date | null;
  payers: { personId: string; amount: bigint }[];
  splits: {
    personId: string;
    amount: bigint;
    included: boolean;
    weight: number | null;
    percent: number | null;
    adjustment: bigint | null;
  }[];
  items: {
    name: string;
    amount: bigint;
    quantity: number;
    participantIds: string[];
  }[];
  attachments: { filename: string; mimeType: string; data: Buffer }[];
}

function duplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/**
 * Validates everything a stored expense must satisfy.
 *
 * The invariant that matters is conservation: payers sum to the total and
 * splits sum to the total. A row violating it would quietly corrupt every
 * balance the group ever sees, so it is rejected at the boundary rather than
 * repaired.
 */
export function validateExpense(input: ExpenseWriteInput): void {
  const errors = validateExpenseBalance(input.amount, input.payers, input.splits);

  if (!input.description.trim()) errors.push("Give the expense a description.");
  if (input.description.length > 140) errors.push("That description is too long.");

  if (!isKnownCurrency(input.currency)) errors.push("That currency code is not valid.");

  if (input.categoryId && !CATEGORY_BY_ID.has(input.categoryId)) {
    errors.push("That category does not exist.");
  }

  if (input.splits.length === 0) errors.push("Nobody is in this split.");
  if (input.payers.length === 0) errors.push("Somebody has to have paid.");

  // The same person twice used to reach the database's unique constraint and
  // come back as a 500. It is a malformed request, so it is said as one.
  if (duplicates(input.payers.map((p) => p.personId))) {
    errors.push("The same person is listed as paying twice.");
  }
  if (duplicates(input.splits.map((s) => s.personId))) {
    errors.push("The same person is listed in the split twice.");
  }

  for (const split of input.splits) {
    if (split.weight !== null && !(split.weight >= 0 && split.weight <= 1_000_000)) {
      errors.push("A share weight is out of range.");
      break;
    }
    if (split.percent !== null && !(split.percent >= 0 && split.percent <= 100)) {
      errors.push("A percentage has to be between 0 and 100.");
      break;
    }
  }

  // Items describe how a receipt was divided; they never move a balance on
  // their own, but they are shown and exported, so they have to make sense.
  if (input.items.length > 0) {
    if (input.items.some((item) => item.amount < 0n)) {
      errors.push("An item cannot cost a negative amount.");
    }
    const itemTotal = input.items.reduce((total, item) => total + item.amount, 0n);
    // Overshooting is a data-entry mistake worth surfacing; undershooting is
    // normal (tax and tip).
    if (itemTotal > input.amount) {
      errors.push("The items add up to more than the expense total.");
    }
    // Only people on the expense can have ordered something on it. Anything
    // else attached an arbitrary person's id to a row they cannot see.
    const onExpense = new Set(input.splits.map((s) => s.personId));
    if (input.items.some((item) => item.participantIds.some((id) => !onExpense.has(id)))) {
      errors.push("An item names somebody who is not in the split.");
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}

function convertedFor(input: ExpenseWriteInput): bigint {
  const converted = convert(input.amount, input.currency, input.settlementCurrency, input.exchangeRate);
  // A huge rate can push a valid amount past the point where the balance maths
  // stays exact; refuse it at the door rather than corrupt it on the way out.
  if (converted > MAX_MINOR_UNITS || converted <= 0n) {
    throw new ValidationError("That exchange rate produces an amount that cannot be stored.");
  }
  return converted;
}

/** The child rows of an expense, in the shape a nested Prisma create wants. */
function childRows(input: ExpenseWriteInput) {
  return {
    payers: input.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
    splits: input.splits.map((s) => ({
      personId: s.personId,
      amount: s.amount,
      included: s.included,
      weight: s.weight,
      percent: s.percent,
      adjustment: s.adjustment,
    })),
    items: input.items.map((item, index) => ({
      name: item.name.trim().slice(0, 100) || "Item",
      amount: item.amount,
      quantity: item.quantity,
      sortOrder: index,
      shares: {
        create: [...new Set(item.participantIds)].map((personId) => ({ personId })),
      },
    })),
    attachments: input.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.data.byteLength,
      // Prisma's Bytes maps to Uint8Array; a Node Buffer is a subclass whose
      // backing store may be shared, so hand over a plain view.
      data: new Uint8Array(attachment.data),
    })),
  };
}

export interface CreateResult<T> {
  record: T;
  /** False when this was a replayed mutation and the row already existed. */
  created: boolean;
}

export async function createExpense(
  input: ExpenseWriteInput,
): Promise<CreateResult<Prisma.ExpenseGetPayload<object>>> {
  validateExpense(input);
  const convertedAmount = convertedFor(input);
  const rows = childRows(input);

  try {
    const [record] = await prisma.$transaction([
      prisma.expense.create({
        data: {
          id: input.id,
          groupId: input.groupId,
          description: input.description.trim(),
          notes: input.notes?.trim() || null,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          convertedAmount,
          splitMode: input.splitMode,
          categoryId: input.categoryId ?? DEFAULT_CATEGORY_ID,
          date: input.date,
          createdByPersonId: input.createdByPersonId,
          lastEditedById: input.createdByPersonId,
          recurrenceId: input.recurrenceId ?? null,
          payers: { create: rows.payers },
          splits: { create: rows.splits },
          items: { create: rows.items },
          attachments: { create: rows.attachments },
        },
      }),
      bumpLedgerQuery([input.groupId]),
    ]);
    return { record, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // A replayed offline mutation - or somebody quoting an id that is not
    // theirs. Only the first is answered with the row.
    const existing = await prisma.expense.findUnique({ where: { id: input.id } });
    if (
      existing &&
      existing.createdByPersonId === input.createdByPersonId &&
      existing.groupId === input.groupId
    ) {
      return { record: existing, created: false };
    }
    throw new ConflictError("That id is already in use. Try saving again.");
  }
}

export async function updateExpense(input: ExpenseWriteInput) {
  validateExpense(input);
  const convertedAmount = convertedFor(input);
  const rows = childRows(input);

  const current = await prisma.expense.findUnique({
    where: { id: input.id },
    select: { updatedAt: true, lastEditedById: true, groupId: true, deletedAt: true },
  });
  if (!current || current.deletedAt) {
    throw new ConflictError("That expense was deleted while you had it open.");
  }

  /*
   * Refuse an edit built on a version somebody else has since replaced.
   *
   * Two people opening the same expense is not exotic - it is a group settling
   * up after dinner, both fixing the same typo. Without this the second save
   * silently discarded the first.
   *
   * The check used to be skipped whenever the client sent no version, which is
   * exactly what a queued offline edit did - so an edit made on a plane three
   * days ago would land on top of everything since. The version is now always
   * required. The one exception is the editor's own work: if the newer version
   * is theirs (a second offline edit queued behind their first), overwriting it
   * is what they asked for.
   */
  if (!input.expectedUpdatedAt) {
    throw new ConflictError("Reopen the expense and make the change again.");
  }
  if (
    current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() &&
    current.lastEditedById !== input.createdByPersonId
  ) {
    throw new ConflictError(
      "Somebody else edited this expense while you had it open. Close and reopen it to see their version.",
    );
  }

  try {
    const [expense] = await prisma.$transaction([
      prisma.expense.update({
        // Conditioned on the version just read, so a write that lands between
        // the check above and this statement fails rather than being overwritten.
        where: { id: input.id, updatedAt: current.updatedAt },
        data: {
          description: input.description.trim(),
          notes: input.notes?.trim() || null,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          convertedAmount,
          splitMode: input.splitMode,
          categoryId: input.categoryId ?? DEFAULT_CATEGORY_ID,
          date: input.date,
          lastEditedById: input.createdByPersonId,
          payers: { deleteMany: {}, create: rows.payers },
          splits: { deleteMany: {}, create: rows.splits },
          items: { deleteMany: {}, create: rows.items },
          // Attachments are additive on edit: an edit that did not touch the
          // photos should not silently drop them. Taking one off is DELETE
          // /api/attachments/[id].
          attachments: { create: rows.attachments },
        },
      }),
      bumpLedgerQuery([current.groupId]),
    ]);
    return expense;
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw new ConflictError(
        "Somebody else edited this expense at the same moment. Close and reopen it to see their version.",
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/**
 * What each allowed type's file actually starts with.
 *
 * The declared type used to be trusted as-is, so an HTML page labelled
 * `image/png` was stored and served back from the app's own origin. Checking
 * the leading bytes means the label has to be true.
 */
const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "image/heic": (b) => isoBmff(b, ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]),
  "image/heif": (b) => isoBmff(b, ["heif", "mif1", "msf1", "heic", "heix"]),
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};

function isoBmff(bytes: Buffer, brands: string[]): boolean {
  if (bytes.subarray(4, 8).toString("latin1") !== "ftyp") return false;
  const major = bytes.subarray(8, 12).toString("latin1");
  return brands.includes(major);
}

/** A filename safe to store and to put in a Content-Disposition header. */
export function cleanFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "receipt";
}

/**
 * Decodes a `data:` URL from the client.
 *
 * Base64 only: the percent-encoded form was accepted too, and a malformed one
 * made `decodeURIComponent` throw a 500 - which the offline outbox then retried
 * forever, wedging every write queued behind it.
 */
export function decodeDataUrl(dataUrl: string, filename: string): {
  filename: string;
  mimeType: string;
  data: Buffer;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/s.exec(dataUrl);
  if (!match) throw new ValidationError("That attachment could not be read.");

  const [, mimeType, payload] = match;
  const check = SIGNATURES[mimeType];
  if (!check) {
    throw new ValidationError("Attachments have to be an image or a PDF.");
  }

  const data = Buffer.from(payload, "base64");

  if (data.byteLength === 0) throw new ValidationError("That attachment is empty.");
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachments have to be under 4 MB.");
  }
  if (!check(data)) {
    throw new ValidationError("That file is not the kind of file it says it is.");
  }

  return { filename: cleanFilename(filename), mimeType, data };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

/**
 * Records a feed entry.
 *
 * The payload carries a *snapshot* of the description and amount rather than
 * only foreign keys, so "Priya added Dinner - 48.00" still reads correctly
 * after the expense is edited to something else or deleted outright.
 */
export async function recordActivity(input: {
  type: string;
  actorPersonId: string;
  groupId?: string | null;
  expenseId?: string | null;
  settlementId?: string | null;
  /** Set only for entries addressed to one person, such as a nudge. */
  targetPersonId?: string | null;
  data?: ActivityData;
}) {
  return prisma.activity.create({
    data: {
      type: input.type,
      actorPersonId: input.actorPersonId,
      groupId: input.groupId ?? null,
      expenseId: input.expenseId ?? null,
      settlementId: input.settlementId ?? null,
      targetPersonId: input.targetPersonId ?? null,
      data: JSON.stringify(input.data ?? {}),
    },
  });
}

/** Describes what changed between two versions, for the feed. */
export function describeChanges(
  before: { description: string; amount: bigint; currency: string; date: Date; splitMode: string },
  after: { description: string; amount: bigint; currency: string; date: Date; splitMode: string },
): string[] {
  const changes: string[] = [];
  if (before.description !== after.description) {
    changes.push(`renamed it to "${after.description}"`);
  }
  if (before.amount !== after.amount || before.currency !== after.currency) {
    changes.push("changed the amount");
  }
  if (before.date.getTime() !== after.date.getTime()) changes.push("changed the date");
  if (before.splitMode !== after.splitMode) changes.push("changed how it splits");
  return changes;
}
