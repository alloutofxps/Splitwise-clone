/**
 * Bucketing a reverse-chronological list into day headings.
 *
 * "Today", "Yesterday", then the weekday for the rest of the week, then the
 * month. The point is that a list of timestamps is unreadable at a glance while
 * a list under "Yesterday" is not, and every chronological list in the app owes
 * the reader the same treatment.
 *
 * Generic over the item because the two lists that need it carry their date
 * under different names — the ledger's `date` is when the expense happened, the
 * activity feed's `createdAt` is when it was recorded, and those are genuinely
 * different things.
 *
 * Input is assumed already sorted newest-first; this preserves that order and
 * emits buckets in the order they are first seen.
 *
 * `precise` says whether the heading pins one particular day. "Today" and
 * "Thursday" do; "August" covers thirty-one of them. Rows under an imprecise
 * heading have to carry their own date, or a week in Lisbon collapses into one
 * undated block and nobody can tell the Tuesday dinner from the Friday one —
 * which is exactly the argument the ledger exists to settle.
 */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => string | Date,
): { label: string; precise: boolean; entries: T[] }[] {
  const buckets = new Map<string, { precise: boolean; entries: T[] }>();

  for (const item of items) {
    const raw = getDate(item);
    const date = raw instanceof Date ? raw : new Date(raw);
    const label = dayLabel(date);
    const bucket = buckets.get(label);
    if (bucket) bucket.entries.push(item);
    else buckets.set(label, { precise: namesOneDay(date), entries: [item] });
  }

  return [...buckets].map(([label, bucket]) => ({ label, ...bucket }));
}

/** Whether `dayLabel` would return a heading that identifies this exact day. */
function namesOneDay(date: Date): boolean {
  return daysAgo(date) < 7;
}

function daysAgo(date: Date): number {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((startOfToday.getTime() - startOfDay(date).getTime()) / 86_400_000);
}

export function dayLabel(date: Date): string {
  const now = new Date();
  const days = daysAgo(date);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "long" });
  }
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
