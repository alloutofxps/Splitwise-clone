/**
 * Reading a Splitwise group export.
 *
 * In Splitwise: open a group, tap the settings gear, "Export as spreadsheet".
 * The file is a CSV with one row per expense or payment:
 *
 *   Date,Description,Category,Cost,Currency,Ana,Ben,Cy
 *   2026-03-01,Dinner,Dining out,90.00,EUR,60.00,-30.00,-30.00
 *   2026-03-02,Ben paid Ana,Payment,30.00,EUR,-30.00,30.00,0.00
 *   ...
 *   2026-03-31,Total balance, , ,EUR,30.00,0.00,-30.00
 *
 * Each person's column is what they paid minus what they owed on that row,
 * so a positive number means the row left them owed money. That is all the
 * file says: not who paid what, only where everyone ended up. It is enough to
 * rebuild every row so everyone's balance comes out exactly as in Splitwise,
 * which is what matters when moving a group.
 *
 * Used on both sides: the phone reads the file to show a preview, and the
 * server rebuilds the rows itself rather than trusting what it is sent.
 */
import { parseAmount } from "./money";
import { apportion } from "./split";
import { CATEGORIES, DEFAULT_CATEGORY_ID, suggestCategory } from "./categories";

export interface SplitwiseRow {
  /** yyyy-mm-dd */
  date: string;
  description: string;
  category: string;
  /** Minor units, as a string so it survives JSON. */
  cost: string;
  currency: string;
  /** One per person column, minor units. */
  nets: string[];
}

