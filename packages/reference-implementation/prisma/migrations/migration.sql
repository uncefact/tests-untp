-- Per-item backoff keeps one pre-dispatch fault from delaying never-attempted items.
ALTER TABLE "CredentialBatchItem" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "batch_item_retry_schedule_idx"
ON "CredentialBatchItem"("batchId", "state", "nextAttemptAt", "attemptCount", "index");
