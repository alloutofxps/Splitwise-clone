import * as React from "react";
import { Amount } from "./ui/money";
import { abs, formatMoney } from "@/lib/money";
import type { DashboardPayload } from "@/lib/client/cache-contract";
import type { PersonDto } from "@/lib/types";

/** What `Standing` needs from the dashboard. */
export type StandingData = Pick<DashboardPayload, "totals" | "friends" | "groups" | "approxTotal">;

export interface StandingLine {
  currency: string;
  owed: bigint;
  owe: bigint;
  entries: { person: PersonDto; amount: bigint }[];
}

/**
 * One line per currency, split by direction, from the people who make it up:
 * a single net figure hides that you can be owed by some and owe others.
 */
export function standingLines(data: Pick<DashboardPayload, "totals" | "friends">): StandingLine[] {
  return Object.keys(data.totals).map((currency) => {
    const entries = data.friends
      .filter((friend) => friend.net[currency])
      .map((friend) => ({ person: friend.person, amount: BigInt(friend.net[currency]) }));
    const owed = entries.reduce((sum, entry) => (entry.amount > 0n ? sum + entry.amount : sum), 0n);
    const owe = entries.reduce((sum, entry) => (entry.amount < 0n ? sum - entry.amount : sum), 0n);
    return { currency, owed, owe, entries };
  });
}

/**
 * Where you stand on Home: what you're owed and what you owe, one line each
 * per currency, each with its flow bar underneath (`bar`).
 *
 * Shared by Home and its opening outline, which draws it from the numbers the
 * page arrived with: the balances are on screen as soon as the page is,
 * before the app's code has arrived to fetch them (RULES S3), in the place
 * and size Home then draws them.
 */
export function Standing({
  data,
  bar,
  children,
}: {
  data: StandingData;
  bar: (line: StandingLine) => React.ReactNode;
  children?: React.ReactNode;
}) {
  const currencies = Object.keys(data.totals);
  const nothingYet = data.groups.length === 0 && data.friends.length === 0;

  if (currencies.length === 0) {
    return (
      <section className="mb-8">
        <p className="text-hero font-semibold leading-[1.1] tracking-[-0.035em] text-text">
          {nothingYet ? "Nothing owed yet" : "All settled up"}
        </p>
        <p className="mt-2 text-body text-muted">
          {nothingYet
            ? "Add what people paid and Divvy works out who owes who."
            : "Nobody owes anybody anything."}
        </p>
      </section>
    );
  }

  const lines = standingLines(data);

  const approx = data.approxTotal ? BigInt(data.approxTotal.amount) : null;

  return (
    <section className="mb-8">
      <div className="space-y-5">
        {lines.map((line) => (
          <div key={line.currency}>
            {line.owed > 0n ? <BalanceLine label="You're owed" amount={line.owed} currency={line.currency} /> : null}
            {line.owe > 0n ? <BalanceLine label="You owe" amount={-line.owe} currency={line.currency} /> : null}
            {bar(line)}
          </div>
        ))}
      </div>

      {approx !== null && data.approxTotal ? (
        <p className="mt-3 text-body text-muted">
          About {formatMoney(abs(approx), data.approxTotal.currency)}{" "}
          {approx >= 0n ? "owed to you" : "that you owe"} overall
        </p>
      ) : null}
      {children}
    </section>
  );
}

function BalanceLine({ label, amount, currency }: { label: string; amount: bigint; currency: string }) {
  return (
    // The label always beside the figure, which shrinks to fit the rest of
    // the line. It used to wrap under the label only when long, so the labels
    // sat in two different places.
    <p className="flex items-baseline gap-x-2">
      <span className="shrink-0 text-body text-muted">{label}</span>
      <span className="min-w-0 flex-1 [container-type:inline-size]">
        <Amount
          value={amount}
          currency={currency}
          arrow
          fit="hero"
          className="text-hero font-semibold leading-[1.15] tracking-[-0.035em]"
        />
      </span>
    </p>
  );
}
