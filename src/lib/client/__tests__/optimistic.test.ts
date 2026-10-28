import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  applyOptimisticWrite,
  expenseEvent,
  optimisticExpense,
  revertOptimisticWrite,
  showQueuedDelete,
  showQueuedEdit,
  type Reversal,
} from "../optimistic";
import { keys, type DashboardPayload, type LedgerEntry } from "../cache-contract";
import { computeBalances, type BalanceEvent } from "@/lib/balances";
import type { ExpenseDto, ExpenseInput, GroupDetailDto } from "@/lib/types";

/**
 * Reverting one optimistic write must not disturb another.
 *
 * This is the failure the previous snapshot-based rollback had, and it is
 * invisible in any single-mutation test: restoring a whole cached value is
 * indistinguishable from a correct undo right up until two writes overlap,
 * which is exactly what happens when somebody enters two expenses quickly on a
 * bad connection - the case the optimistic layer exists to serve.
 */

const GROUP = "g1";
const ME = "p_me";
const THEM = "p_them";

function seed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  client.setQueryData<GroupDetailDto>(keys.group(GROUP), {
    id: GROUP,
    name: "Flat",
    kind: "home",
    emoji: "🏠",
    color: "iris",
    currency: "USD",
    simplifyDebts: true,
      defaultSplit: null,
    inviteCode: "a-b-1",
    archivedAt: null,
    memberCount: 2,
    members: [],
    yourNet: "0",
    totalSpend: "0",
    lastActivityAt: null,
    unreadCount: 0,
    balances: { currency: "USD", net: {}, pairwise: [], simplified: [], totalSpend: "0" },
    createdAt: new Date().toISOString(),
  });

  client.setQueryData<DashboardPayload>(keys.dashboard, {
    me: { id: ME } as DashboardPayload["me"],
    totals: {},
    groups: [
      {
        id: GROUP,
        name: "Flat",
        kind: "home",
        emoji: "🏠",
        color: "iris",
        currency: "USD",
        simplifyDebts: true,
      defaultSplit: null,
        inviteCode: "a-b-1",
        archivedAt: null,
        memberCount: 2,
        members: [],
        yourNet: "0",
        totalSpend: "0",
        lastActivityAt: null,
        unreadCount: 0,
      },
    ],
    friends: [],
    unreadActivityCount: 0,
    people: [],
  });

  client.setQueryData(keys.groupLedger(GROUP), {
    pages: [{ items: [] as LedgerEntry[], nextCursor: null }],
    pageParams: [null],
  });

  return client;
}

/** `me` pays `total`, split evenly between the two members. */
function write(client: QueryClient, id: string, total: bigint): Reversal {
  const half = total / 2n;
  const event: BalanceEvent = {
    kind: "expense",
    id,
    paid: [{ personId: ME, amount: total }],
    owed: [
      { personId: ME, amount: half },
      { personId: THEM, amount: total - half },
    ],
  };

  const entry: LedgerEntry = {
    kind: "expense",
    id,
    date: new Date().toISOString(),
    expense: { id, description: id } as LedgerEntry["expense"],
    pending: true,
  };

  return applyOptimisticWrite(client, {
    groupId: GROUP,
    currency: "USD",
    entry,
    event,
    meId: ME,
  });
}

const ledgerIds = (client: QueryClient) =>
  client
    .getQueryData<{ pages: { items: LedgerEntry[] }[] }>(keys.groupLedger(GROUP))
    ?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? [];

const yourNet = (client: QueryClient) =>
  client.getQueryData<GroupDetailDto>(keys.group(GROUP))?.yourNet;

const total = (client: QueryClient) =>
  client.getQueryData<DashboardPayload>(keys.dashboard)?.totals.USD;

describe("optimistic reversal", () => {
  it("puts the caches back exactly when a lone write fails", () => {
    const client = seed();
    const reversal = write(client, "e1", 1000n);

    expect(ledgerIds(client)).toEqual(["e1"]);
    expect(yourNet(client)).toBe("500");

    revertOptimisticWrite(client, reversal);

    expect(ledgerIds(client)).toEqual([]);
    expect(yourNet(client)).toBe("0");
    expect(total(client)).toBeUndefined();
  });

  it("leaves a concurrent write alone when the first one fails", () => {
    const client = seed();
    const first = write(client, "e1", 1000n);
    write(client, "e2", 400n); // still in flight

    expect(ledgerIds(client)).toEqual(["e2", "e1"]);
    expect(yourNet(client)).toBe("700"); // 500 + 200

    revertOptimisticWrite(client, first);

    // The row the user is still watching survives, and the balance is exactly
    // what the second write alone would have produced.
    expect(ledgerIds(client)).toEqual(["e2"]);
    expect(yourNet(client)).toBe("200");
    expect(total(client)).toBe("200");
  });

  it("reverses in any order and lands back at zero", () => {
    const client = seed();
    const first = write(client, "e1", 1000n);
    const second = write(client, "e2", 400n);

    revertOptimisticWrite(client, second);
    revertOptimisticWrite(client, first);

    expect(ledgerIds(client)).toEqual([]);
    expect(yourNet(client)).toBe("0");
    expect(total(client)).toBeUndefined();
  });

  it("does nothing when there is nothing to reverse", () => {
    const client = seed();
    expect(() => revertOptimisticWrite(client, undefined)).not.toThrow();
  });
});

