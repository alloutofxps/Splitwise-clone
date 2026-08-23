"use client";

import * as React from "react";
import { Plus, Target, Trash2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Amount, AmountInput } from "../ui/money";
import { Button, EmptyState, Segmented, Skeleton, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { CategoryGlyph } from "../expense/category-glyph";
import { useBudgets, useDashboard, useSetBudget } from "@/lib/client/queries";
import { CATEGORIES, categoryById } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { BudgetDto } from "@/lib/types";

type Period = BudgetDto["period"];

const PERIOD_LABEL: Record<Period, string> = {
  WEEKLY: "this week",
  MONTHLY: "this month",
  YEARLY: "this year",
};

/**
 * Spending budgets.
 *
 * A budget here is a statement about *your own* money: it tracks your share of
 * each expense, not the group's total, so fronting a 400 hotel bill you are a
 * quarter of counts 100. That is the only definition that survives a shared
 * ledger - anything else punishes whoever happens to hold the card.
 *
 * Scope is the identity: a budget is (you, group?, category?, period) rather
 * than a row you edit, so setting the same scope twice replaces it and setting
 * it to zero removes it. That is why the API is a PUT.
 */
export function BudgetsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: budgets, isLoading } = useBudgets();
  const { data: dashboard } = useDashboard();
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    if (!open) setAdding(false);
  }, [open]);

  const groupName = (id: string | null) =>
    id ? (dashboard?.groups.find((group) => group.id === id)?.name ?? "A group") : "All groups";

  return (
    <>
      <Sheet open={open && !adding} onClose={onClose} tall title="Budgets">
        <div className="px-5 pb-6">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-20 w-full rounded-[--radius-lg]" />
              ))}
            </div>
          ) : !budgets || budgets.length === 0 ? (
            <EmptyState
              icon={<Target className="size-6" />}
              title="No budgets yet"
              description="Set a limit on what you spend - on everything, or on one category, or in one group. It counts your share, not the group's total."
              action={
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={() => {
                    haptic();
                    setAdding(true);
                  }}
                >
                  Set a budget
                </Button>
              }
            />
          ) : (
            <>
              <ul className="space-y-2">
                {budgets.map((budget) => (
                  <li key={budget.id}>
                    <BudgetCard budget={budget} scopeLabel={groupName(budget.groupId)} />
                  </li>
                ))}
              </ul>
              <Button
                variant="secondary"
                fullWidth
                className="mt-3"
                icon={<Plus className="size-4" />}
                onClick={() => {
                  haptic();
                  setAdding(true);
                }}
              >
                Add another
              </Button>
            </>
          )}
        </div>
      </Sheet>

      <BudgetEditor open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function BudgetCard({ budget, scopeLabel }: { budget: BudgetDto; scopeLabel: string }) {
  const toast = useToast();
  const setBudget = useSetBudget();

  const limit = BigInt(budget.amount);
  const spent = BigInt(budget.spent);
  // Guarded: a zero budget cannot exist (the API deletes it), but a bad payload
  // should not divide by zero on somebody's account screen.
  const ratio = limit > 0n ? Number((spent * 1000n) / limit) / 1000 : 0;
  const over = spent > limit;
  const category = budget.categoryId ? categoryById(budget.categoryId) : null;

  const remove = async () => {
    try {
      await setBudget.mutateAsync({
        groupId: budget.groupId,
        categoryId: budget.categoryId,
        amount: "0",
        currency: budget.currency,
        period: budget.period,
      });
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "Budget removed" });
    } catch {
      toast({ tone: "error", title: "Could not remove that budget" });
    }
  };

  return (
    <div className="rounded-[--radius-lg] border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[--radius-md]"
          style={
            category
              ? {
                  background: `color-mix(in oklch, var(--avatar-${category.color}) 15%, transparent)`,
                  color: `var(--avatar-${category.color})`,
                }
              : undefined
          }
        >
          {category ? (
            <CategoryGlyph name={category.icon} />
          ) : (
            <Target className="size-[18px] text-subtle" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-text">
            {category ? category.name : "Everything"}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-subtle">
            {scopeLabel} · {PERIOD_LABEL[budget.period]}
          </p>
        </div>

        <button
          onClick={() => void remove()}
          disabled={setBudget.isPending}
          aria-label="Remove this budget"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-negative-soft hover:text-negative-text disabled:opacity-40"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="mt-3">
        {/*
          The bar is decoration; the sentence under it is the information. A
          progress bar alone puts the whole message in a length and a colour,
          which is exactly what a colour-blind reader cannot use.
        */}
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(ratio * 100))}
          aria-label={`${Math.round(ratio * 100)} percent of budget used`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              over ? "bg-negative" : ratio > 0.8 ? "bg-warning" : "bg-positive",
            )}
            style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
          />
        </div>

        <p className="mt-2 text-[13px] text-muted">
          <Amount value={spent} currency={budget.currency} tone="plain" size="sm" /> of{" "}
          {formatMoney(limit, budget.currency)} -{" "}
          {over ? (
            <span className="font-semibold text-negative-text">
              {formatMoney(spent - limit, budget.currency)} over
            </span>
          ) : (
            <span className="font-semibold text-positive-text">
              {formatMoney(limit - spent, budget.currency)} left
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BudgetEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data: dashboard } = useDashboard();
  const setBudget = useSetBudget();

  const [amount, setAmount] = React.useState<bigint | null>(null);
  const [period, setPeriod] = React.useState<Period>("MONTHLY");
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setAmount(null);
      setPeriod("MONTHLY");
      setGroupId(null);
      setCategoryId(null);
    }
  }, [open]);

  const currency = dashboard?.me.defaultCurrency ?? "USD";
  const canSave = (amount ?? 0n) > 0n;

  const save = async () => {
    if (!canSave) return;
    try {
      await setBudget.mutateAsync({
        groupId,
        categoryId,
        amount: (amount ?? 0n).toString(),
        currency,
        period,
      });
      haptic([10, 40, 10]);
      toast({ tone: "success", title: "Budget set" });
      onClose();
    } catch {
      toast({ tone: "error", title: "Could not save that budget" });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="Set a budget"
      footer={
        <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSave}
            loading={setBudget.isPending}
            onClick={() => void save()}
          >
            Save budget
          </Button>
        </div>
      }
    >
      <div className="px-5 pb-6">
        <div className="flex flex-col items-center rounded-[--radius-lg] bg-surface-2 px-4 py-5">
          <AmountInput
            value={amount}
            onChange={setAmount}
            currency={currency}
            size="lg"
            autoFocus
          />
          <p className="mt-1.5 text-[12px] text-subtle">Your share, {PERIOD_LABEL[period]}</p>
        </div>

        <div className="mt-4">
          <SectionLabel>Period</SectionLabel>
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "YEARLY", label: "Yearly" },
            ]}
          />
        </div>

        {dashboard && dashboard.groups.length > 0 ? (
          <div className="mt-4">
            <SectionLabel>Where</SectionLabel>
            <ChipRow>
              <Chip active={groupId === null} onClick={() => setGroupId(null)}>
                All groups
              </Chip>
              {dashboard.groups
                .filter((group) => !group.archivedAt)
                .map((group) => (
                  <Chip
                    key={group.id}
                    active={groupId === group.id}
                    onClick={() => setGroupId(groupId === group.id ? null : group.id)}
                  >
                    <span aria-hidden>{group.emoji}</span>
                    {group.name}
                  </Chip>
                ))}
            </ChipRow>
          </div>
        ) : null}

        <div className="mt-4">
          <SectionLabel>What</SectionLabel>
          <ChipRow wrap>
            <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
              Everything
            </Chip>
            {CATEGORIES.map((category) => (
              <Chip
                key={category.id}
                active={categoryId === category.id}
                onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
              >
                <span style={{ color: `var(--avatar-${category.color})` }}>
                  <CategoryGlyph name={category.icon} className="size-3.5" />
                </span>
                {category.name}
              </Chip>
            ))}
          </ChipRow>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
      {children}
    </p>
  );
}

function ChipRow({ children, wrap }: { children: React.ReactNode; wrap?: boolean }) {
  return (
    <div
      className={cn(
        "-mx-1 gap-1.5 px-1",
        wrap
          ? "flex max-h-[9.5rem] flex-wrap overflow-y-auto py-1"
          : "flex overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[13px] font-semibold transition active:scale-95",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
