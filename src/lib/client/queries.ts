"use client";

/**
 * Data hooks.
 *
 * Everything the app renders comes from here. Two conventions:
 *
 *  - **Mutations are optimistic where the outcome is knowable.** Adding an
 *    expense updates the cache before the network round-trip, because we can
 *    compute the new balance ourselves - the server is confirming, not
 *    deciding. Anything whose result we cannot predict waits for the response.
 *
 *  - **A failed mutation queues rather than erroring**, when the failure was
 *    the network. The optimistic state stays on screen and the outbox retries.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError, api } from "./api";
import { enqueue } from "./outbox";
import {
  applyOptimisticWrite,
  expenseEvent,
  optimisticExpense,
  optimisticSettlement,
  rollback,
  settlementEvent,
  type Snapshot,
} from "./optimistic";
import { newId } from "@/lib/ids";
import type {
  ActivityDto,
  BudgetDto,
  DashboardDto,
  ExpenseDto,
  ExpenseInput,
  FriendDto,
  GroupDetailDto,
  GroupStatsDto,
  MeDto,
  PersonDto,
  RecurrenceDto,
  SettlementDto,
  SettlementInput,
} from "@/lib/types";

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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface DashboardPayload extends DashboardDto {
  people: PersonDto[];
}

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: ({ signal }) => api.get<DashboardPayload>("/api/dashboard", signal),
    // Balances shift whenever anyone in the group adds anything, so a stale
    // window longer than a few seconds shows people the wrong number.
    staleTime: 5_000,
    retry: (count, error) => !(error instanceof ApiError && error.isUnauthorized) && count < 2,
  });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: keys.group(id ?? ""),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api.get<{ group: GroupDetailDto }>(`/api/groups/${id}`, signal).then((r) => r.group),
    staleTime: 5_000,
  });
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

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The group ledger, paged.
 *
 * Infinite rather than a single fetch because the server only ever returns a
 * page: without this the app silently showed the first forty entries and
 * nothing else, which on an active group looks exactly like data loss.
 */
export function useGroupLedger(
  id: string | undefined,
  filters?: { q?: string; category?: string; person?: string },
) {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.person) params.set("person", filters.person);
  const base = params.toString();

  return useInfiniteQuery({
    queryKey: [...keys.groupLedger(id ?? ""), base],
    enabled: Boolean(id),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const next = new URLSearchParams(base);
      if (pageParam) next.set("before", pageParam);
      const suffix = next.toString() ? `?${next}` : "";
      return api.get<Page<LedgerEntry>>(`/api/groups/${id}/expenses${suffix}`, signal);
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 5_000,
  });
}

export function useGroupStats(id: string | undefined) {
  return useQuery({
    queryKey: keys.groupStats(id ?? ""),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api.get<{ stats: GroupStatsDto }>(`/api/groups/${id}/stats`, signal).then((r) => r.stats),
    staleTime: 30_000,
  });
}

