-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Settlement_batchId_idx" ON "Settlement"("batchId");
