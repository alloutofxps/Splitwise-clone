/**
 * Moving a date in and out of an `<input type="date">`, which reads and
 * writes plain `YYYY-MM-DD` in the person's own time zone.
 */

/** The calendar day `date` falls on where the person is, as `YYYY-MM-DD`. */
export function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

/**
 * The picked day at local midday. Midday rather than midnight, so the date
 * stays on the same calendar day when it is read in a zone up to 12 hours
 * away (the server runs in UTC) or across a daylight-saving change. The few
 * places more than 12 hours ahead of UTC, such as Kiritimati, are the
 * exception.
 */
export function fromDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}
