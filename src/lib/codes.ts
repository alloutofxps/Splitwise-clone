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

import { randomBytes, randomInt, createHash } from "node:crypto";

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
 * Lower-case letters and digits with the look-alikes (0/o, 1/l/i) removed, so a
 * suffix read off a screen is unambiguous. Same alphabet as `lib/ids.ts`.
 */
const SUFFIX_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

function suffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += pick([...SUFFIX_ALPHABET]);
  return out;
}

/**
 * A group invite code: "mango-tiger-42-k7fq".
 *
 * The words keep it readable across a dinner table; the four-character tail
 * is what makes it unguessable. Words and a number alone were about 268k
 * combinations, which a script with a few thousand addresses walks in a day
 * no matter how the per-address limiter is tuned. With the tail it is about
 * 2.8 x 10^11, and the limiter in `server/rate-limit.ts` is a second line of
 * defence rather than the only one.
 */
export function generateInviteCode(): string {
  const number = randomInt(10, 100);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${number}-${suffix(4)}`;
}

/**
 * Personal codes: "me-calm-otter-x7k2pq".
 *
 * The `me-` marker makes a mistyped group code fail fast. The six-character
 * tail matters more: adjective-noun alone was 2,976 values in total, so every
 * account on the server could be found - and added as a friend, which exposes
 * their payment handles - by trying them all.
 */
export function generatePersonalCode(): string {
  return `me-${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix(6)}`;
}

/**
 * An internal handle for a placeholder. Never shown or redeemable - placeholder
 * codes are refused everywhere a code is typed - but it is unique and random,
 * so it cannot collide or be predicted.
 */
export function generateGhostCode(): string {
  return `ghost-${randomBytes(9).toString("base64url").toLowerCase()}`;
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
