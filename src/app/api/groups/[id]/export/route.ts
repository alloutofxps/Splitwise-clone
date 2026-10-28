import { route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { toDecimalString } from "@/lib/money";
import { categoryById } from "@/lib/categories";
import { convertedBreakdown } from "@/lib/split";

type Params = { params: Promise<{ id: string }> };

/**
 * CSV export of the whole group ledger.
 *
 * A paid feature elsewhere; here it is a GET. The point of an export is that
 * your data is yours and stays readable in a spreadsheet long after you stop
 * using the app, which makes putting it behind a paywall a strange thing to do.
 *
 * One row per person per expense, which is the shape that pivots cleanly: you
 * can group by person, by category, or by month without unpacking anything.
 * A payment has a row for each side, and the last column is each person's net
 * in the group's own currency, so adding up one person's column gives exactly
 * the balance the app shows them.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group } = await requireGroupAccess(id, session.person.id);

  const [expenses, settlements, memberships] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: id, deletedAt: null },
      include: { payers: true, splits: true },
      orderBy: { date: "asc" },
    }),
    prisma.settlement.findMany({
      where: { groupId: id, deletedAt: null },
      orderBy: { date: "asc" },
    }),
    prisma.membership.findMany({ where: { groupId: id }, include: { person: true } }),
  ]);

  const nameOf = new Map(memberships.map((m) => [m.personId, m.person.displayName]));

  const rows: string[][] = [
    [
      "Date",
      "Type",
      "Description",
      "Category",
      "Currency",
      "Total",
      `Total (${group.currency})`,
      "Person",
      "Paid",
      "Share",
      "Net",
      "Notes",
      `Net (${group.currency})`,
    ],
  ];

  for (const expense of expenses) {
    // Each person's paid and owed in the group's currency, apportioned the way
    // the balances are (lib/split.ts), so the last column adds up to them.
    const converted = convertedBreakdown(expense);
    const netConverted = (personId: string) =>
      converted.paid.filter((p) => p.personId === personId).reduce((t, p) => t + p.amount, 0n) -
      converted.owed.filter((o) => o.personId === personId).reduce((t, o) => t + o.amount, 0n);
    const people = new Set([
      ...expense.payers.map((p) => p.personId),
      ...expense.splits.filter((s) => s.amount !== 0n).map((s) => s.personId),
    ]);

    for (const personId of people) {
      const paid = expense.payers
        .filter((p) => p.personId === personId)
        .reduce((total, p) => total + p.amount, 0n);
      const share = expense.splits
        .filter((s) => s.personId === personId)
        .reduce((total, s) => total + s.amount, 0n);

      rows.push([
        expense.date.toISOString().slice(0, 10),
        "Expense",
        expense.description,
        categoryById(expense.categoryId).name,
        expense.currency,
        toDecimalString(expense.amount, expense.currency),
        toDecimalString(expense.convertedAmount, group.currency),
        nameOf.get(personId) ?? "Unknown",
        toDecimalString(paid, expense.currency),
        toDecimalString(share, expense.currency),
        toDecimalString(paid - share, expense.currency),
        expense.notes ?? "",
        toDecimalString(netConverted(personId), group.currency),
      ]);
    }
  }

  for (const settlement of settlements) {
    const from = nameOf.get(settlement.fromPersonId) ?? "Unknown";
    const to = nameOf.get(settlement.toPersonId) ?? "Unknown";
    // The payer paid it out; for the receiver it is money in, a negative paid.
    const side = (person: string, sign: bigint) => [
      settlement.date.toISOString().slice(0, 10),
      "Payment",
      `${from} paid ${to}`,
      "Settle up",
      settlement.currency,
      toDecimalString(settlement.amount, settlement.currency),
      toDecimalString(settlement.convertedAmount, group.currency),
      person,
      toDecimalString(sign * settlement.amount, settlement.currency),
      toDecimalString(0n, settlement.currency),
      toDecimalString(sign * settlement.amount, settlement.currency),
      settlement.note ?? "",
      toDecimalString(sign * settlement.convertedAmount, group.currency),
    ];
    // Both sides: with only the payer's row, the receiver's total was off by
    // every payment they had received.
    rows.push(side(from, 1n), side(to, -1n));
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `${slugify(group.name)}-divvy-${new Date().toISOString().slice(0, 10)}.csv`;

  // Written as an escape rather than a literal: an invisible U+FEFF sitting at
  // the start of a template string is indistinguishable from a stray paste, and
  // the next person to tidy it away would break Excel without knowing why.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      // The BOM makes Excel open UTF-8 correctly instead of mangling accents.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

/**
 * Quotes a CSV field.
 *
 * The leading apostrophe on formula-like values stops a spreadsheet from
 * executing a description someone typed as `=HYPERLINK(...)`, which is a real
 * injection route into a colleague's machine, not a theoretical one.
 *
 * A plain number is left alone. "-15.00" is what a debt looks like, and with
 * an apostrophe in front a spreadsheet reads it as text and leaves it out of
 * every total.
 */
function csvCell(value: string): string {
  const number = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !number && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "group"
  );
}
