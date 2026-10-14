/**
 * Calendar arithmetic in a named time zone, without a library.
 *
 * The server runs in UTC, and date maths done with `getDate`/`setMonth` is
 * done in the server's zone. For somebody in India, "the 1st at midnight" is
 * 18:30 UTC on the 31st, so monthly rent anchored that way kept posting on the
 * 30th or 31st. These helpers read and build wall-clock times in the creator's
 * own zone instead.
 */

export interface WallClock {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

/** Whether the runtime knows this IANA zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `date` in `timeZone`. */
export function wallClock(date: Date, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The instant at which the clock on the wall in `timeZone` reads `clock`.
 *
 * Found by guessing the UTC instant with the same digits, measuring how far
 * the zone's reading of it is off, and correcting - twice, which settles the
 * daylight-saving edges. A wall time that does not exist (inside a spring
 * gap) resolves to the instant just after it.
 */
export function fromWallClock(clock: WallClock, timeZone: string): Date {
  const target = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const seen = wallClock(new Date(guess), timeZone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += target - seenUtc;
  }
  return new Date(guess);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
