/**
 * Runs `fn` with no other call under the same key in flight.
 *
 * For check-then-write sequences whose check reads a computed balance - which
 * cannot be done inside a database transaction without a second connection.
 * Two taps on "settle up" from two devices used to both pass the "not more
 * than is outstanding" check before either wrote, and together paid the debt
 * twice. Serialising them per pair of people closes that window.
 *
 * Per process, which matches how the app runs (one server, one SQLite file).
 */
const tails = new Map<string, Promise<unknown>>();

export async function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => gate);
  tails.set(key, tail);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** A key for "anything that settles between these two people". */
export function pairKey(a: string, b: string): string {
  return a < b ? `pair:${a}:${b}` : `pair:${b}:${a}`;
}
