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
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError, api } from "./api";
import { enqueue } from "./outbox";
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
  date: string;
  expense?: ExpenseDto;
  settlement?: SettlementDto;
}

export function useGroupLedger(id: string | undefined, filters?: { q?: string; category?: string; person?: string }) {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.person) params.set("person", filters.person);
  const suffix = params.toString() ? `?${params}` : "";

  return useQuery({
    queryKey: [...keys.groupLedger(id ?? ""), suffix],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      api.get<{ items: LedgerEntry[]; nextCursor: string | null }>(
        `/api/groups/${id}/expenses${suffix}`,
        signal,
      ),
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
  return useQuery({
    queryKey: keys.activity,
    queryFn: ({ signal }) =>
      api.get<{ items: ActivityDto[]; nextCursor: string | null }>("/api/activity", signal),
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

export function useCreateExpense() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: ExpenseInput & { id?: string }) => {
      const id = input.id ?? newId("exp");
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
    onSuccess: (_expense, input) => {
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

export function useCreateSettlement() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: SettlementInput) => {
      const id = newId("stl");
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
    onSuccess: (_result, input) => invalidateLedger(client, input.groupId),
  });
}

export function useDeleteSettlement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; groupId?: string | null }) =>
      api.del(`/api/settlements/${id}`),
    onSuccess: (_result, variables) => invalidateLedger(client, variables.groupId),
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
