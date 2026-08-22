import { customAlphabet } from "nanoid";

/**
 * Client-generated ids.
 *
 * Rows get their id before they reach the server, which is what makes the
 * offline outbox safe: replaying a queued mutation lands on the same primary
 * key, so the server can recognise it as a duplicate instead of filing a second
 * copy of last night's dinner.
 *
 * The alphabet excludes look-alike characters so an id read out of a URL or a
 * log is unambiguous.
 */
const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
const generate = customAlphabet(alphabet, 20);

export function newId(prefix: string): string {
  return `${prefix}_${generate()}`;
}

/** Sortable-by-creation id, useful when a list is rendered before it syncs. */
export function newSortableId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${generate().slice(0, 10)}`;
}
