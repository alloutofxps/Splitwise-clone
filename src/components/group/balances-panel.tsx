"use client";

import * as React from "react";
import { ArrowRight, Info, Sparkles } from "lucide-react";
import { Amount } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { Button, Switch, cn } from "../ui/primitives";
import { useUpdateGroup } from "@/lib/client/queries";
import type { GroupDetailDto, PersonDto } from "@/lib/types";

/**
 * Who owes whom.
 *
 * Two views of the same net position, and the difference matters enough to make
 * it a visible toggle rather than a hidden setting:
 *
 *   **Simplified** collapses the graph into the fewest transfers. Perfect for
 *   the end of a holiday, and mildly disconcerting the first time it tells you
 *   to pay someone you never bought anything from.
 *
 *   **Detailed** shows the literal debts each expense created. Slower to
 *   settle, but every line can be traced back to a specific dinner, which is
 *   what people want when they are suspicious of the number.
 */
export function BalancesPanel({
  group,
  meId,
  people,
  onSettle,
}: {
  group: GroupDetailDto;
  meId: string;
  people: Map<string, PersonDto>;
  onSettle: () => void;
}) {
  const updateGroup = useUpdateGroup(group.id);
  const [simplified, setSimplified] = React.useState(group.simplifyDebts);

  React.useEffect(() => setSimplified(group.simplifyDebts), [group.simplifyDebts]);

  const edges = simplified ? group.balances.simplified : group.balances.pairwise;

  const members = group.members;
  const netById = group.balances.net;

  return (
    <div>
      {/* Per-person net ---------------------------------------------------- */}
      <section className="rounded-[--radius-lg] border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
          Where everyone stands
        </h3>
        <ul className="space-y-2.5">
          {members.map((member) => {
            const net = BigInt(netById[member.id] ?? "0");
            return (
              <li key={member.id} className="flex items-center gap-3">
                <Avatar person={member} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">
                  {member.id === meId ? "You" : member.displayName}
                </span>
                {net === 0n ? (
                  <span className="text-[12px] font-semibold text-subtle">settled</span>
                ) : (
                  <span className="text-right">
                    <Amount value={net} currency={group.currency} size="sm" />
                    <span className="block text-[10px] font-semibold text-subtle">
                      {net > 0n ? "is owed" : "owes"}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Settlement plan ---------------------------------------------------- */}
      <section className="mt-4">
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
            {simplified ? "Fewest payments" : "Who owes whom"}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-muted">Simplify</span>
            <Switch
              checked={simplified}
              label="Simplify debts"
              onChange={(next) => {
                setSimplified(next);
                updateGroup.mutate({ simplifyDebts: next });
              }}
            />
          </div>
        </div>

        {edges.length === 0 ? (
          <div className="rounded-[--radius-lg] border border-line bg-positive-soft/50 p-6 text-center">
            <Sparkles className="mx-auto size-6 text-positive-text" />
            <p className="mt-2 text-[15px] font-bold text-text">Everyone is square</p>
            <p className="mt-1 text-[13px] text-muted">
              Nothing outstanding in this group.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {edges.map((edge, index) => {
              const from = people.get(edge.fromPersonId);
              const to = people.get(edge.toPersonId);
              if (!from || !to) return null;
              const involvesMe = edge.fromPersonId === meId || edge.toPersonId === meId;

              return (
                <li
                  key={`${edge.fromPersonId}-${edge.toPersonId}-${index}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[--radius-lg] border px-3 py-3",
                    involvesMe
                      ? "border-brand/30 bg-brand-soft/40"
                      : "border-line bg-surface",
                  )}
                >
                  <Avatar person={from} size="sm" />
                  <span className="min-w-0 truncate text-[13px] font-semibold text-text">
                    {edge.fromPersonId === meId ? "You" : from.displayName.split(" ")[0]}
                  </span>

                  <ArrowRight className="size-4 shrink-0 text-subtle" />

                  <Avatar person={to} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                    {edge.toPersonId === meId ? "you" : to.displayName.split(" ")[0]}
                  </span>

                  <Amount
                    value={edge.amount}
                    currency={group.currency}
                    size="sm"
                    tone="plain"
                    className="shrink-0"
                  />
                </li>
              );
            })}
          </ul>
        )}

        {simplified && group.balances.pairwise.length > group.balances.simplified.length ? (
          <p className="mt-3 flex gap-2 rounded-[--radius-md] bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Simplifying turned {group.balances.pairwise.length} payments into{" "}
              {group.balances.simplified.length}. Everyone ends up exactly where
              they should — turn it off to see the original debts.
            </span>
          </p>
        ) : null}

        {edges.length > 0 ? (
          <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={onSettle}>
            Record a payment
          </Button>
        ) : null}
      </section>
    </div>
  );
}