export function useActivity() {
  return useInfiniteQuery({
    queryKey: keys.activity,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      api.get<Page<ActivityDto>>(
        pageParam ? `/api/activity?before=${encodeURIComponent(pageParam)}` : "/api/activity",
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
  });
}

export function useFriends() {
  return useQuery({
    queryKey: keys.friends,
    queryFn: ({ signal }) =>
      api.get<{ friends: FriendDto[] }>("/api/friends", signal).then((r) => r.friends),
    staleTime: 10_000,
  });
}

export interface FriendDetail {
  person: PersonDto;
  balances: { currency: string; net: string }[];
  items: LedgerEntry[];
  sharedGroups: { id: string; name: string; emoji: string; currency: string; color: string }[];
}

export function useFriend(id: string | undefined) {
  return useQuery({
    queryKey: keys.friend(id ?? ""),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<FriendDetail>(`/api/friends/${id}`, signal),
    staleTime: 5_000,
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: keys.expense(id ?? ""),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api.get<{ expense: ExpenseDto }>(`/api/expenses/${id}`, signal).then((r) => r.expense),
  });
}

export function useComments(expenseId: string | undefined) {
  return useQuery({
    queryKey: keys.comments(expenseId ?? ""),
    enabled: Boolean(expenseId),
    queryFn: ({ signal }) =>
      api
        .get<{ comments: { id: string; personId: string; body: string; createdAt: string }[] }>(
          `/api/expenses/${expenseId}/comments`,
          signal,
        )
        .then((r) => r.comments),
  });
}

export function useRecurrences(groupId?: string) {
  const suffix = groupId ? `?groupId=${groupId}` : "";
  return useQuery({
    queryKey: [...keys.recurrences, groupId ?? "all"],
    queryFn: ({ signal }) =>
      api
        .get<{ recurrences: RecurrenceDto[] }>(`/api/recurrences${suffix}`, signal)
        .then((r) => r.recurrences),
    staleTime: 60_000,
  });
}

export function useBudgets() {
  return useQuery({
    queryKey: keys.budgets,
    queryFn: ({ signal }) =>
      api.get<{ budgets: BudgetDto[] }>("/api/budgets", signal).then((r) => r.budgets),
    staleTime: 60_000,
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: keys.search(query),
    enabled: query.trim().length >= 2,
    queryFn: ({ signal }) =>
      api.get<{ items: ExpenseDto[]; groups: { id: string; name: string; emoji: string }[] }>(
        `/api/search?q=${encodeURIComponent(query)}`,
        signal,
      ),
    staleTime: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * After a write, anything showing a balance is wrong.
 *
 * Rather than trying to work out precisely which queries a given mutation
 * touched - which is exactly the sort of bookkeeping that rots and leaves users
 * staring at a stale number - everything balance-shaped is invalidated. These
 * are small, local requests.
 */
function invalidateLedger(client: QueryClient, groupId?: string | null) {
  void client.invalidateQueries({ queryKey: keys.dashboard });
  void client.invalidateQueries({ queryKey: keys.activity });
  void client.invalidateQueries({ queryKey: keys.friends });
  if (groupId) {
    void client.invalidateQueries({ queryKey: keys.group(groupId) });
    void client.invalidateQueries({ queryKey: ["group", groupId, "ledger"] });
    void client.invalidateQueries({ queryKey: keys.groupStats(groupId) });
  } else {
    void client.invalidateQueries({ queryKey: ["friend"] });
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Files an expense.
 *
 * Optimistic: the row and every balance it moves are written to the cache
 * before the request goes out, and the mutation carries the snapshot needed to
 * undo that if the server refuses. The id is generated here rather than by the
 * database, which is what makes the optimistic row and the confirmed row the
 * same row - and what makes an offline replay idempotent.
 *
 * Being offline is not a failure: the mutation queues and resolves successfully,
 * so the optimistic state stays exactly where it is.
 */
export function useCreateExpense(meId?: string) {
  const client = useQueryClient();

  return useMutation<
    ExpenseDto | null,
    Error,
    ExpenseInput & { id?: string },
    { snapshot?: Snapshot }
  >({
    mutationFn: async (input) => {
      const id = writeId(input, "exp");
      const body = { ...input, id };

      try {
        const result = await api.post<{ expense: ExpenseDto }>("/api/expenses", body);
        return result.expense;
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          // Queue and report success: the expense is real to the user now, and
          // the id guarantees it will not be filed twice when it syncs.
          await enqueue({
            id,
            path: "/api/expenses",
            method: "POST",
            body,
            label: input.description || "Expense",
          });
          return null;
        }
        throw error;
      }
    },

    onMutate: async (input) => {
      // Without a viewer id there is no way to say whose balance moved, so the
      // write stays pessimistic rather than guessing.
      if (!meId) return {};
      const id = writeId(input, "exp");

      await client.cancelQueries({ queryKey: keys.dashboard });
      if (input.groupId) {
        await client.cancelQueries({ queryKey: ["group", input.groupId] });
      }

      const group = input.groupId
        ? client.getQueryData<GroupDetailDto>(keys.group(input.groupId))
        : undefined;

      const currency = group?.currency ?? input.currency;
      const expense = optimisticExpense({ ...input, id }, meId, currency);

      return {
        snapshot: applyOptimisticWrite(client, {
          groupId: input.groupId,
          currency,
          entry: {
            kind: "expense",
            id: expense.id,
            date: expense.date,
            expense,
            pending: true,
          },
          event: expenseEvent(expense),
          meId,
        }),
      };
    },

    onError: (_error, _input, context) => rollback(client, context?.snapshot),

    // A null result means the write is sitting in the outbox, not on the
    // server. Refetching then would replace the optimistic row with a server
    // response that does not contain it yet, and the expense would vanish from
    // the screen while still queued. The flush invalidates once it lands.
    onSettled: (expense, error, input) => {
      if (expense === null && !error) return;
      invalidateLedger(client, input.groupId);
    },
  });
}

export function useUpdateExpense(expenseId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      try {
        const result = await api.patch<{ expense: ExpenseDto }>(
          `/api/expenses/${expenseId}`,
          input,
        );
        return result.expense;
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          await enqueue({
            id: `edit_${expenseId}_${Date.now()}`,
            path: `/api/expenses/${expenseId}`,
            method: "PATCH",
            body: input,
            label: `Edit to ${input.description}`,
          });
          return null;
        }
        throw error;
      }
    },
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: keys.expense(expenseId) });
      invalidateLedger(client, input.groupId);
    },
  });
}

export function useDeleteExpense() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; groupId?: string | null }) => {
      try {
        await api.del(`/api/expenses/${id}`);
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          await enqueue({
            id: `del_${id}`,
            path: `/api/expenses/${id}`,
            method: "DELETE",
            body: undefined,
            label: "Deleted expense",
          });
          return;
        }
        throw error;
      }
    },
    onSuccess: (_result, variables) => invalidateLedger(client, variables.groupId),
  });
}

