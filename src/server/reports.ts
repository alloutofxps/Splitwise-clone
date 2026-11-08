import type { Person } from "@/generated/prisma/client";
import { normalizeInviteCode } from "@/lib/invite-code";

/** How long a "Something wrong?" report is kept. Also in the privacy policy. */
export const REPORT_KEEP_DAYS = 90;

/**
 * Who reads the reports: whoever runs Divvy, named by their own invite code (You,
 * Your invite code) in `DIVVY_REPORTS_TO`. A code rather than an account id
 * because it's what they can see and copy. Unset, reports are still kept and
 * nobody is told.
 */
export function reportsReaderCode(): string | null {
  const code = normalizeInviteCode(process.env.DIVVY_REPORTS_TO ?? "");
  return code.startsWith("me-") ? code : null;
}

export function readsReports(person: Pick<Person, "inviteCode" | "deletedAt" | "isGhost">): boolean {
  const code = reportsReaderCode();
  return Boolean(code) && !person.deletedAt && !person.isGhost && person.inviteCode === code;
}
