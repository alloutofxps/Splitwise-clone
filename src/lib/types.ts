/**
 * The wire contract between the API and the client.
 *
 * Money is always a decimal *string* of minor units (`"1250"` = 12.50 USD) so
 * it survives JSON without float rounding. Dates are ISO strings. Both are
 * converted at the edges of the client data layer, never in components.
 */

import type { SplitMode } from "./split";

export type { SplitMode };

export interface PersonDto {
  id: string;
  displayName: string;
  avatarColor: string;
  avatarEmoji: string | null;
  /** True while this is a placeholder nobody has claimed yet. */
  isGhost: boolean;
}

export interface MeDto extends PersonDto {
  defaultCurrency: string;
  inviteCode: string;
  createdAt: string;
  paymentMethods: PaymentMethodDto[];
}

export interface PaymentMethodDto {
  id: string;
  kind: string;
  label: string | null;
  value: string;
  sortOrder: number;
}

export interface GroupSummaryDto {
  id: string;
  name: string;
  kind: string;
  emoji: string;
  color: string;
  currency: string;
  simplifyDebts: boolean;
  inviteCode: string;
  archivedAt: string | null;
  memberCount: number;
  members: PersonDto[];
  /** Viewer's net position in this group, in the group currency. */
  yourNet: string;
  /** Total spent by the whole group, all time. */
  totalSpend: string;
  lastActivityAt: string | null;
  unreadCount: number;
}

export interface GroupDetailDto extends GroupSummaryDto {
  balances: BalanceSheetDto;
  createdAt: string;
}

export interface DebtEdgeDto {
  fromPersonId: string;
  toPersonId: string;
  amount: string;
}

export interface BalanceSheetDto {
  currency: string;
  /** Person id to net position; positive means the group owes them. */
  net: Record<string, string>;
  /** Literal who-owes-whom. */
  pairwise: DebtEdgeDto[];
  /** Fewest transfers reaching the same net position. */
  simplified: DebtEdgeDto[];
  totalSpend: string;
}

export interface ExpensePayerDto {
  personId: string;
  amount: string;
}

export interface ExpenseSplitDto {
  personId: string;
  amount: string;
  included: boolean;
  weight: number | null;
  percent: number | null;
  adjustment: string | null;
}

export interface ExpenseItemDto {
  id: string;
  name: string;
  amount: string;
  quantity: number;
  sortOrder: number;
  participantIds: string[];
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
}

export interface ExpenseDto {
  id: string;
  groupId: string | null;
  description: string;
  notes: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  convertedAmount: string;
  splitMode: SplitMode;
  categoryId: string;
  date: string;
  createdByPersonId: string;
  recurrenceId: string | null;
  createdAt: string;
  updatedAt: string;
  payers: ExpensePayerDto[];
  splits: ExpenseSplitDto[];
  items: ExpenseItemDto[];
  attachments: AttachmentDto[];
  commentCount: number;
  /** Viewer's stake: positive if they are up on this expense. */
  yourShare: string;
  yourNet: string;
  /** The currency `convertedAmount` and `yourNetConverted` are in. */
  settlementCurrency: string;
  /** `yourNet` in the settlement currency, apportioned so the parts still sum. */
  yourNetConverted: string;
}

export interface SettlementDto {
  id: string;
  groupId: string | null;
  fromPersonId: string;
  toPersonId: string;
  amount: string;
  currency: string;
  convertedAmount: string;
  date: string;
  note: string | null;
  method: string | null;
  createdByPersonId: string;
  createdAt: string;
}

export interface CommentDto {
  id: string;
  expenseId: string;
  personId: string;
  body: string;
  createdAt: string;
}

export interface ActivityDto {
  id: string;
  groupId: string | null;
  groupName: string | null;
  groupEmoji: string | null;
  type: string;
  actorPersonId: string;
  expenseId: string | null;
  settlementId: string | null;
  /** Set only for entries addressed to one person, such as a nudge. */
  targetPersonId: string | null;
  data: ActivityData;
  createdAt: string;
  isUnread: boolean;
}

export interface ActivityData {
  description?: string;
  amount?: string;
  currency?: string;
  /** Effect on the viewer, filled in per-request. */
  yourNet?: string;
  otherPersonId?: string;
  groupName?: string;
  changes?: string[];
  [key: string]: unknown;
}

