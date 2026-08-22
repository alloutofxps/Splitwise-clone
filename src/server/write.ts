/**
 * Write-side services.
 *
 * Two things worth calling out:
 *
 * **Idempotency.** The client generates the row id before sending. When an
 * offline mutation is replayed - the phone reconnected and the outbox flushed,
 * or the user tapped Save twice on a slow connection - the insert collides on
 * the primary key and we return the existing row instead of filing the dinner
 * twice. This is why ids come from the client rather than the database.
 *
 * **Edits rewrite rather than patch.** An expense's payers, splits and items
 * are replaced wholesale on update inside a transaction. Diffing them would be
 * more efficient and much easier to get subtly wrong, and these are rows with
 * at most a dozen children.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/identity";
import { validateExpenseBalance } from "@/lib/split";
import { convert, currency as currencyInfo } from "@/lib/money";
import { DEFAULT_CATEGORY_ID, CATEGORY_BY_ID } from "@/lib/categories";
import type { ActivityData } from "@/lib/types";

/** Prisma's code for a primary key / unique constraint collision. */
const UNIQUE_VIOLATION = "P2002";

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
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
  createdByPersonId: string;
  recurrenceId?: string | null;
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

/**
 * Validates everything a stored expense must satisfy.
 *
 * The invariant that matters is conservation: payers sum to the total and
 * splits sum to the total. A row violating it would quietly corrupt every
 * balance the group ever sees, so it is rejected at the boundary rather than
 * repaired.
 */
function validateExpense(input: ExpenseWriteInput): void {
  const errors = validateExpenseBalance(input.amount, input.payers, input.splits);

  if (!input.description.trim()) errors.push("Give the expense a description.");
  if (input.description.length > 140) errors.push("That description is too long.");

  const info = currencyInfo(input.currency);
  if (info.code !== input.currency.toUpperCase()) {
    errors.push("That currency code is not valid.");
  }

  if (input.categoryId && !CATEGORY_BY_ID.has(input.categoryId)) {
    errors.push("That category does not exist.");
  }

  if (input.splits.length === 0) errors.push("Nobody is in this split.");
  if (input.payers.length === 0) errors.push("Somebody has to have paid.");

  // An itemised expense whose items overshoot the total is a data-entry
  // mistake worth surfacing; undershooting is normal (tax and tip).
  if (input.items.length > 0) {
    const itemTotal = input.items.reduce((total, item) => total + item.amount, 0n);
    if (itemTotal > input.amount) {
      errors.push("The items add up to more than the expense total.");
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}

function convertedFor(input: ExpenseWriteInput): bigint {
  return convert(input.amount, input.currency, input.settlementCurrency, input.exchangeRate);
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

  try {
    const record = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
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
          recurrenceId: input.recurrenceId ?? null,
          payers: {
            create: input.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
          },
          splits: {
            create: input.splits.map((s) => ({
              personId: s.personId,
              amount: s.amount,
              included: s.included,
              weight: s.weight,
              percent: s.percent,
              adjustment: s.adjustment,
            })),
          },
        },
      });

      await writeItems(tx, expense.id, input.items);
      await writeAttachments(tx, expense.id, input.attachments);
      return expense;
    });
    return { record, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A replayed offline mutation. The row already exists; hand it back so
      // the caller can respond successfully without filing a second copy.
      const existing = await prisma.expense.findUnique({ where: { id: input.id } });
      if (existing) return { record: existing, created: false };
    }
    throw error;
  }
}

export async function updateExpense(input: ExpenseWriteInput) {
  validateExpense(input);
  const convertedAmount = convertedFor(input);

  return prisma.$transaction(async (tx) => {
    await tx.expensePayer.deleteMany({ where: { expenseId: input.id } });
    await tx.expenseSplit.deleteMany({ where: { expenseId: input.id } });
    await tx.expenseItem.deleteMany({ where: { expenseId: input.id } });

    const expense = await tx.expense.update({
      where: { id: input.id },
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
        payers: {
          create: input.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
        },
        splits: {
          create: input.splits.map((s) => ({
            personId: s.personId,
            amount: s.amount,
            included: s.included,
            weight: s.weight,
            percent: s.percent,
            adjustment: s.adjustment,
          })),
        },
      },
    });

    await writeItems(tx, expense.id, input.items);
    // Attachments are additive on edit: an edit that did not touch the photos
    // should not silently drop them. Removal has its own endpoint.
    await writeAttachments(tx, expense.id, input.attachments);
    return expense;
  });
}

type Tx = Prisma.TransactionClient;

async function writeItems(tx: Tx, expenseId: string, items: ExpenseWriteInput["items"]) {
  for (const [index, item] of items.entries()) {
    await tx.expenseItem.create({
      data: {
        expenseId,
        name: item.name.trim().slice(0, 100) || "Item",
        amount: item.amount,
        quantity: item.quantity,
        sortOrder: index,
        shares: {
          create: [...new Set(item.participantIds)].map((personId) => ({ personId })),
        },
      },
    });
  }
}

async function writeAttachments(
  tx: Tx,
  expenseId: string,
  attachments: ExpenseWriteInput["attachments"],
) {
  for (const attachment of attachments) {
    await tx.attachment.create({
      data: {
        expenseId,
        filename: attachment.filename.slice(0, 120),
        mimeType: attachment.mimeType,
        size: attachment.data.byteLength,
        // Prisma's Bytes maps to Uint8Array; a Node Buffer is a subclass whose
        // backing store may be shared, so hand over a plain view.
        data: new Uint8Array(attachment.data),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/**
 * Decodes a `data:` URL from the client.
 *
 * The client downscales photos before upload, so anything arriving near the
 * cap is either a PDF or somebody bypassing the UI. Both get the same limit.
 */
export function decodeDataUrl(dataUrl: string, filename: string): {
  filename: string;
  mimeType: string;
  data: Buffer;
} {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new ValidationError("That attachment could not be read.");

  const [, mimeType, isBase64, payload] = match;
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new ValidationError("Attachments have to be an image or a PDF.");
  }

  const data = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  if (data.byteLength === 0) throw new ValidationError("That attachment is empty.");
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Attachments have to be under 4 MB.");
  }

  return { filename, mimeType, data };
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
  data?: ActivityData;
}) {
  return prisma.activity.create({
    data: {
      type: input.type,
      actorPersonId: input.actorPersonId,
      groupId: input.groupId ?? null,
      expenseId: input.expenseId ?? null,
      settlementId: input.settlementId ?? null,
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