export interface SplitwiseExport {
  people: string[];
  rows: SplitwiseRow[];
  /** Rows that could not be read, with the reason, for the preview. */
  problems: string[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER = ["date", "description", "category", "cost", "currency"];

/** Reads the file. Throws an Error with a plain sentence if it isn't a Splitwise export. */
export function parseSplitwiseExport(text: string): SplitwiseExport {
  const table = parseCsv(text).filter((cells) => cells.some((c) => c.trim() !== ""));
  if (table.length === 0) throw new Error("That file is empty.");

  const header = table[0].map((c) => c.trim());
  const looksRight = HEADER.every((name, i) => header[i]?.toLowerCase() === name);
  if (!looksRight) {
    throw new Error(
      "That doesn't look like a Splitwise export. In Splitwise, open the group, tap the settings gear, then Export as spreadsheet.",
    );
  }
  const people = header.slice(5).filter((name) => name !== "");
  if (people.length === 0) throw new Error("That export doesn't list anyone in the group.");

  const rows: SplitwiseRow[] = [];
  const problems: string[] = [];

  for (let line = 1; line < table.length; line++) {
    const cells = table[line].map((c) => c.trim());
    const [date, description, category, cost, currency] = cells;
    if ((description ?? "").toLowerCase() === "total balance") continue;

    const code = (currency ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      problems.push(`Row ${line + 1}: no currency.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(date ?? "")) {
      problems.push(`Row ${line + 1}: the date "${date ?? ""}" couldn't be read.`);
      continue;
    }
    const costMinor = parseAmount(cost ?? "", code);
    if (costMinor === null) {
      problems.push(`Row ${line + 1}: the amount "${cost ?? ""}" couldn't be read.`);
      continue;
    }
    const nets = people.map((_, i) => parseAmount(cells[5 + i] || "0", code) ?? 0n);

    rows.push({
      date: date.slice(0, 10),
      description: (description || "Imported expense").slice(0, 140),
      category: category ?? "",
      cost: (costMinor < 0n ? -costMinor : costMinor).toString(),
      currency: code,
      nets: nets.map((n) => n.toString()),
    });
  }

  return { people, rows, problems };
}

export type RebuiltRow =
  | { kind: "skip" }
  | { kind: "payment"; from: number; to: number; amount: bigint }
  | {
      kind: "expense";
      amount: bigint;
      payers: { index: number; amount: bigint }[];
      splits: { index: number; amount: bigint }[];
    };

/**
 * Turns one row's "paid minus owed" numbers back into an expense or payment
 * with the same effect on everyone's balance.
 *
 * Payments: one person up, one person down by the same amount.
 * Expenses: whoever came out ahead is treated as having paid; everyone who
 * came out behind owed exactly that much. Whatever part of the cost isn't
 * accounted for by those debts is the payers' own share, spread across them in
 * proportion. Balances match Splitwise to the cent; who-paid-what inside a row
 * is a reconstruction, since the file doesn't say.
 */
export function rebuildRow(row: { cost: string; category: string; nets: string[] }): RebuiltRow {
  const nets = row.nets.map((n) => BigInt(n));

  // Splitwise rounds each column on its own; if a row is a cent off zero,
  // the biggest entry absorbs it so the row still balances.
  const drift = nets.reduce((t, n) => t + n, 0n);
  if (drift !== 0n) {
    let biggest = 0;
    nets.forEach((n, i) => {
      if ((n < 0n ? -n : n) > (nets[biggest] < 0n ? -nets[biggest] : nets[biggest])) biggest = i;
    });
    nets[biggest] -= drift;
  }

  const ups = nets.map((n, index) => ({ index, n })).filter((e) => e.n > 0n);
  const downs = nets.map((n, index) => ({ index, n })).filter((e) => e.n < 0n);
  if (ups.length === 0 || downs.length === 0) return { kind: "skip" };

  if (row.category.toLowerCase() === "payment" && ups.length === 1 && downs.length === 1) {
    // The person who paid comes out ahead on a payment row.
    return { kind: "payment", from: ups[0].index, to: downs[0].index, amount: ups[0].n };
  }

  const owed = ups.reduce((t, e) => t + e.n, 0n);
  const cost = BigInt(row.cost) > owed ? BigInt(row.cost) : owed;
  const ownShare = cost - owed;
  const ownShares = ownShare > 0n ? apportion(ownShare, ups.map((e) => Number(e.n))) : ups.map(() => 0n);

  return {
    kind: "expense",
    amount: cost,
    payers: ups.map((e, i) => ({ index: e.index, amount: e.n + ownShares[i] })),
    splits: [
      ...ups.map((e, i) => ({ index: e.index, amount: ownShares[i] })),
      ...downs.map((e) => ({ index: e.index, amount: -e.n })),
    ],
  };
}

/** Splitwise's category names to ours, falling back to reading the description. */
const CATEGORY_MAP: Record<string, string> = {
  "dining out": "dining",
  groceries: "groceries",
  liquor: "drinks",
  "food and drink - other": "dining",
  rent: "rent",
  mortgage: "mortgage",
  electricity: "utilities",
  "heat/gas": "utilities",
  water: "utilities",
  "utilities - other": "utilities",
  trash: "utilities",
  "tv/phone/internet": "internet",
  "household supplies": "household",
  furniture: "household",
  maintenance: "maintenance",
  cleaning: "household",
  services: "household",
  "home - other": "household",
  hotel: "accommodation",
  plane: "flights",
  "bus/train": "transport",
  taxi: "taxi",
  car: "carrental",
  "gas/fuel": "fuel",
  parking: "parking",
  "transportation - other": "transport",
  movies: "entertainment",
  music: "entertainment",
  games: "entertainment",
  "entertainment - other": "entertainment",
  sports: "sports",
  "medical expenses": "health",
  insurance: "insurance",
  taxes: "taxes",
  education: "education",
  childcare: "childcare",
  pets: "pets",
  gifts: "gifts",
  clothing: "shopping",
  electronics: "shopping",
};

export function categoryFor(splitwiseCategory: string, description: string): string {
  const mapped = CATEGORY_MAP[splitwiseCategory.trim().toLowerCase()];
  if (mapped && CATEGORIES.some((c) => c.id === mapped)) return mapped;
  return suggestCategory(description)?.id ?? DEFAULT_CATEGORY_ID;
}

/** "lisbon-2026_2026-10-15_export.csv" -> "Lisbon 2026" */
export function groupNameFromFile(filename: string): string {
  const base = filename
    .replace(/\.csv$/i, "")
    .replace(/_?\d{4}-\d{2}-\d{2}.*$/, "")
    .replace(/_?export$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!base) return "Imported group";
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 60);
}

/** The currency most rows use, which the group will count in. */
export function mainCurrency(rows: SplitwiseRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  let best: string | null = null;
  for (const [code, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = code;
  return best;
}
