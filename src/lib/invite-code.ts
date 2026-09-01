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
 * People paste "MANGO-TIGER-42", type "mango tiger 42", or copy a whole URL
 * with a trailing slash. All three should reach the same group, so casing,
 * spacing and stray punctuation are all normalised away.
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
