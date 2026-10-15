/**
 * Bucketing a reverse-chronological list into day headings.
 *
 * "Today", "Yesterday", then "Mon 13 Oct": one heading per day, in one format
 * everywhere (DESIGN-PLAN 3.3). Headings used to fall back to the month after a
 * week, which made every row under them carry its own date. The point is that a list of timestamps is unreadable at a glance while
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

/** Whether `dayLabel` would return a heading that identifies this exact day. Always, now. */
function namesOneDay(_date: Date): boolean {
  return true;
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
  return shortDate(date, date.getFullYear() !== now.getFullYear());
}

/**
 * "Mon 13 Oct", or "Mon 13 Oct 2025" for another year. Built from parts so the
 * order is the same whatever the browser's locale would do with commas.
 */
export function shortDate(date: Date, withYear = false): string {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, options).format(date);
  const text = `${part({ weekday: "short" })} ${date.getDate()} ${part({ month: "short" })}`;
  return withYear ? `${text} ${date.getFullYear()}` : text;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
