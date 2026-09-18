BEGIN;

ALTER TYPE "CredentialBatchState" ADD VALUE 'CANCELLED';
ALTER TYPE "CredentialBatchItemState" ADD VALUE 'CANCELLED';

ALTER TABLE "CredentialBatch"
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledCount" INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT "CredentialBatch_counts_non_negative_check",
  DROP CONSTRAINT "CredentialBatch_counts_sum_check",
  ADD CONSTRAINT "CredentialBatch_counts_non_negative_check" CHECK (
    "itemCount" >= 0 AND "queuedCount" >= 0 AND "processingCount" >= 0
    AND "issuedCount" >= 0 AND "failedCount" >= 0 AND "unknownCount" >= 0 AND "cancelledCount" >= 0
  ),
  ADD CONSTRAINT "CredentialBatch_counts_sum_check" CHECK (
    "queuedCount" + "processingCount" + "issuedCount" + "failedCount" + "unknownCount" + "cancelledCount" = "itemCount"
  );

COMMIT;
