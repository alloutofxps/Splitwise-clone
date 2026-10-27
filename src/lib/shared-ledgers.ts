import { abs } from "./money";
import type { SharedLedgerDto } from "./types";

/**
 * Orders the ledgers two people share: the biggest amount first, whichever way
 * it is owed, because that is the one being settled and on a phone the rest may
 * be behind a "show more".
 *
 * Equal amounts always come out in the same order, so the list doesn't reshuffle
 * between visits: the direct ledger before any group, direct ledgers by
 * currency, groups by name and then by id.
 */
export function biggestFirst(a: SharedLedgerDto, b: SharedLedgerDto): number {
  const sizeA = abs(BigInt(a.net));
  const sizeB = abs(BigInt(b.net));
  if (sizeA !== sizeB) return sizeA > sizeB ? -1 : 1;
  if ((a.groupId === null) !== (b.groupId === null)) return a.groupId === null ? -1 : 1;
  if (a.groupId === null) return a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
  const byName = (a.name ?? "").localeCompare(b.name ?? "");
  if (byName !== 0) return byName;
  return a.groupId < b.groupId! ? -1 : a.groupId > b.groupId! ? 1 : 0;
}
