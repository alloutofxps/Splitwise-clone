import type { Recurrence } from "@prisma/client";
import { DEFAULT_CATEGORY_ID } from "@/lib/categories";
import type {
  ExpensePayerDto,
  ExpenseSplitDto,
  RecurrenceDto,
  RecurrenceFrequency,
  SplitMode,
} from "@/lib/types";

interface StoredEntry {
  personId: string;
  amount: string;
  included?: boolean;
  weight?: number | null;
  percent?: number | null;
  adjustment?: string | null;
}

function parse(value: string): StoredEntry[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as StoredEntry[]) : [];
  } catch {
    // A template that will not parse still needs to render in the list so the
    // user can delete it, so degrade to empty rather than throwing.
    return [];
  }
}

export function recurrenceDto(row: Recurrence): RecurrenceDto {
  const payers: ExpensePayerDto[] = parse(row.payersJson).map((p) => ({
    personId: p.personId,
    amount: p.amount,
  }));

  const splits: ExpenseSplitDto[] = parse(row.splitsJson).map((s) => ({
    personId: s.personId,
    amount: s.amount,
    included: s.included ?? true,
    weight: s.weight ?? null,
    percent: s.percent ?? null,
    adjustment: s.adjustment ?? null,
  }));

  return {
    id: row.id,
    groupId: row.groupId,
    description: row.description,
    amount: row.amount.toString(),
    currency: row.currency,
    categoryId: row.categoryId ?? DEFAULT_CATEGORY_ID,
    splitMode: row.splitMode as SplitMode,
    payers,
    splits,
    notes: row.notes,
    frequency: row.frequency as RecurrenceFrequency,
    interval: row.interval,
    startDate: row.startDate.toISOString(),
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    active: row.active,
    createdByPersonId: row.createdByPersonId,
  };
}