/** Records a payment, with the same optimistic treatment as an expense. */
export function useCreateSettlement(meId?: string) {
  const client = useQueryClient();

  return useMutation<SettlementDto | null, Error, SettlementInput, { snapshot?: Snapshot }>({
    mutationFn: async (input) => {
      const id = writeId(input, "stl");
      const body = { ...input, id };
      try {
        const result = await api.post<{ settlement: SettlementDto }>("/api/settlements", body);
        return result.settlement;
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          await enqueue({
            id,
            path: "/api/settlements",
            method: "POST",
            body,
            label: "Payment",
          });
          return null;
        }
        throw error;
      }
    },

    onMutate: async (input) => {
      if (!meId) return {};

      await client.cancelQueries({ queryKey: keys.dashboard });
      if (input.groupId) {
        await client.cancelQueries({ queryKey: ["group", input.groupId] });
      }

      const group = input.groupId
        ? client.getQueryData<GroupDetailDto>(keys.group(input.groupId))
        : undefined;

      const currency = group?.currency ?? input.currency;
      const settlement = optimisticSettlement(
        { ...input, id: writeId(input, "stl") },
        meId,
        currency,
      );

      return {
        snapshot: applyOptimisticWrite(client, {
          groupId: input.groupId,
          currency,
          entry: {
            kind: "settlement",
            id: settlement.id,
            date: settlement.date,
            settlement,
            pending: true,
          },
          event: settlementEvent(settlement),
          meId,
        }),
      };
    },

    onError: (_error, _input, context) => rollback(client, context?.snapshot),
    // As above: a queued write must not be reconciled against a server that has
    // not seen it.
    onSettled: (settlement, error, input) => {
      if (settlement === null && !error) return;
      invalidateLedger(client, input.groupId);
    },
  });
}

/**
 * One id per submission, stable across `onMutate` and `mutationFn`.
 *
 * React Query runs those in that order against the same variables object, so
 * the id is minted once and stashed on it. Generating one in each place would
 * file the optimistic row under an id the server never sees, leaving a
 * duplicate on screen until the refetch cleared it - and would break the
 * idempotency the offline outbox depends on.
 */
function writeId<T extends { id?: string }>(input: T, prefix: string): string {
  if (!input.id) input.id = newId(prefix);
  return input.id;
}

export function useDeleteSettlement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; groupId?: string | null }) =>
      api.del(`/api/settlements/${id}`),
    onSuccess: (_result, variables) => invalidateLedger(client, variables.groupId),
  });
}

/**
 * Removes a receipt from an expense.
 *
 * Not queued for offline replay: the photo is still visible until the request
 * lands, and pretending a removal happened while the bytes are still on the
 * server is the wrong way to fail for something whose whole purpose is getting
 * a card number off a shared screen.
 */
export function useDeleteAttachment(expenseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; groupId?: string | null }) =>
      api.del(`/api/attachments/${id}`),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: keys.expense(expenseId) });
      invalidateLedger(client, variables.groupId);
    },
  });
}

export function useAddComment(expenseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post(`/api/expenses/${expenseId}/comments`, { body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.comments(expenseId) });
      void client.invalidateQueries({ queryKey: keys.expense(expenseId) });
      void client.invalidateQueries({ queryKey: keys.activity });
    },
  });
}

/**
 * Sets or clears a budget.
 *
 * PUT rather than POST because a budget is identified by its *scope* - the
 * person, group, category and period together - not by a row id. Setting one
 * twice for the same scope replaces it, and an amount of zero removes it, which
 * is what the delete affordance sends.
 */
export function useSetBudget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      groupId?: string | null;
      categoryId?: string | null;
      amount: string;
      currency: string;
      period: BudgetDto["period"];
    }) => api.put("/api/budgets", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.budgets });
    },
  });
}

export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      kind: string;
      emoji: string;
      color: string;
      currency: string;
      simplifyDebts: boolean;
      placeholderNames: string[];
    }) => api.post<{ group: { id: string } }>("/api/groups", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useUpdateGroup(groupId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.patch(`/api/groups/${groupId}`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.group(groupId) });
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useAddMember(groupId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; inviteCode?: string }) =>
      api.post<{ member: PersonDto }>(`/api/groups/${groupId}/members`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.group(groupId) });
      void client.invalidateQueries({ queryKey: keys.people });
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useRemoveMember(groupId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) =>
      api.del(`/api/groups/${groupId}/members/${personId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.group(groupId) });
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Pick<MeDto, "displayName" | "avatarColor" | "avatarEmoji" | "defaultCurrency">>) =>
      api.patch<{ me: MeDto }>("/api/identity", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dashboard });
      void client.invalidateQueries({ queryKey: keys.people });
    },
  });
}

export function useMarkGroupRead(groupId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/groups/${groupId}/read`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dashboard });
      void client.invalidateQueries({ queryKey: keys.activity });
    },
  });
}
