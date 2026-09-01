"use client";

import * as React from "react";
import { ArrowRight, BellRing, Check, Info, Sparkles } from "lucide-react";
import { Amount } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { Button, Switch, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useNudge, useUpdateGroup } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";
import { toDecimalString } from "@/lib/money";
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
  /** Opens the settle sheet, on a specific transfer when one is named. */
  onSettle: (edge?: { fromPersonId: string; toPersonId: string; amount: string }) => void;
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
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
          Where everyone stands
        </h3>
        <ul className="space-y-2.5">
          {members.map((member) => {
            const net = BigInt(netById[member.id] ?? "0");
            return (
              <li key={member.id} className="flex items-center gap-3">
                <Avatar person={member} size="sm" />
                <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                  {member.id === meId ? "You" : member.displayName}
                </span>
                {net === 0n ? (
                  <span className="text-caption font-semibold text-subtle">settled</span>
                ) : (
                  <span className="text-right">
                    <Amount value={net} currency={group.currency} size="sm" />
                    <span className="block text-micro font-semibold text-subtle">
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
          <h3 className="text-caption font-bold uppercase tracking-[0.06em] text-subtle">
            {simplified ? "Fewest payments" : "Who owes whom"}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-caption font-semibold text-muted">Simplify</span>
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
          <div className="rounded-[var(--radius-lg)] border border-line bg-positive-soft/50 p-6 text-center">
            <Sparkles className="mx-auto size-6 text-positive-text" />
            <p className="mt-2 text-subhead font-bold text-text">Everyone is square</p>
            <p className="mt-1 text-body text-muted">
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
                    "flex items-center gap-2.5 rounded-[var(--radius-lg)] border px-3 py-3",
                    involvesMe
                      ? "border-brand/30 bg-brand-soft/40"
                      : "border-line bg-surface",
                  )}
                >
                  {/*
                    The row is the control when the transfer is yours to record.
                    Working out the exact payment and then making somebody
                    re-enter it by hand was the whole cost of computing it.

                    A transfer between two other people stays inert: recording
                    it is allowed by the API, but volunteering that somebody
                    else has paid up is not a thing to make one tap away.
                  */}
                  <RowBody
                    as={involvesMe ? "button" : "div"}
                    onClick={
                      involvesMe
                        ? () => {
                            haptic();
                            onSettle({
                              fromPersonId: edge.fromPersonId,
                              toPersonId: edge.toPersonId,
                              amount: edge.amount,
                            });
                          }
                        : undefined
                    }
                    label={
                      involvesMe
                        ? edge.fromPersonId === meId
                          ? `Pay ${to.displayName} ${toDecimalString(BigInt(edge.amount), group.currency)}`
                          : `Record ${from.displayName} paying you ${toDecimalString(BigInt(edge.amount), group.currency)}`
                        : undefined
                    }
                  >
                    <Avatar person={from} size="sm" />
                    <span className="min-w-0 truncate text-body font-semibold text-text">
                      {edge.fromPersonId === meId ? "You" : from.displayName.split(" ")[0]}
                    </span>

                    <ArrowRight className="size-4 shrink-0 text-subtle" />

                    <Avatar person={to} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">
                      {edge.toPersonId === meId ? "you" : to.displayName.split(" ")[0]}
                    </span>

                    <Amount
                      value={edge.amount}
                      currency={group.currency}
                      size="sm"
                      tone="plain"
                      className="shrink-0"
                    />
                  </RowBody>

                  {/* Only on debts owed *to* the viewer: reminding somebody on
                      behalf of a third party is how a shared ledger turns into
                      an argument. */}
                  {edge.toPersonId === meId && !from.isGhost ? (
                    <NudgeButton personId={edge.fromPersonId} groupId={group.id} name={from.displayName} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {simplified && group.balances.pairwise.length > group.balances.simplified.length ? (
          <p className="mt-3 flex gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5 text-caption leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Simplifying turned {group.balances.pairwise.length} payments into{" "}
              {group.balances.simplified.length}. Everyone ends up exactly where
              they should — turn it off to see the original debts.
            </span>
          </p>
        ) : null}

        {edges.length > 0 ? (
          <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={() => onSettle()}>
            Record a payment
          </Button>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * "Remind" on a debt owed to you.
 *
 * Splitwise sends this by email or push. Neither is available here: the schema
 * holds no email addresses at all - that is the identity model, not an omission
 * - and web push needs a deployed HTTPS origin and a VAPID keypair that a
 * self-hosted app cannot assume. So the reminder lands in the other person's
 * activity feed, marked unread like everything else, which is somewhere they
 * already look.
 *
 * The server enforces what matters: that the debt is real, that only the person
 * owed can send it, and that it is once a day. A reminder that can be sent
 * forty times is not a reminder.
 */
/**
 * The tappable part of a settlement row.
 *
 * A plain `div` when the transfer is not the viewer's to record, a `button`
 * when it is — kept as one component so the two render identically. It is a
 * sibling of the nudge button rather than its parent, because a button inside a
 * button is invalid and browsers resolve it in their own ways.
 */
function RowBody({
  as,
  onClick,
  label,
  children,
}: {
  as: "button" | "div";
  onClick?: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const className = "flex min-w-0 flex-1 items-center gap-2.5 text-left";
  if (as === "div") return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(className, "rounded-[var(--radius-md)] transition active:scale-[0.985]")}
    >
      {children}
    </button>
  );
}

function NudgeButton({
  personId,
  groupId,
  name,
}: {
  personId: string;
  groupId: string;
  name: string;
}) {
  const toast = useToast();
  const nudge = useNudge();
  const [sent, setSent] = React.useState(false);

  const send = async () => {
    try {
      await nudge.mutateAsync({ personId, groupId });
      haptic([10, 40, 10]);
      setSent(true);
      toast({
        tone: "success",
        title: `Reminded ${name.split(" ")[0]}`,
        description: "It will show up in their activity feed.",
      });
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not send that",
        // The server's refusals are written to be read: "you already reminded
        // them today", "they do not owe you anything right now".
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={nudge.isPending || sent}
      aria-label={`Remind ${name}`}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition active:scale-90",
        sent
          ? "text-positive-text"
          : "text-subtle hover:bg-surface-2 hover:text-text disabled:opacity-40",
      )}
    >
      {sent ? <Check className="size-4" /> : <BellRing className="size-4" />}
    </button>
  );
}
