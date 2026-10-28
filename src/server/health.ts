/**
 * What the health check knows beyond "the database answers" (RULES.md O1, O2).
 *
 * The uptime monitor polls /api/health every five minutes and emails the
 * owner when it fails. So the health check is the alarm: it fails not only
 * when the database is gone, but when something is quietly broken while the
 * site still loads.
 *
 *  - Several server errors in a short time.
 *  - A background job that has stopped running: phone notifications,
 *    repeating expenses, exchange rates, housekeeping or the daily snapshot.
 *  - Crashes reported from the phones of several signed-in people.
 *  - Anything the daily database check found (server/integrity.ts).
 *
 * It clears by itself once the cause stops, and the monitor then sends an
 * "up again" email. State is on globalThis for the same reason as in
 * lib/log.ts: route handlers and the scheduler are bundled separately.
 */

import { errorsSince } from "@/lib/log";

const MINUTE = 60_000;

/** Server errors within SERVER_ERROR_WINDOW_MS that make the check fail. */
export const SERVER_ERROR_LIMIT = 5;
export const SERVER_ERROR_WINDOW_MS = 15 * MINUTE;
/** Different signed-in people reporting a crash within the hour. */
export const PHONE_ERROR_PEOPLE = 3;
export const PHONE_ERROR_WINDOW_MS = 60 * MINUTE;

interface Beat {
  everyMs: number;
  lastRanAt: number;
}

interface HealthState {
  jobs: Map<string, Beat>;
  phoneErrors: { at: number; personId: string }[];
  /** What the last daily database check found (server/integrity.ts). */
  integrity: Record<string, number>;
}

const shared = globalThis as unknown as { __divvyHealth?: HealthState };

function state(): HealthState {
  return (shared.__divvyHealth ??= { jobs: new Map(), phoneErrors: [], integrity: {} });
}

/** The latest daily database check's findings, replacing the last ones. */
export function noteIntegrity(found: Record<string, number>): void {
  state().integrity = found;
}

/** A job the scheduler has started. It counts as fresh until it is late. */
export function noteJobScheduled(name: string, everyMs: number, now = Date.now()): void {
  state().jobs.set(name, { everyMs, lastRanAt: now });
}

/** A job finished a run without throwing. */
export function noteJobRan(name: string, now = Date.now()): void {
  const beat = state().jobs.get(name);
  if (beat) beat.lastRanAt = now;
}

/** A crash reported from a signed-in person's phone. */
export function notePhoneError(personId: string, now = Date.now()): void {
  const errors = state().phoneErrors;
  errors.push({ at: now, personId });
  if (errors.length > 500) errors.splice(0, errors.length - 500);
}

/**
 * How late a job may be before it counts as stopped: one interval, plus
 * twice the interval (at most two hours) for slow runs and a deploy's lease
 * hand-over, plus fifteen minutes so a short job is not flagged after a blip.
 */
export function allowedGap(everyMs: number): number {
  return everyMs + Math.min(2 * everyMs, 120 * MINUTE) + 15 * MINUTE;
}

/** Plain sentences, empty when all is well. No names, amounts or ids. */
export function healthProblems(now = Date.now()): string[] {
  const problems: string[] = [];

  const errors = errorsSince(now - SERVER_ERROR_WINDOW_MS);
  if (errors >= SERVER_ERROR_LIMIT) {
    problems.push(`${errors} server errors in the last 15 minutes`);
  }

  for (const [name, beat] of state().jobs) {
    const late = now - beat.lastRanAt;
    if (late > allowedGap(beat.everyMs)) {
      problems.push(`the ${name} job has not run for ${Math.round(late / MINUTE)} minutes`);
    }
  }

  const people = new Set(
    state()
      .phoneErrors.filter((e) => e.at >= now - PHONE_ERROR_WINDOW_MS)
      .map((e) => e.personId),
  );
  if (people.size >= PHONE_ERROR_PEOPLE) {
    problems.push(`crashes on ${people.size} people's phones in the last hour`);
  }

  for (const [label, count] of Object.entries(state().integrity)) {
    problems.push(`the daily database check found ${label}: ${count}`);
  }

  return problems;
}

/** For tests. */
export function resetHealth(): void {
  shared.__divvyHealth = undefined;
}
