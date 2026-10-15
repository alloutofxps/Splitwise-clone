import type { SplitMode, SplitParticipant } from "./split";

/**
 * A group's usual split: the way most of its expenses divide, so a couple who
 * always go 60/40 don't have to set it on every expense.
 *
 * Stored on the group as JSON. Only the two modes that describe a standing
 * arrangement make sense here: percentages, and shares (weights). Equal needs
 * no setting at all - it is what a group with no usual split does.
 */
export interface DefaultSplit {
  mode: "PERCENT" | "SHARES";
  entries: { personId: string; value: number }[];
}

export function parseDefaultSplit(raw: string | null | undefined): DefaultSplit | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DefaultSplit>;
    if ((value.mode !== "PERCENT" && value.mode !== "SHARES") || !Array.isArray(value.entries)) return null;
    const entries = value.entries.filter(
      (e): e is { personId: string; value: number } =>
        typeof e?.personId === "string" && typeof e?.value === "number" && Number.isFinite(e.value) && e.value >= 0,
    );
    return entries.length > 0 ? { mode: value.mode, entries } : null;
  } catch {
    return null;
  }
}

/** Percentages are stored to two decimal places; this is the rounding slack. */
const PERCENT_TOLERANCE = 0.005;

/** Why a usual split can't be saved, in words a person can act on. Null when it's fine. */
export function defaultSplitProblem(split: DefaultSplit, memberIds: string[]): string | null {
  const members = new Set(memberIds);
  if (split.entries.some((e) => !members.has(e.personId))) {
    return "Everyone in the usual split has to be in the group.";
  }
  if (new Set(split.entries.map((e) => e.personId)).size !== split.entries.length) {
    return "Each person can only be in the usual split once.";
  }
  const total = split.entries.reduce((sum, e) => sum + e.value, 0);
  if (split.mode === "PERCENT" && Math.abs(total - 100) > PERCENT_TOLERANCE) {
    return `The percentages add up to ${Math.round(total * 100) / 100}%. They have to add up to 100%.`;
  }
  if (split.mode === "SHARES" && total <= 0) return "Give at least one person a share.";
  return null;
}

/**
 * The split a new expense in this group should start with, or null to start
 * with an equal split.
 *
 * Applied to whoever is in the group now. Someone who has left simply drops
 * out of a split by shares; a split by percent that no longer adds up once
 * they're gone falls back to equal, rather than quietly giving their share to
 * somebody, and says so through `stale`.
 */
export function startingSplit(
  split: DefaultSplit | null,
  memberIds: string[],
): { mode: SplitMode; participants: SplitParticipant[]; stale: boolean } | null {
  if (!split) return null;
  const members = new Set(memberIds);
  const live = split.entries.filter((e) => members.has(e.personId));
  const valueOf = new Map(live.map((e) => [e.personId, e.value]));

  if (split.mode === "PERCENT") {
    const total = live.reduce((sum, e) => sum + e.value, 0);
    if (Math.abs(total - 100) > PERCENT_TOLERANCE) {
      return { mode: "EQUAL", participants: memberIds.map((personId) => ({ personId, included: true })), stale: true };
    }
    return {
      mode: "PERCENT",
      participants: memberIds.map((personId) => ({ personId, percent: valueOf.get(personId) ?? 0 })),
      stale: false,
    };
  }

  if (live.every((e) => e.value <= 0)) {
    return { mode: "EQUAL", participants: memberIds.map((personId) => ({ personId, included: true })), stale: true };
  }
  return {
    mode: "SHARES",
    participants: memberIds.map((personId) => ({ personId, weight: valueOf.get(personId) ?? 0 })),
    stale: false,
  };
}

/** A short description for the settings row, e.g. "60% / 40%" or "2 : 1 : 1". */
export function describeDefaultSplit(
  split: DefaultSplit | null,
  nameOf: (personId: string) => string,
): string {
  if (!split) return "Equally";
  const shown = split.entries.filter((e) => e.value > 0);
  if (split.mode === "PERCENT") {
    return shown.length <= 3
      ? shown.map((e) => `${nameOf(e.personId)} ${Math.round(e.value * 100) / 100}%`).join(", ")
      : "By percent";
  }
  return shown.length <= 3
    ? shown.map((e) => `${nameOf(e.personId)} ${e.value}`).join(", ") + (shown.length > 1 ? " shares" : " share")
    : "By shares";
}
