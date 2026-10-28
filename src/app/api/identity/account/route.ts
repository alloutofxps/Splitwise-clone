import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  clearIdentityCookie,
  recoveryKeyMatches,
  requireSession,
} from "@/lib/identity";
import { prisma } from "@/lib/db";
import { generateGhostCode } from "@/lib/codes";
import { verifyPasskey } from "@/server/passkey";
import { directBalanceSheets, groupSheetsFor } from "@/server/read";
import { limitByAccount, RECOVERY_ATTEMPT } from "@/server/rate-limit";

const proofSchema = z
  .object({
    recoveryKey: z.string().max(200).optional(),
    passkey: z
      .custom<AuthenticationResponseJSON>(
        (value) => typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string",
        "Expected a passkey response.",
      )
      .optional(),
  })
  .optional();

/**
 * That the person deleting the account holds its passkey or recovery key, not
 * just a phone that happens to be signed in (OWASP ASVS 3.6; the owner chose
 * this on 28 October 2026). Asked after the settled-up check, so nobody
 * proves who they are only to be told to settle up first.
 *
 * Without proof the answer is a 403, which the You screen takes as "ask for
 * the passkey or recovery key". A wrong one is a 422 with words to show, not
 * a 401, which would read as being signed out.
 */
/** Why the account can't be deleted yet, or null when it can. */
async function unsettledReason(me: string): Promise<string | null> {
  const [groupSheets, directSheets] = await Promise.all([
    groupSheetsFor(me),
    directBalanceSheets(me),
  ]);
  const unsettledGroups = [...groupSheets.values()].some((sheet) => (sheet.net.get(me) ?? 0n) !== 0n);
  const unsettledDirect = [...directSheets.values()].some((sheet) => (sheet.net.get(me) ?? 0n) !== 0n);
  return unsettledGroups || unsettledDirect
    ? "You need to settle up with everyone first. You still owe money, or someone owes you."
    : null;
}

/**
 * Whether the account could be deleted now, asked as the delete panel opens,
 * so nobody confirms it's them only to be told to settle up first. Read-only:
 * the panel never asks by trying the delete itself, which an older server
 * without the confirm step would simply carry out.
 */
export const GET = route(async () => {
  const session = await requireSession();
  const reason = await unsettledReason(session.person.id);
  return json({ canDelete: reason === null, reason });
});

async function confirmItsYou(me: string, proof: z.infer<typeof proofSchema>): Promise<void> {
  if (!proof?.passkey && !proof?.recoveryKey?.trim()) {
    throw new ForbiddenError("Confirm it's you with your passkey or recovery key.");
  }
  limitByAccount(me, "account-delete-proof", RECOVERY_ATTEMPT);
  if (proof.passkey) {
    const owner = await verifyPasskey(proof.passkey).catch((error: unknown) => {
      if (error instanceof UnauthorizedError) throw new ValidationError(error.message);
      throw error;
    });
    if (owner.id !== me) throw new ValidationError("That passkey belongs to a different account.");
    return;
  }
  if (!(await recoveryKeyMatches(me, proof.recoveryKey ?? ""))) {
    throw new ValidationError("That recovery key doesn't match this account.");
  }
}

/**
 * Deletes the caller's account.
 *
 * Required by privacy law (GDPR, UK GDPR, India's DPDP Act) and by any app
 * store: a person has to be able to remove what the app holds about them.
 *
 * What a shared ledger makes subtle is that the *records* are not only theirs.
 * The dinner they split is also on three other people's books, so expenses and
 * payments stay - with the person shown as "Deleted user" - and everything
 * that is only about them goes: their name, emoji, payment handles, budgets,
 * passkeys, recovery key, devices, friendships and comments.
 *
 * Refused while they still owe or are owed anything. Deleting an account must
 * not be a way to walk away from a debt, or to strand somebody else's. And
 * refused until they confirm it's them (`confirmItsYou`).
 */
export const DELETE = route(async (request: Request) => {
  const session = await requireSession();
  const me = session.person.id;
  const proof = await readBody(request, proofSchema);

  const unsettled = await unsettledReason(me);
  if (unsettled) throw new ValidationError(unsettled);
  await confirmItsYou(me, proof);

  const now = new Date();
  const ownerships = await prisma.membership.findMany({
    where: { personId: me, role: "owner", leftAt: null },
    select: { groupId: true },
  });

  await prisma.$transaction(async (tx) => {
    // Hand each group they own to its longest-standing remaining member, so
    // no group is left with nobody able to manage it.
    if (ownerships.length > 0) {
      const candidates = await tx.membership.findMany({
        where: {
          groupId: { in: ownerships.map((row) => row.groupId) },
          leftAt: null,
          personId: { not: me },
          person: { isGhost: false, deletedAt: null },
        },
        orderBy: { joinedAt: "asc" },
        select: { id: true, groupId: true },
      });
      const successors = new Map<string, string>();
      for (const row of candidates) {
        if (!successors.has(row.groupId)) successors.set(row.groupId, row.id);
      }
      if (successors.size > 0) {
        await tx.membership.updateMany({
          where: { id: { in: [...successors.values()] } },
          data: { role: "owner" },
        });
      }
    }

    await tx.membership.updateMany({
      where: { personId: me, leftAt: null },
      data: { leftAt: now, role: "member" },
    });
    await tx.credential.deleteMany({ where: { personId: me } });
    await tx.session.deleteMany({ where: { personId: me } });
    await tx.deviceLink.deleteMany({ where: { personId: me } });
    await tx.paymentMethod.deleteMany({ where: { personId: me } });
    await tx.budget.deleteMany({ where: { personId: me } });
    await tx.friendship.deleteMany({ where: { OR: [{ personAId: me }, { personBId: me }] } });
    await tx.comment.updateMany({
      where: { personId: me, deletedAt: null },
      data: { deletedAt: now, body: "" },
    });
    // Direct repeating expenses are theirs alone; group ones pause themselves
    // now that they have left (see `server/recurrence.ts`).
    await tx.recurrence.deleteMany({ where: { createdByPersonId: me, groupId: null } });

    await tx.person.update({
      where: { id: me },
      data: {
        displayName: "Deleted user",
        avatarEmoji: null,
        avatarColor: "sand",
        // A fresh, unredeemable handle: the old personal code must stop
        // resolving to anyone.
        inviteCode: `deleted-${generateGhostCode().slice("ghost-".length)}`,
        deletedAt: now,
      },
    });
  });

  await clearIdentityCookie();
  return json({ ok: true });
});
