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
 */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => string | Date,
): { label: string; entries: T[] }[] {
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    const raw = getDate(item);
    const label = dayLabel(raw instanceof Date ? raw : new Date(raw));
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item);
    else buckets.set(label, [item]);
  }

  return [...buckets].map(([label, entries]) => ({ label, entries }));
}

export function dayLabel(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((startOfToday.getTime() - startOfDay(date).getTime()) / 86_400_000);

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
