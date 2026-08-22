"use client";

/**
 * Optimistic cache updates.
 *
 * An expense has to appear the instant it is submitted. Waiting for a round
 * trip is the difference between an app that feels native and one that feels
 * like a website: on a restaurant's wifi that round trip is a second, and a
 * second of nothing after tapping "Save" reads as a failure, so people tap
 * again.
 *
 * What makes this safe rather than a second guess at the server's answer:
 *
 *   - the row id is generated on the client, so the optimistic row and the real
 *     one are the same row - reconciliation is an overwrite, not a merge;
 *   - the balances are recomputed with `applyEvent`, the very function the
 *     server folds its own events through, so the number shown now is the
 *     number that comes back;
 *   - the currency conversion goes through `convertedBreakdown`, likewise
 *     shared, so a foreign-currency expense apportions identically here.
 *
 * Everything written here is marked `pending` and replaced by the refetch that
 * follows. If the write fails for any reason other than being offline, the
 * snapshot taken before the patch is restored.
 */

import type { QueryClient } from "@tanstack/react-query";
import { applyEvent, type BalanceEvent, type BalanceSheet } from "@/lib/balances";
import { convert } from "@/lib/money";
import { convertedBreakdown } from "@/lib/split";
import { DEFAULT_CATEGORY_ID } from "@/lib/categories";
import type {
  BalanceSheetDto,
  ExpenseDto,
  ExpenseInput,
  GroupDetailDto,
  SettlementDto,
  SettlementInput,
} from "@/lib/types";
import { keys, type DashboardPayload, type LedgerEntry } from "./queries";

/** Every cache key one write can invalidate, snapshotted for rollback. */
export interface Snapshot {
  entries: [readonly unknown[], unknown][];
}

// ---------------------------------------------------------------------------
// Building the row
// ---------------------------------------------------------------------------

/**
 * The expense as the server will return it, predicted.
 *
 * Only the fields the ledger and detail sheet actually render are filled with
 * real values; `createdAt`/`updatedAt` are stamped now and corrected by the
 * refetch. Attachments are deliberately empty - the upload has not happened, and
 * showing a receipt thumbnail that does not exist yet would be a lie the user
 * can see.
 */
export function optimisticExpense(
  input: ExpenseInput & { id: string },
  meId: string,
  settlementCurrency: string,
): ExpenseDto {
  const amount = BigInt(input.amount || "0");
  const exchangeRate = input.exchangeRate ?? "1";
  const convertedAmount = convert(amount, input.currency, settlementCurrency, exchangeRate);

  const payers = input.payers.map((p) => ({ personId: p.personId, amount: p.amount }));
  const splits = input.splits.map((s) => ({
    personId: s.personId,
    amount: s.amount,
    included: s.included ?? s.amount !== "0",
    weight: s.weight ?? null,
    percent: s.percent ?? null,
    adjustment: s.adjustment ?? null,
  }));

  const { paid, owed } = convertedBreakdown({
    convertedAmount,
    payers: payers.map((p) => ({ personId: p.personId, amount: BigInt(p.amount) })),
    splits: splits.map((s) => ({ personId: s.personId, amount: BigInt(s.amount) })),
  });

  const myPaid = paid
    .filter((p) => p.personId === meId)
    .reduce((total, p) => total + p.amount, 0n);
  const myOwed = owed
    .filter((o) => o.personId === meId)
    .reduce((total, o) => total + o.amount, 0n);

  const now = new Date().toISOString();

  return {
    id: input.id,
    groupId: input.groupId ?? null,
    description: input.description,
    notes: input.notes ?? null,
    amount: amount.toString(),
    currency: input.currency,
    exchangeRate,
    convertedAmount: convertedAmount.toString(),
    splitMode: input.splitMode,
    categoryId: input.categoryId ?? DEFAULT_CATEGORY_ID,
    date: input.date ?? now,
    createdByPersonId: meId,
    recurrenceId: null,
    createdAt: now,
    updatedAt: now,
    payers,
    splits,
    items: (input.items ?? []).map((item, index) => ({
      id: `${input.id}_item_${index}`,
      name: item.name,
      amount: item.amount,
      quantity: item.quantity ?? 1,
      sortOrder: index,
      participantIds: item.participantIds,
    })),
    attachments: [],
    commentCount: 0,
    yourShare: myOwed.toString(),
    yourNet: (myPaid - myOwed).toString(),
  };
}

