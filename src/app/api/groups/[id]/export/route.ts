import { route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { toDecimalString } from "@/lib/money";
import { categoryById } from "@/lib/categories";

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
    ],
  ];

  for (const expense of expenses) {
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
      ]);
    }
  }

  for (const settlement of settlements) {
    const from = nameOf.get(settlement.fromPersonId) ?? "Unknown";
    const to = nameOf.get(settlement.toPersonId) ?? "Unknown";
    rows.push([
      settlement.date.toISOString().slice(0, 10),
      "Payment",
      `${from} paid ${to}`,
      "Settle up",
      settlement.currency,
      toDecimalString(settlement.amount, settlement.currency),
      toDecimalString(settlement.convertedAmount, group.currency),
      from,
      toDecimalString(settlement.amount, settlement.currency),
      "0",
      toDecimalString(settlement.amount, settlement.currency),
      settlement.note ?? "",
    ]);
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
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
