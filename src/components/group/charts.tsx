"use client";

import * as React from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { EmptyState, Segmented, Skeleton, cn } from "../ui/primitives";
import { CategoryGlyph } from "../expense/category-glyph";
import { useGroupStats } from "@/lib/client/queries";
import { categoryById } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { GroupStatsDto, PersonDto } from "@/lib/types";

/**
 * Group insights.
 *
 * Three questions, three forms, chosen from what each is actually for:
 *
 *   "how much, when"     -> monthly bars, one series at a time
 *   "on what"            -> horizontal category bars, longest first
 *   "who is carrying it" -> a diverging bar around zero
 *
 * Two deliberate restraints. There is no pie chart, because comparing angles is
 * measurably worse than comparing lengths and a group's spending has more
 * categories than a pie can carry. And no chart uses two y-scales - where two
 * measures matter, they get a toggle instead of being crammed onto one axis.
 *
 * Colour is doing one job per chart: magnitude (one hue) for the first two,
 * polarity (a validated diverging pair) for the third. Identity is carried by
 * icons and labels, never by colour alone, and every chart has a table view.
 */
export function GroupCharts({
  groupId,
  people,
}: {
  groupId: string;
  people: Map<string, PersonDto>;
}) {
  const { data: stats, isLoading } = useGroupStats(groupId);
  const [lens, setLens] = React.useState<"group" | "you">("group");
  const [asTable, setAsTable] = React.useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-56 w-full rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  if (!stats || stats.expenseCount === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="size-6" />}
        title="Nothing to chart yet"
        description="Add a few expenses and the breakdown shows up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <HeadlineTiles stats={stats} />

      <div className="flex items-center gap-2">
        <Segmented
          className="flex-1"
          size="sm"
          value={lens}
          onChange={setLens}
          options={[
            { value: "group", label: "Whole group" },
            { value: "you", label: "Your share" },
          ]}
        />
        <button
          onClick={() => setAsTable((current) => !current)}
          aria-pressed={asTable}
          aria-label={asTable ? "Show charts" : "Show as a table"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition active:scale-90",
            asTable ? "bg-brand-soft text-brand-soft-text" : "bg-surface-2 text-subtle",
          )}
        >
          {asTable ? <BarChart3 className="size-[17px]" /> : <Table2 className="size-[17px]" />}
        </button>
      </div>

      {asTable ? (
        <DataTable stats={stats} lens={lens} people={people} />
      ) : (
        <>
          <MonthlyChart stats={stats} lens={lens} />
          <CategoryChart stats={stats} lens={lens} />
          <PersonChart stats={stats} people={people} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

/**
 * Three numbers that need no chart at all.
 *
 * The most common question about a group's spending is a single figure, and a
 * figure rendered large is a better answer than a plot with one bar on it.
 */
function HeadlineTiles({ stats }: { stats: GroupStatsDto }) {
  const tiles = [
    { label: "Group total", value: stats.totalSpend },
    { label: "Your share", value: stats.yourTotalShare },
    { label: "You paid", value: stats.yourTotalPaid },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-[var(--radius-lg)] border border-line bg-surface p-3 shadow-card"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-subtle">
            {tile.label}
          </p>
          <p className="display-number mt-1 truncate text-[17px] font-bold text-text">
            {formatMoney(BigInt(tile.value), stats.currency, { compact: true, trimZeros: true })}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

/**
 * Spending over time.
 *
 * Vertical bars rather than a line: months are discrete buckets, and a line
 * between them implies a continuous quantity that was never measured. One
 * series at a time, chosen by the toggle above, so there is no second y-axis
 * and no legend to read.
 */
function MonthlyChart({ stats, lens }: { stats: GroupStatsDto; lens: "group" | "you" }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  // The last twelve months is what fits legibly on a phone; older data stays in
  // the table view rather than being squeezed into two-pixel bars.
  const months = stats.byMonth.slice(-12);
  if (months.length === 0) return null;

  const values = months.map((month) =>
    BigInt(lens === "group" ? month.total : month.yourShare),
  );
  const peak = values.reduce((max, value) => (value > max ? value : max), 0n);
  if (peak === 0n) return null;

  const active = hovered !== null ? months[hovered] : null;

  return (
    <ChartCard
      title={lens === "group" ? "What the group spent" : "What you spent"}
      subtitle="By month"
    >
      <div
        className="relative"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Tooltip. Reserved space rather than an overlay, so the chart does
            not jump when it appears. */}
        <div className="mb-2 h-9">
          {active ? (
            <div className="inline-flex flex-col rounded-[var(--radius-sm)] bg-surface-2 px-2.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-subtle">
                {formatMonth(active.month, true)}
              </span>
              <span className="tabular text-[13px] font-bold text-text">
                {formatMoney(
                  BigInt(lens === "group" ? active.total : active.yourShare),
                  stats.currency,
                )}
              </span>
            </div>
          ) : (
            <div className="inline-flex flex-col px-2.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-subtle">
                Peak month
              </span>
              <span className="tabular text-[13px] font-bold text-text">
                {formatMoney(peak, stats.currency, { compact: true })}
              </span>
            </div>
          )}
        </div>

        {/*
          Bars are width-capped and centred. With only two months a plain
          `flex-1` produces two slabs half the card wide, which reads as a
          graphic rather than as data.
        */}
        <div className="flex h-32 items-end justify-center gap-1.5">
          {months.map((month, index) => {
            const value = values[index];
            // Every non-zero month keeps a visible stub, so "small" never reads
            // as "none".
            const height = value === 0n ? 0 : Math.max(4, Number((value * 100n) / peak));

            return (
              <button
                key={month.month}
                onMouseEnter={() => setHovered(index)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                aria-label={`${formatMonth(month.month, true)}: ${formatMoney(value, stats.currency)}`}
                className="group relative flex h-full max-w-[56px] flex-1 flex-col justify-end"
              >
                <span
                  className="w-full rounded-t-[4px] transition-[height,opacity] duration-300"
                  style={{
                    height: `${height}%`,
                    background: "var(--chart-bar)",
                    opacity: hovered === null || hovered === index ? 1 : 0.4,
                  }}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex justify-center gap-1.5">
          {months.map((month, index) => (
            <span
              key={month.month}
              className={cn(
                "max-w-[56px] flex-1 text-center text-[9px] font-semibold uppercase",
                hovered === index ? "text-text" : "text-subtle",
              )}
            >
              {/* Only every other label on a crowded axis, so they never collide. */}
              {months.length > 7 && index % 2 === 1 ? "" : formatMonth(month.month)}
            </span>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Where the money went.
 *
 * Horizontal bars, sorted longest first. Horizontal because category names are
 * words - they read straight across instead of being rotated 45 degrees - and
 * sorted because rank is the question being asked.
 *
 * One hue for every bar. Colouring each category differently would spend the
 * identity channel re-encoding what the bar length already shows; the icon and
 * the name carry identity instead.
 */
function CategoryChart({ stats, lens }: { stats: GroupStatsDto; lens: "group" | "you" }) {
  const rows = stats.byCategory
    .map((row) => ({
      ...row,
      value: BigInt(lens === "group" ? row.total : row.yourShare),
    }))
    .filter((row) => row.value > 0n)
    .sort((a, b) => (a.value > b.value ? -1 : 1));

  if (rows.length === 0) return null;

  const peak = rows[0].value;
  const total = rows.reduce((sum, row) => sum + row.value, 0n);

  // Everything past the eighth folds into one row rather than becoming a long
  // tail of one-pixel bars.
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8);
  const restTotal = rest.reduce((sum, row) => sum + row.value, 0n);

  return (
    <ChartCard title="Where it went" subtitle={`${rows.length} categories`}>
      <ul className="space-y-2.5">
        {shown.map((row) => {
          const category = categoryById(row.categoryId);
          const width = Math.max(2, Number((row.value * 100n) / peak));
          const share = total > 0n ? Number((row.value * 1000n) / total) / 10 : 0;

          return (
            <li key={row.categoryId}>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-[5px]"
                  style={{
                    background: `color-mix(in oklch, var(--avatar-${category.color}) 18%, transparent)`,
                    color: `var(--avatar-${category.color})`,
                  }}
                >
                  <CategoryGlyph name={category.icon} className="size-3" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                  {category.name}
                </span>
                <span className="tabular shrink-0 text-[12px] font-semibold text-muted">
                  {formatMoney(row.value, stats.currency, { trimZeros: true })}
                </span>
                <span className="tabular w-9 shrink-0 text-right text-[11px] text-subtle">
                  {share >= 1 ? `${Math.round(share)}%` : "<1%"}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--chart-track)" }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${width}%`, background: "var(--chart-bar)" }}
                />
              </div>
            </li>
          );
        })}

        {rest.length > 0 ? (
          <li className="flex items-center gap-2 pt-1">
            <span className="min-w-0 flex-1 text-[12px] font-semibold text-subtle">
              {rest.length} more {rest.length === 1 ? "category" : "categories"}
            </span>
            <span className="tabular text-[12px] font-semibold text-muted">
              {formatMoney(restTotal, stats.currency, { trimZeros: true })}
            </span>
          </li>
        ) : null}
      </ul>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Who is carrying the group.
 *
 * A diverging bar around a zero line: paid more than their share to the right,
 * less to the left. Polarity is the question, so this is the one chart that
 * uses two hues - a pair validated for separation under colour-vision
 * deficiency, and reinforced by which side of the line the bar sits on plus a
 * signed value label, so the colour is never doing the work alone.
 */
function PersonChart({
  stats,
  people,
}: {
  stats: GroupStatsDto;
  people: Map<string, PersonDto>;
}) {
  const rows = stats.byPerson
    .map((row) => ({
      person: people.get(row.personId),
      net: BigInt(row.paid) - BigInt(row.share),
      paid: BigInt(row.paid),
      share: BigInt(row.share),
    }))
    .filter((row) => row.person)
    .sort((a, b) => (a.net > b.net ? -1 : 1));

  if (rows.length === 0) return null;

  const extent = rows.reduce((max, row) => {
    const magnitude = row.net < 0n ? -row.net : row.net;
    return magnitude > max ? magnitude : max;
  }, 1n);

  return (
    <ChartCard
      title="Who fronted what"
      subtitle="Paid, minus their own share, over the group's whole history"
    >
      <ul className="space-y-3">
        {rows.map((row) => {
          const positive = row.net > 0n;
          const magnitude = positive ? row.net : -row.net;
          const width = Number((magnitude * 50n) / extent);

          return (
            <li key={row.person!.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <Avatar person={row.person!} size="xs" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
                  {row.person!.displayName}
                </span>
                <span
                  className={cn(
                    "tabular shrink-0 text-[12px] font-bold",
                    row.net === 0n
                      ? "text-subtle"
                      : positive
                        ? "text-positive-text"
                        : "text-negative-text",
                  )}
                >
                  {row.net === 0n
                    ? "even"
                    : `${positive ? "+" : "−"}${formatMoney(magnitude, stats.currency, { bare: true, trimZeros: true })}`}
                </span>
              </div>

              {/* Zero line down the middle; bars grow out from it. */}
              <div className="relative h-1.5">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{ background: "var(--chart-track)" }}
                />
                <div
                  className="absolute inset-y-0 left-1/2 w-px"
                  style={{ background: "var(--chart-grid)" }}
                />
                {row.net !== 0n ? (
                  <div
                    className="absolute inset-y-0 rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.max(1.5, width)}%`,
                      background: positive
                        ? "var(--chart-positive)"
                        : "var(--chart-negative)",
                      left: positive ? "50%" : undefined,
                      right: positive ? undefined : "50%",
                    }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-subtle">
        Right of the line means they have paid out more than they have consumed.
        This is lifetime activity, not the current balance — settling up does
        not change it.
      </p>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

/**
 * The same numbers as a table.
 *
 * Not a fallback - a peer view. It is what a screen reader can navigate, what
 * survives being printed, and what someone reaches for when they want the exact
 * figure rather than the shape.
 */
function DataTable({
  stats,
  lens,
  people,
}: {
  stats: GroupStatsDto;
  lens: "group" | "you";
  people: Map<string, PersonDto>;
}) {
  const categories = stats.byCategory
    .map((row) => ({
      name: categoryById(row.categoryId).name,
      value: BigInt(lens === "group" ? row.total : row.yourShare),
      count: row.count,
    }))
    .filter((row) => row.value > 0n)
    .sort((a, b) => (a.value > b.value ? -1 : 1));

  return (
    <div className="space-y-4">
      <TableCard
        caption="By category"
        head={["Category", "Expenses", lens === "group" ? "Total" : "Your share"]}
        rows={categories.map((row) => [
          row.name,
          String(row.count),
          formatMoney(row.value, stats.currency),
        ])}
      />

      <TableCard
        caption="By month"
        head={["Month", "Group total", "Your share"]}
        rows={stats.byMonth.map((row) => [
          formatMonth(row.month, true),
          formatMoney(BigInt(row.total), stats.currency),
          formatMoney(BigInt(row.yourShare), stats.currency),
        ])}
      />

      <TableCard
        caption="By person"
        head={["Person", "Paid", "Share", "Net"]}
        rows={stats.byPerson.map((row) => {
          const net = BigInt(row.paid) - BigInt(row.share);
          return [
            people.get(row.personId)?.displayName ?? "Unknown",
            formatMoney(BigInt(row.paid), stats.currency),
            formatMoney(BigInt(row.share), stats.currency),
            `${net > 0n ? "+" : net < 0n ? "−" : ""}${formatMoney(net < 0n ? -net : net, stats.currency)}`,
          ];
        })}
      />
    </div>
  );
}

function TableCard({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
      {/* The table scrolls inside its own box; the page never scrolls sideways. */}
      <div className="scroll-area overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <caption className="px-4 pb-2 pt-3.5 text-left text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
            {caption}
          </caption>
          <thead>
            <tr className="border-y border-line bg-surface-2">
              {head.map((cell, index) => (
                <th
                  key={cell}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-subtle",
                    index > 0 && "text-right",
                  )}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5",
                      cellIndex === 0
                        ? "font-medium text-text"
                        : "tabular text-right text-muted",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-card">
      <h3 className="text-[14px] font-bold tracking-[-0.01em] text-text">{title}</h3>
      {subtitle ? (
        <p className="mb-3.5 mt-0.5 text-[12px] leading-snug text-muted">{subtitle}</p>
      ) : (
        <div className="mb-3.5" />
      )}
      {children}
    </section>
  );
}

function formatMonth(month: string, long = false): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1, 1);
  return long
    ? date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short" });
}
