-- What people send with "Something wrong?", for whoever runs Divvy
-- (DIVVY_REPORTS_TO). A new table only: nothing existing changes. Each is
-- deleted after 90 days (server/jobs.ts), and with the sender's account.

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT,
    "text" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "build" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");
