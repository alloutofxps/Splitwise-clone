-- Credentials, sessions and device links.
--
-- Splits the single `Person.tokenHash` into a `Credential` row so a person can
-- hold several ways in at once, and gives each signed-in device its own
-- `Session` instead of putting the recovery secret in the cookie. The existing
-- recovery key is carried across below, before `Person` is rebuilt without the
-- column — losing it here would lock every existing account out of its own
-- history.

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "secretHash" TEXT,
    "externalId" TEXT,
    "publicKey" BLOB,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "rpId" TEXT,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "Credential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceLink_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Carry every existing recovery key into a Credential row.
--
-- Runs while `Person.tokenHash` still exists, which is why it sits above the
-- RedefineTables block rather than at the end of the file. Ghosts have no
-- token and are skipped; they have never been claimed, so there is nothing to
-- preserve.
INSERT INTO "Credential" ("id", "personId", "kind", "secretHash", "label", "createdAt")
SELECT
    lower(hex(randomblob(12))),
    "id",
    'recovery',
    "tokenHash",
    'Recovery key',
    CURRENT_TIMESTAMP
FROM "Person"
WHERE "tokenHash" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT 'iris',
    "avatarEmoji" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "inviteCode" TEXT NOT NULL,
    "isGhost" BOOLEAN NOT NULL DEFAULT false,
    "createdByPersonId" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Person" ("avatarColor", "avatarEmoji", "createdAt", "createdByPersonId", "defaultCurrency", "displayName", "id", "inviteCode", "isGhost", "lastSeenAt", "updatedAt") SELECT "avatarColor", "avatarEmoji", "createdAt", "createdByPersonId", "defaultCurrency", "displayName", "id", "inviteCode", "isGhost", "lastSeenAt", "updatedAt" FROM "Person";
DROP TABLE "Person";
ALTER TABLE "new_Person" RENAME TO "Person";
CREATE UNIQUE INDEX "Person_inviteCode_key" ON "Person"("inviteCode");
CREATE INDEX "Person_inviteCode_idx" ON "Person"("inviteCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Session_secretHash_key" ON "Session"("secretHash");

-- CreateIndex
CREATE INDEX "Session_personId_idx" ON "Session"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_secretHash_key" ON "Credential"("secretHash");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_externalId_key" ON "Credential"("externalId");

-- CreateIndex
CREATE INDEX "Credential_personId_idx" ON "Credential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_codeHash_key" ON "DeviceLink"("codeHash");

-- CreateIndex
CREATE INDEX "DeviceLink_personId_idx" ON "DeviceLink"("personId");

-- CreateIndex
CREATE INDEX "DeviceLink_expiresAt_idx" ON "DeviceLink"("expiresAt");