/**
 * Edits and deletes queued while offline show at once (finding 21): the row
 * changes or goes, and every balance on screen is what the server will work
 * out once the change is sent.
 */
describe("a change queued offline", () => {
  const input = (description: string, total: number): ExpenseInput => ({
    groupId: GROUP,
    description,
    amount: String(total),
    currency: "USD",
    splitMode: "EQUAL",
    payers: [{ personId: ME, amount: String(total) }],
    splits: [
      { personId: ME, amount: String(total / 2) },
      { personId: THEM, amount: String(total / 2) },
    ],
  });
  const add = (client: QueryClient, id: string, description: string, total: number) => {
    const expense = { ...optimisticExpense({ ...input(description, total), id }, ME, "USD"), updatedAt: "2026-10-28T10:00:00.000Z" };
    applyOptimisticWrite(client, {
      groupId: GROUP,
      currency: "USD",
      entry: { kind: "expense", id, date: expense.date, expense },
      event: expenseEvent(expense),
      meId: ME,
    });
    return expense;
  };
  const shown = (client: QueryClient) => ({
    rows: client
      .getQueryData<{ pages: { items: LedgerEntry[] }[] }>(keys.groupLedger(GROUP))!
      .pages.flatMap((p) => p.items.map((i) => i.expense?.description)),
    net: client.getQueryData<GroupDetailDto>(keys.group(GROUP))!.balances.net,
    yourNet: client.getQueryData<GroupDetailDto>(keys.group(GROUP))!.yourNet,
    home: client.getQueryData<DashboardPayload>(keys.dashboard)!.totals.USD,
  });
  const serverSays = (...totals: number[]) => {
    const sheet = computeBalances(
      totals.map((t, i) => ({
        kind: "expense" as const,
        id: `e${i}`,
        paid: [{ personId: ME, amount: BigInt(t) }],
        owed: [
          { personId: ME, amount: BigInt(t / 2) },
          { personId: THEM, amount: BigInt(t / 2) },
        ],
      })),
    );
    return Object.fromEntries([...sheet.net].filter(([, v]) => v !== 0n).map(([k, v]) => [k, v.toString()]));
  };
  const nonZero = (net: Record<string, string>) => Object.fromEntries(Object.entries(net).filter(([, v]) => v !== "0"));

  it("takes a deleted expense off the list and out of every balance", () => {
    const client = seed();
    const dinner = add(client, "e_dinner", "Dinner", 3000);
    add(client, "e_taxi", "Taxi", 1000);
    showQueuedDelete(client, dinner, ME);
    const now = shown(client);
    expect(now.rows).toEqual(["Taxi"]);
    expect(nonZero(now.net)).toEqual(serverSays(1000));
    expect(now.yourNet).toBe("500");
    expect(now.home).toBe("500");
  });

  it("swaps an edited expense in place, keeping the version it was built on", () => {
    const client = seed();
    add(client, "e_dinner", "Dinner", 3000);
    const taxi = add(client, "e_taxi", "Taxi", 1000);
    showQueuedEdit(client, taxi, input("Taxi home", 2000), ME);
    const now = shown(client);
    expect(now.rows.sort()).toEqual(["Dinner", "Taxi home"]);
    expect(nonZero(now.net)).toEqual(serverSays(3000, 2000));
    expect(now.yourNet).toBe("2500");
    expect(now.home).toBe("2500");
    const detail = client.getQueryData<ExpenseDto>(keys.expense("e_taxi"))!;
    expect(detail.description).toBe("Taxi home");
    expect(detail.updatedAt).toBe(taxi.updatedAt);
  });

  it("can edit the same expense twice offline", () => {
    const client = seed();
    const taxi = add(client, "e_taxi", "Taxi", 1000);
    showQueuedEdit(client, taxi, input("Taxi home", 2000), ME);
    const edited = client.getQueryData<ExpenseDto>(keys.expense("e_taxi"))!;
    showQueuedEdit(client, edited, input("Taxi, shared", 4000), ME);
    const now = shown(client);
    expect(now.rows).toEqual(["Taxi, shared"]);
    expect(nonZero(now.net)).toEqual(serverSays(4000));
  });
});
