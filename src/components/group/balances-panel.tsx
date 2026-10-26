"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight, BellRing, Check, ChevronRight } from "lucide-react";
import { Amount } from "../ui/money";
import { useMirror } from "../ui/state-hooks";
import { Avatar } from "../ui/avatar";
import { FlowDoodle } from "../ui/doodle";
import { Button, Switch, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useNudge, useUpdateGroup } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import type { GroupDetailDto, PersonDto } from "@/lib/types";
import { FlowMap, type Travel } from "../flow/flow-map";
import { SwipeRow } from "../ui/swipe-row";
import { isolate } from "@/lib/bidi";

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
  travel,
  onTravelled,
}: {
  group: GroupDetailDto;
  meId: string;
  people: Map<string, PersonDto>;
  /** Opens the settle sheet, on a specific transfer when one is named. */
  onSettle: (edge?: { fromPersonId: string; toPersonId: string; amount: string }) => void;
  /** A payment just saved, to show travelling along its line. */
  travel?: Travel | null;
  /** The payment has finished playing. */
  onTravelled?: () => void;
}) {
  const updateGroup = useUpdateGroup(group.id);
  const nudge = useNudge();
  const toast = useToast();
  const remind = (person: PersonDto) =>
    nudge.mutate(
      { personId: person.id, groupId: group.id },
      {
        onSuccess: () => toast({ tone: "success", title: `Reminded ${person.displayName.split(" ")[0]}` }),
        onError: (error) =>
          toast({
            tone: "error",
            title: "Couldn’t send that",
            description: error instanceof ApiError ? error.message : undefined,
          }),
      },
    );
  // Flips at once when tapped, and follows the group when it changes elsewhere.
  const [simplified, setSimplified] = useMirror(group.simplifyDebts);

  const edges = simplified ? group.balances.simplified : group.balances.pairwise;
  const owing = group.balances.pairwise.length > 0 || group.balances.simplified.length > 0 || Boolean(travel);

  const members = group.members;
  const netById = group.balances.net;

  // Everyone on the map: the members, plus anyone who has left but still has
  // a line to draw, so a debt never points at nobody.
  const mapPeople = React.useMemo(() => {
    const list = [...members];
    for (const edge of [...group.balances.pairwise, ...group.balances.simplified]) {
      for (const id of [edge.fromPersonId, edge.toPersonId]) {
        const person = people.get(id);
        if (person && !list.some((member) => member.id === id)) list.push(person);
      }
    }
    return list;
  }, [members, people, group.balances.pairwise, group.balances.simplified]);

  const mapEdges = React.useMemo(
    () => edges.map((edge) => ({ ...edge, amount: BigInt(edge.amount) })),
    [edges],
  );

  const [showEveryone, setShowEveryone] = React.useState(false);
  // Fenced, so a right-to-left name doesn't reorder "Sam pays you €25.20".
  const firstName = (person: PersonDto) =>
    person.id === meId ? "You" : isolate(person.displayName.split(" ")[0]);

  return (
    <div>
      {/* The map, with the one Simplify switch under it. ------------------- */}
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
        {/* The map stays while a payment plays, even the one that settles the
            last debt, so you see it go before "settled up" takes its place. */}
        {(mapEdges.length > 0 || travel) && mapPeople.length > 1 ? (
          <div className="px-2 pt-4">
            <FlowMap
              people={mapPeople}
              edges={mapEdges}
              currency={group.currency}
              meId={meId}
              travel={travel}
              onTravelled={onTravelled}
            />
          </div>
        ) : (
          // The headline above already says "Everyone is settled up".
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <FlowDoodle className="mb-3" play="settled" />
            <p className="text-body text-muted">Nobody in this group owes anything.</p>
          </div>
        )}

        {/* With nothing owed there is nothing to simplify. */}
        {owing ? (
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-text">Simplify</span>
            <span className="mt-0.5 block text-caption text-muted">
              {simplified
                ? group.balances.pairwise.length > group.balances.simplified.length
                  ? `${group.balances.pairwise.length} payments become ${group.balances.simplified.length}. Everyone still ends up even.`
                  : "Debts are passed along so everyone makes as few payments as possible."
                : "Showing who owes who directly, expense by expense."}
            </span>
          </span>
          <Switch
            checked={simplified}
            label="Simplify debts"
            onChange={(next) => {
              setSimplified(next);
              updateGroup.mutate({ simplifyDebts: next });
            }}
          />
        </div>
        ) : null}
      </section>

      {/* Suggested payments ------------------------------------------------ */}
      {edges.length > 0 ? (
        <section className="mt-6">
          <h3 className="mb-2 px-1 text-title font-semibold tracking-[-0.01em] text-text">
            {simplified ? "Suggested payments" : "Who owes who"}
          </h3>
          {simplified ? (
            <p className="mb-2 px-1 text-caption text-muted">
              Who pays who here can differ from what two people owe each other.
            </p>
          ) : null}
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
            {edges.map((edge, index) => {
              const from = people.get(edge.fromPersonId);
              const to = people.get(edge.toPersonId);
              if (!from || !to) return null;
              const mine = edge.fromPersonId === meId;
              const toMe = edge.toPersonId === meId;
              const money = formatMoney(BigInt(edge.amount), group.currency);
              const settle = () => {
                haptic();
                onSettle({ fromPersonId: edge.fromPersonId, toPersonId: edge.toPersonId, amount: edge.amount });
              };

              return (
                <li key={`${edge.fromPersonId}-${edge.toPersonId}-${index}`}>
                  {/* Owed to you by someone on Divvy: swipe left to remind them. */}
                  {toMe && !from.isGhost ? (
                    <SwipeRow
                      action={{
                        label: "Remind",
                        ariaLabel: `Remind ${from.displayName}`,
                        tone: "default",
                        onPress: () => remind(from),
                      }}
                    >
                      {() => (
                        <div className="flex items-center gap-3 px-4 py-3">
                        <Avatar person={mine ? to : from} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-text">
                            {mine
                              ? `You pay ${firstName(to)}`
                              : toMe
                                ? `${firstName(from)} pays you`
                                : `${firstName(from)} pays ${firstName(to)}`}
                          </span>
                          <span
                            className={cn(
                              "tabular block text-caption",
                              mine ? "text-negative-text" : toMe ? "text-positive-text" : "text-muted",
                            )}
                          >
                            {/* Icons, not arrow characters: at caption size the
                                font's \u2199 reads like a tick. */}
                            {mine ? (
                              <ArrowUpRight aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                            ) : toMe ? (
                              <ArrowDownLeft aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                            ) : null}
                            {money}
                            {toMe && from.isGhost ? <span className="text-subtle"> · not on Divvy yet</span> : null}
                          </span>
                        </span>
      
                        {/* Only your own transfers are one tap away: volunteering that
                            somebody else has paid up isn't. */}
                        {mine || toMe ? (
                          <button
                            type="button"
                            onClick={settle}
                            // Starts with the word on the button, so "tap Settle" works by voice.
                            aria-label={mine ? `Settle, you pay ${to.displayName} ${money}` : `Settle, ${from.displayName} pays you ${money}`}
                            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-body font-medium text-text transition-colors hover:bg-surface-2"
                          >
                            Settle
                          </button>
                        ) : null}
                        {/* Only on debts owed *to* the viewer: reminding somebody on
                            behalf of a third party is how a shared ledger turns into
                            an argument. Someone not on Divvy can't receive one. */}
                        {toMe ? (
                          from.isGhost ? (
                            <span className="shrink-0 px-1 text-body text-subtle/60" aria-hidden>
                              Remind
                            </span>
                          ) : (
                            <NudgeButton personId={edge.fromPersonId} groupId={group.id} name={from.displayName} />
                          )
                        ) : null}
                        </div>
                      )}
                    </SwipeRow>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Avatar person={mine ? to : from} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-text">
                          {mine
                            ? `You pay ${firstName(to)}`
                            : toMe
                              ? `${firstName(from)} pays you`
                              : `${firstName(from)} pays ${firstName(to)}`}
                        </span>
                        <span
                          className={cn(
                            "tabular block text-caption",
                            mine ? "text-negative-text" : toMe ? "text-positive-text" : "text-muted",
                          )}
                        >
                          {/* Icons, not arrow characters: at caption size the
                              font's \u2199 reads like a tick. */}
                          {mine ? (
                            <ArrowUpRight aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                          ) : toMe ? (
                            <ArrowDownLeft aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} />
                          ) : null}
                          {money}
                          {toMe && from.isGhost ? <span className="text-subtle"> · not on Divvy yet</span> : null}
                        </span>
                      </span>
    
                      {/* Only your own transfers are one tap away: volunteering that
                          somebody else has paid up isn't. */}
                      {mine || toMe ? (
                        <button
                          type="button"
                          onClick={settle}
                          // Starts with the word on the button, so "tap Settle" works by voice.
                            aria-label={mine ? `Settle, you pay ${to.displayName} ${money}` : `Settle, ${from.displayName} pays you ${money}`}
                          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-body font-medium text-text transition-colors hover:bg-surface-2"
                        >
                          Settle
                        </button>
                      ) : null}
                      {/* Only on debts owed *to* the viewer: reminding somebody on
                          behalf of a third party is how a shared ledger turns into
                          an argument. Someone not on Divvy can't receive one. */}
                      {toMe ? (
                        from.isGhost ? (
                          <span className="shrink-0 px-1 text-body text-subtle/60" aria-hidden>
                            Remind
                          </span>
                        ) : (
                          <NudgeButton personId={edge.fromPersonId} groupId={group.id} name={from.displayName} />
                        )
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <Button variant="secondary" fullWidth className="mt-3" onClick={() => onSettle()}>
            Add a payment
          </Button>
        </section>
      ) : null}

      {/* Everyone's balance, for those who want the numbers. --------------- */}
      <section className="mt-6">
        <button
          onClick={() => setShowEveryone(!showEveryone)}
          aria-expanded={showEveryone}
          className="flex w-full items-center gap-1 px-1 text-body text-muted hover:text-text"
        >
          Everyone&rsquo;s balance
          <ChevronRight className={cn("size-4 transition-transform", showEveryone && "rotate-90")} />
        </button>
        {showEveryone ? (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
            {members.map((member) => {
              const net = BigInt(netById[member.id] ?? "0");
              return (
                <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar person={member} size="sm" />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-left text-body font-medium text-text">
                    {member.id === meId ? "You" : member.displayName}
                  </span>
                  {net === 0n ? (
                    <span className="text-caption text-subtle">settled</span>
                  ) : (
                    <span className="text-right">
                      <Amount value={net} currency={group.currency} size="sm" />
                      <span className="block text-caption text-subtle">{net > 0n ? "is owed" : "owes"}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
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
        description: "They'll see it in their Activity.",
      });
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't send that",
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
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-body font-medium transition-colors",
        sent ? "text-positive-text" : "text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40",
      )}
    >
      {sent ? <Check className="size-4" /> : <BellRing className="size-4" strokeWidth={1.75} />}
      <span className="hidden xs:inline">{sent ? "Sent" : "Remind"}</span>
    </button>
  );
}
