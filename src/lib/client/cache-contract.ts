"use client";

/**
 * What the query cache is keyed by, and the shapes stored under those keys.
 *
 * This module exists to break a cycle rather than to group related ideas.
 * `queries.ts` owns the hooks and `optimistic.ts` owns the cache edits those
 * hooks apply, so each needs the other: the hooks call the writers, and the
 * writers need the keys and the stored shapes to write against. Left in
 * `queries.ts`, that is a genuine import cycle — the kind that resolves fine
 * under a bundler right up until module evaluation order changes and one side
 * sees `undefined` where it expected a key factory.
 *
 * Both now depend on this, and this depends on neither.
 */

import type { DashboardDto, ExpenseDto, PersonDto, SettlementDto } from "@/lib/types";

export const keys = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  people: ["people"] as const,
  group: (id: string) => ["group", id] as const,
  groupLedger: (id: string) => ["group", id, "ledger"] as const,
  groupStats: (id: string) => ["group", id, "stats"] as const,
  friends: ["friends"] as const,
  friend: (id: string) => ["friend", id] as const,
  activity: ["activity"] as const,
  expense: (id: string) => ["expense", id] as const,
  comments: (id: string) => ["expense", id, "comments"] as const,
  recurrences: ["recurrences"] as const,
  budgets: ["budgets"] as const,
  search: (q: string) => ["search", q] as const,
};

export interface DashboardPayload extends DashboardDto {
  people: PersonDto[];
}

export interface LedgerEntry {
  kind: "expense" | "settlement";
  /** Unique across both tables; the second half of the pagination key. */
  id: string;
  date: string;
  expense?: ExpenseDto;
  settlement?: SettlementDto;
  /**
   * Written by the client before the server has confirmed it. Never sent by the
   * API - the refetch that follows replaces the row and the flag with it.
   */
  pending?: boolean;
}

/** One page of a keyset-paginated feed. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