export function optimisticSettlement(
  input: SettlementInput & { id: string },
  meId: string,
  settlementCurrency: string,
): SettlementDto {
  const amount = BigInt(input.amount || "0");
  const now = new Date().toISOString();

  return {
    id: input.id,
    groupId: input.groupId ?? null,
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    amount: amount.toString(),
    currency: input.currency,
    convertedAmount: convert(
      amount,
      input.currency,
      settlementCurrency,
      input.exchangeRate ?? "1",
    ).toString(),
    date: input.date ?? now,
    note: input.note ?? null,
    method: input.method ?? null,
    createdByPersonId: meId,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Balance arithmetic on the DTO shape
// ---------------------------------------------------------------------------

function sheetFromDto(dto: BalanceSheetDto): BalanceSheet {
  return {
    net: new Map(Object.entries(dto.net).map(([id, value]) => [id, BigInt(value)])),
    pairwise: dto.pairwise.map((edge) => ({ ...edge, amount: BigInt(edge.amount) })),
    simplified: dto.simplified.map((edge) => ({ ...edge, amount: BigInt(edge.amount) })),
    totalSpend: BigInt(dto.totalSpend),
  };
}

function sheetToDto(sheet: BalanceSheet, currency: string): BalanceSheetDto {
  return {
    currency,
    net: Object.fromEntries([...sheet.net].map(([id, value]) => [id, value.toString()])),
    pairwise: sheet.pairwise.map((edge) => ({ ...edge, amount: edge.amount.toString() })),
    simplified: sheet.simplified.map((edge) => ({ ...edge, amount: edge.amount.toString() })),
    totalSpend: sheet.totalSpend.toString(),
  };
}

/** The event form of an expense, in the settlement currency. */
export function expenseEvent(expense: ExpenseDto): BalanceEvent {
  const { paid, owed } = convertedBreakdown({
    convertedAmount: BigInt(expense.convertedAmount),
    payers: expense.payers.map((p) => ({ personId: p.personId, amount: BigInt(p.amount) })),
    splits: expense.splits.map((s) => ({ personId: s.personId, amount: BigInt(s.amount) })),
  });
  return { kind: "expense", id: expense.id, paid, owed };
}

export function settlementEvent(settlement: SettlementDto): BalanceEvent {
  return {
    kind: "settlement",
    id: settlement.id,
    fromPersonId: settlement.fromPersonId,
    toPersonId: settlement.toPersonId,
    amount: BigInt(settlement.convertedAmount),
  };
}

// ---------------------------------------------------------------------------
// Patching the caches
// ---------------------------------------------------------------------------

/**
 * Inserts a row into every cached page of a ledger, in date order.
 *
 * Only the first page is a candidate: the list is newest-first, and an entry
 * dated today belongs at the top. An entry backdated past the end of what is
 * loaded is simply left to the refetch - inserting it at the bottom of page one
 * would put it in the wrong place and inserting it nowhere is honest.
 */
function insertIntoLedger(
  data: { pages: { items: LedgerEntry[]; nextCursor: string | null }[]; pageParams: unknown[] },
  entry: LedgerEntry,
) {
  const [firstPage, ...rest] = data.pages;
  if (!firstPage) return { ...data, pages: [{ items: [entry], nextCursor: null }] };

  const items = [...firstPage.items];
  // (date, id) descending - the same order the server pages on, so the row does
  // not jump position when the refetch replaces it. See `server/cursor.ts`.
  const at = items.findIndex(
    (item) => item.date < entry.date || (item.date === entry.date && item.id < entry.id),
  );
  items.splice(at === -1 ? items.length : at, 0, entry);

  return { ...data, pages: [{ ...firstPage, items }, ...rest] };
}

function snapshotOf(client: QueryClient, patterns: readonly (readonly unknown[])[]): Snapshot {
  const entries: [readonly unknown[], unknown][] = [];
  for (const pattern of patterns) {
    for (const [key, value] of client.getQueriesData({ queryKey: pattern })) {
      entries.push([key, value]);
    }
  }
  return { entries };
}

export function rollback(client: QueryClient, snapshot: Snapshot | undefined) {
  if (!snapshot) return;
  for (const [key, value] of snapshot.entries) client.setQueryData(key, value);
}

/** The keys a ledger write can touch. */
function affectedKeys(groupId: string | null | undefined): readonly (readonly unknown[])[] {
  return groupId
    ? [keys.dashboard, keys.group(groupId), ["group", groupId, "ledger"]]
    : [keys.dashboard, keys.friends, ["friend"]];
}

/**
 * Writes an expense or settlement into every cache that shows it.
 *
 * Returns the snapshot to restore if the mutation fails. Direct (non-group)
 * writes only patch the dashboard totals: the friend detail screen carries its
 * own aggregate shape, and getting that subtly wrong for 200ms is worse than
 * letting it refetch.
 */
export function applyOptimisticWrite(
  client: QueryClient,
  {
    groupId,
    currency,
    entry,
    event,
    meId,
  }: {
    groupId: string | null | undefined;
    /**
     * The currency the *event* is denominated in - a group's settlement
     * currency, or the expense's own for a direct one. Not the viewer's default:
     * a euro dinner with a friend belongs in the euro total however the viewer's
     * profile is set.
     */
    currency: string;
    entry: LedgerEntry;
    event: BalanceEvent;
    meId: string;
  },
): Snapshot {
  const snapshot = snapshotOf(client, affectedKeys(groupId));

  if (groupId) {
    client.setQueriesData<{
      pages: { items: LedgerEntry[]; nextCursor: string | null }[];
      pageParams: unknown[];
    }>({ queryKey: ["group", groupId, "ledger"] }, (data) =>
      data ? insertIntoLedger(data, entry) : data,
    );

    client.setQueryData<GroupDetailDto>(keys.group(groupId), (group) => {
      if (!group) return group;
      const next = applyEvent(sheetFromDto(group.balances), event);
      return {
        ...group,
        balances: sheetToDto(next, group.balances.currency),
        yourNet: (next.net.get(meId) ?? 0n).toString(),
        totalSpend: next.totalSpend.toString(),
      };
    });
  }

  client.setQueryData<DashboardPayload>(keys.dashboard, (dashboard) => {
    if (!dashboard) return dashboard;

    // The viewer's own delta, which is all the home screen shows. Derived from
    // the same event, so it cannot disagree with the group screen.
    const delta =
      event.kind === "expense"
        ? event.paid
            .filter((p) => p.personId === meId)
            .reduce((total, p) => total + p.amount, 0n) -
          event.owed
            .filter((o) => o.personId === meId)
            .reduce((total, o) => total + o.amount, 0n)
        : event.fromPersonId === meId
          ? event.amount
          : event.toPersonId === meId
            ? -event.amount
            : 0n;

    if (delta === 0n) return dashboard;

    const group = groupId ? dashboard.groups.find((g) => g.id === groupId) : undefined;

    const totals = { ...dashboard.totals };
    // An archived group is excluded from the headline totals server-side, so
    // adding to them here would produce a number the refetch then takes away.
    // Its own card still updates, which is what somebody filing a late expense
    // against a closed trip is looking at.
    if (!group?.archivedAt) {
      const updated = BigInt(totals[currency] ?? "0") + delta;
      if (updated === 0n) delete totals[currency];
      else totals[currency] = updated.toString();
    }

    return {
      ...dashboard,
      totals,
      groups: dashboard.groups.map((summary) =>
        summary.id === groupId
          ? { ...summary, yourNet: (BigInt(summary.yourNet) + delta).toString() }
          : summary,
      ),
    };
  });

  return snapshot;
}
