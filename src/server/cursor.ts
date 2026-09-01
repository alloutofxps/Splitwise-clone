/**
 * Keyset cursors for the two feeds that page.
 *
 * A cursor of "the last row's timestamp, fetch everything strictly older"
 * looks right and quietly loses data. Two expenses entered on the same evening
 * share a date to the millisecond often enough that it is the normal case, not
 * the edge case: if the page boundary lands between them, the second one is
 * older-or-equal to the cursor and `lt` skips it. It is gone from page one
 * (trimmed) and from page two (filtered), and because balances are derived from
 * the rows rather than from the feed, nothing looks wrong until somebody asks
 * where their payment went.
 *
 * So the cursor carries a tiebreaker: (timestamp, id). Ids are unique across
 * both the expense and settlement tables - they carry different prefixes - so
 * the pair is a total order over the merged ledger, and "strictly before this
 * exact row" is expressible without dropping its neighbours.
 */

export interface Cursor {
  time: Date;
  id: string;
}

/** `<iso>|<id>`. Opaque to the client, which only ever echoes it back. */
export function encodeCursor(time: Date | string, id: string): string {
  const iso = typeof time === "string" ? time : time.toISOString();
  return `${iso}|${id}`;
}

/**
 * Returns null for anything unparseable rather than throwing: a cursor is
 * client-supplied, and the right response to a mangled one is the first page,
 * not a 500.
 */
export function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;

  // First separator, not last: an ISO timestamp never contains a pipe, so
  // everything after the first one is the id - even if the id itself has one.
  const separator = raw.indexOf("|");
  // A bare timestamp is what the previous version of this API handed out. It
  // still means something sensible - "everything strictly older" - so it is
  // honoured rather than rejected, which keeps an app left open across the
  // deploy from breaking.
  if (separator === -1) {
    const time = new Date(raw);
    return Number.isNaN(time.getTime()) ? null : { time, id: "" };
  }

  const time = new Date(raw.slice(0, separator));
  if (Number.isNaN(time.getTime())) return null;
  return { time, id: raw.slice(separator + 1) };
}

/**
 * The "strictly before this row" filter, in the shape Prisma wants.
 *
 * Returns a list of conditions to AND into a where clause. Empty when there is
 * no cursor, so callers can spread it unconditionally.
 *
 * An empty id (a legacy bare-timestamp cursor) degrades to the old `lt`
 * behaviour, which is the best that cursor can express.
 */
export function beforeCursor(
  field: "date" | "createdAt",
  cursor: Cursor | null,
): Record<string, unknown>[] {
  if (!cursor) return [];
  if (!cursor.id) return [{ [field]: { lt: cursor.time } }];

  return [
    {
      OR: [
        { [field]: { lt: cursor.time } },
        { [field]: cursor.time, id: { lt: cursor.id } },
      ],
    },
  ];
}

/**
 * Orders two rows newest-first by the same key the cursor encodes.
 *
 * Must stay in lockstep with `beforeCursor` and with the `orderBy` given to
 * Prisma: a merge that sorts by a different key than the database paged on
 * reintroduces exactly the gap this module exists to close.
 */
export function compareDesc(
  a: { date: string; id: string },
  b: { date: string; id: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}
