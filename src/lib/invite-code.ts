/**
 * Invite-code formatting.
 *
 * Deliberately separate from `codes.ts`, which generates them: generation needs
 * `node:crypto`, and the join screen needs to normalise what a user typed. Kept
 * in one module they would drag Node's crypto into the browser bundle, which
 * webpack refuses outright.
 *
 * So: pure string handling here, safe on both sides. Anything needing entropy
 * stays server-side.
 */

/**
 * Cleans up a code as typed or pasted.
 *
 * People paste "MANGO-TIGER-42" or type "mango tiger 42". Both should reach the
 * same group, so casing, spacing and stray punctuation are normalised away. A
 * whole link or invite message needs `codeFromText` first.
 */
export function normalizeInviteCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Formats a recovery key for display in readable chunks.
 *
 * The value the user copies is always the raw secret; this is only for showing
 * on screen, where an unbroken 43-character string is impossible to check
 * against a written copy.
 */
export function formatRecoveryKey(secret: string): string {
  const body = secret.replace(/^dvy_/, "");
  return (body.match(/.{1,8}/g) ?? []).join(" ");
}

/**
 * Looks like a code on its own: "mango-tiger-42-k7fq", the older "mango-tiger-42",
 * or a person's "me-calm-otter-x7k2pq". The edges mean one still being typed
 * ("mango-tiger-42-") isn't taken for a finished one.
 */
const CODE_SHAPED =
  /(?<![a-z0-9-])(?:me-[a-z]+-[a-z]+-[a-z0-9]+|[a-z]+-[a-z]+-\d+(?:-[a-z0-9]+)?)(?![a-z0-9-])/i;

/**
 * The code inside a link, a QR code, or a whole invite message, or null if
 * there isn't one. The last link counts: the invite's own comes after the
 * group's name, which can hold anything.
 */
export function inviteCodeIn(text: string): string | null {
  const link = [...text.matchAll(/\/join\/([^/?#\s]+)/g)].at(-1)?.[1];
  if (link) {
    try {
      return decodeURIComponent(link);
    } catch {
      return link;
    }
  }
  return CODE_SHAPED.exec(text)?.[0] ?? null;
}

/** What someone typed, pasted or scanned, down to the code if one's in there. */
export function codeFromText(raw: string): string {
  return inviteCodeIn(raw) ?? raw.trim();
}

/**
 * The words shared with an invite. Links open in the browser even with Divvy on
 * the home screen, so it also says how to use the code from inside the app.
 */
export function inviteMessage(opening: string, url: string, code: string): string {
  return `${opening}\n\n${url}\n\nAlready have Divvy? Open it, tap Join and enter this code.\n${code}`;
}
