-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "lastEditedById" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "deletedAt" DATETIME;

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challenge" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "emoji" TEXT NOT NULL DEFAULT '🧾',
    "color" TEXT NOT NULL DEFAULT 'iris',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "simplifyDebts" BOOLEAN NOT NULL DEFAULT true,
    "inviteCode" TEXT NOT NULL,
    "inviteCodeActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ledgerVersion" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Group" ("archivedAt", "color", "createdAt", "currency", "emoji", "id", "inviteCode", "inviteCodeActive", "kind", "name", "simplifyDebts", "updatedAt") SELECT "archivedAt", "color", "createdAt", "currency", "emoji", "id", "inviteCode", "inviteCodeActive", "kind", "name", "simplifyDebts", "updatedAt" FROM "Group";
DROP TABLE "Group";
ALTER TABLE "new_Group" RENAME TO "Group";
CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"("inviteCode");
CREATE INDEX "Group_inviteCode_idx" ON "Group"("inviteCode");
CREATE TABLE "new_Recurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "categoryId" TEXT,
    "splitMode" TEXT NOT NULL DEFAULT 'EQUAL',
    "payersJson" TEXT NOT NULL,
    "splitsJson" TEXT NOT NULL,
    "notes" TEXT,
    "frequency" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "lastError" TEXT,
    "startDate" DATETIME NOT NULL,
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "endsAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByPersonId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recurrence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recurrence_createdByPersonId_fkey" FOREIGN KEY ("createdByPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Recurrence" ("active", "amount", "categoryId", "createdAt", "createdByPersonId", "currency", "dayOfMonth", "description", "endsAt", "frequency", "groupId", "id", "interval", "lastRunAt", "nextRunAt", "notes", "payersJson", "splitMode", "splitsJson", "startDate", "updatedAt") SELECT "active", "amount", "categoryId", "createdAt", "createdByPersonId", "currency", "dayOfMonth", "description", "endsAt", "frequency", "groupId", "id", "interval", "lastRunAt", "nextRunAt", "notes", "payersJson", "splitMode", "splitsJson", "startDate", "updatedAt" FROM "Recurrence";
DROP TABLE "Recurrence";
ALTER TABLE "new_Recurrence" RENAME TO "Recurrence";
CREATE INDEX "Recurrence_nextRunAt_active_idx" ON "Recurrence"("nextRunAt", "active");
CREATE INDEX "Recurrence_groupId_idx" ON "Recurrence"("groupId");
CREATE INDEX "Recurrence_createdByPersonId_idx" ON "Recurrence"("createdByPersonId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "Activity_actorPersonId_idx" ON "Activity"("actorPersonId");

-- CreateIndex
CREATE INDEX "Comment_personId_idx" ON "Comment"("personId");

-- CreateIndex
CREATE INDEX "ExpenseItemShare_personId_idx" ON "ExpenseItemShare"("personId");

-- CreateIndex
CREATE INDEX "ExpensePayer_personId_idx" ON "ExpensePayer"("personId");

-- CreateIndex
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Settlement_createdByPersonId_idx" ON "Settlement"("createdByPersonId");

-- Personal codes were adjective-noun only: 2,976 possible values, so every
-- account could be found by trying them all. Each gets a random suffix. A
-- friendship already made with the old code is untouched; only new adds need
-- the new code.
UPDATE "Person"
SET "inviteCode" = "inviteCode" || '-' || lower(hex(randomblob(3)))
WHERE "inviteCode" LIKE 'me-%' AND "isGhost" = false;

-- Repeating expenses whose currency differs from their group's used to post at
-- a rate of exactly 1 (so 10,000 JPY became 10,000 USD). They are paused with
-- an explanation instead of being allowed to post again.
UPDATE "Recurrence"
SET "active" = false,
    "lastError" = 'Paused: this repeating expense is in a different currency from the group. Delete it and create it again in the group''s currency.'
WHERE "groupId" IS NOT NULL
  AND "currency" <> (SELECT "currency" FROM "Group" WHERE "Group"."id" = "Recurrence"."groupId");

-- Every group's balances start as one cacheable version.
UPDATE "Group" SET "ledgerVersion" = 1;
