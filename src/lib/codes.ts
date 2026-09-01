/**
 * Human-transferable codes.
 *
 * Invite codes get read aloud across a dinner table and typed into a phone by
 * someone who has had a drink, so they are built from short common words rather
 * than random characters. "MANGO-TIGER-42" survives that trip; "xK7f2Q" does
 * not.
 *
 * Recovery keys are the opposite: never typed, only copied or saved, and they
 * guard an identity - so those are full-entropy random strings.
 */

import { randomBytes, createHash } from "node:crypto";

// Re-exported so server code has one import site for anything code-related.
export { normalizeInviteCode, formatRecoveryKey } from "./invite-code";

// Words chosen to be short, concrete, unambiguous when spoken, and free of
// pairs that sound alike over a noisy table.
const ADJECTIVES = [
  "amber", "bold", "brave", "bright", "calm", "clever", "cosmic", "crisp",
  "dawn", "eager", "electric", "fair", "fresh", "gentle", "golden", "happy",
  "jolly", "keen", "lucky", "lunar", "mellow", "mighty", "neat", "noble",
  "polar", "proud", "quick", "quiet", "rapid", "royal", "sharp", "shiny",
  "silver", "smooth", "solar", "spry", "sunny", "swift", "tidy", "true",
  "urban", "vivid", "warm", "wild", "wise", "witty", "young", "zesty",
];

const NOUNS = [
  "acorn", "anchor", "arrow", "badger", "bamboo", "beacon", "bison", "brook",
  "cactus", "canyon", "cedar", "comet", "coral", "cricket", "dolphin", "dragon",
  "ember", "falcon", "ferry", "fjord", "forest", "garnet", "harbor", "heron",
  "island", "jasmine", "kayak", "lantern", "lemon", "lotus", "mango", "maple",
  "meadow", "meteor", "monsoon", "nebula", "ocean", "olive", "orchid", "otter",
  "panda", "pebble", "pepper", "pine", "prairie", "quartz", "rabbit", "raven",
  "reef", "river", "saffron", "salmon", "sparrow", "spruce", "summit", "tiger",
  "tulip", "tundra", "valley", "walnut", "willow", "zebra",
];

/** Cryptographically uniform index into an array, without modulo bias. */
function pick<T>(items: T[]): T {
  const range = items.length;
  const limit = Math.floor(0xffffffff / range) * range;
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return items[value % range];
}

/**
 * A group invite code: "mango-tiger-42".
 *
 * Roughly 48 x 62 x 90 = 268k combinations. That is deliberately small enough
 * to stay memorable and is not a secret on its own - codes are shared over
 * chat, and joining a group only lets you see that group.
 *
 * Entropy is therefore not what protects them: `server/rate-limit.ts` is,
 * applied to every endpoint that resolves a code (preview, join, friend-add,
 * add-by-code). At 20 attempts per ten minutes a full sweep of the space takes
 * years per source address. Read the caveats there before scaling the app to
 * more than one process - the counters are per-process.
 */
export function generateInviteCode(): string {
  const number = 10 + (randomBytes(2).readUInt16BE(0) % 90);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${number}`;
}

/** Personal codes carry a marker so a mistyped group code fails fast. */
export function generatePersonalCode(): string {
  return `me-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * The secret that *is* the account. Shown to the user once as a recovery key so
 * they can restore the same identity on a new phone. 32 random bytes.
 */
export function generateSecret(): string {
  return `dvy_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/*
 * There was a `secretMatches` here, a constant-time comparison of a secret
 * against a stored hash. Both callers now look the hash up directly — sessions
 * and credentials are indexed by it — which is how bearer tokens are normally
 * resolved and leaks nothing: reaching the comparison at all requires already
 * holding a preimage of a 256-bit digest. Deleted rather than kept warm for a
 * caller that no longer exists.
 */