export interface RecurrenceDto {
  id: string;
  groupId: string | null;
  description: string;
  amount: string;
  currency: string;
  categoryId: string;
  splitMode: SplitMode;
  payers: ExpensePayerDto[];
  splits: ExpenseSplitDto[];
  notes: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: string;
  nextRunAt: string;
  lastRunAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdByPersonId: string;
}

export const RECURRENCE_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export interface FriendDto {
  person: PersonDto;
  /**
   * Where the two of you stand in total, per currency — every shared group
   * plus the direct ledger. Positive means they owe you.
   *
   * Per currency because two people share no default currency, and netting a
   * euro against a rupee would be an invention. Across ledgers because this is
   * the answer to "how do I stand with this person", and the direct ledger
   * alone is not: it once reported "settled up" for somebody who owed two
   * thousand euros in the only group the two of them shared.
   */
  net: Record<string, string>;
  /**
   * The direct, non-group ledger only.
   *
   * Kept apart from `net` because settling is per-ledger and the detail view
   * has to be able to say which part of the total lives where.
   */
  directNet: Record<string, string>;
  /**
   * Where that total comes from, ledger by ledger, biggest first.
   *
   * Carried on the list row and not just the detail page: a single number with
   * no account of itself is the thing people distrust, and "you owe €96,14"
   * reads very differently beside the three places it came from.
   */
  ledgers: SharedLedgerDto[];
  sharedGroupIds: string[];
  lastActivityAt: string | null;
}

/** One ledger two people share, and where they stand in it. */
export interface SharedLedgerDto {
  /** `null` for the direct, non-group ledger. */
  groupId: string | null;
  name: string | null;
  emoji: string | null;
  currency: string;
  /** Positive: they owe you. Negative: you owe them. Minor units of `currency`. */
  net: string;
}

export interface BudgetDto {
  id: string;
  groupId: string | null;
  categoryId: string | null;
  amount: string;
  currency: string;
  period: "WEEKLY" | "MONTHLY" | "YEARLY";
  /** Spent so far in the current period, viewer's share only. */
  spent: string;
}

export interface CategoryTotalDto {
  categoryId: string;
  total: string;
  yourShare: string;
  count: number;
}

export interface MonthTotalDto {
  /** "2026-08" */
  month: string;
  total: string;
  yourShare: string;
}

export interface GroupStatsDto {
  currency: string;
  totalSpend: string;
  yourTotalShare: string;
  yourTotalPaid: string;
  expenseCount: number;
  byCategory: CategoryTotalDto[];
  byMonth: MonthTotalDto[];
  byPerson: { personId: string; paid: string; share: string }[];
  largestExpense: ExpenseDto | null;
  averageExpense: string;
}

export interface DashboardDto {
  me: MeDto;
  /** Net per currency across every group and friend. */
  totals: Record<string, string>;
  groups: GroupSummaryDto[];
  friends: FriendDto[];
  unreadActivityCount: number;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  /**
   * For an edit: the `updatedAt` the composer opened with, so the server can
   * refuse a save built on a version somebody has already replaced.
   */
  expectedUpdatedAt?: string;
  groupId?: string | null;
  /** For a direct expense with no group. */
  friendId?: string | null;
  description: string;
  notes?: string | null;
  amount: string;
  currency: string;
  exchangeRate?: string;
  splitMode: SplitMode;
  categoryId?: string | null;
  date?: string;
  payers: { personId: string; amount: string }[];
  splits: {
    personId: string;
    amount: string;
    included?: boolean;
    weight?: number | null;
    percent?: number | null;
    adjustment?: string | null;
  }[];
  items?: {
    name: string;
    amount: string;
    quantity?: number;
    participantIds: string[];
  }[];
  attachments?: { filename: string; mimeType: string; dataUrl: string }[];
  /**
   * Client-generated row id, so a replayed offline mutation collides on the
   * primary key instead of filing a second copy. Left optional because the
   * mutation hook mints one when the caller does not.
   */
  id?: string;
}

export interface SettlementInput {
  groupId?: string | null;
  fromPersonId: string;
  toPersonId: string;
  amount: string;
  currency: string;
  exchangeRate?: string;
  date?: string;
  note?: string | null;
  method?: string | null;
  /** As on `ExpenseInput`: the client-generated row id. */
  id?: string;
}
