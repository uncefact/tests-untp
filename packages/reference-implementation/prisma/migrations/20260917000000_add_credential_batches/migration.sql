-- Batch issuance records are the source of progress and submission idempotency
-- (ADR-059). Item requests are encrypted envelopes, not JSON plaintext.

CREATE TYPE "CredentialBatchState" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'NEEDS_ATTENTION', 'EXPIRED');
CREATE TYPE "CredentialBatchItemState" AS ENUM ('QUEUED', 'PROCESSING', 'ISSUED', 'FAILED', 'OUTCOME_UNKNOWN');

CREATE TABLE "CredentialBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "state" "CredentialBatchState" NOT NULL DEFAULT 'QUEUED',
    "itemCount" INTEGER NOT NULL,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "processingCount" INTEGER NOT NULL DEFAULT 0,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "bodyDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "attemptToken" TEXT,
    "attemptStartedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CredentialBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CredentialBatch_counts_non_negative_check" CHECK (
      "itemCount" >= 0 AND "queuedCount" >= 0 AND "processingCount" >= 0
      AND "issuedCount" >= 0 AND "failedCount" >= 0 AND "unknownCount" >= 0
    ),
    CONSTRAINT "CredentialBatch_counts_sum_check" CHECK (
      "queuedCount" + "processingCount" + "issuedCount" + "failedCount" + "unknownCount" = "itemCount"
    ),
    CONSTRAINT "CredentialBatch_expires_after_settlement_check" CHECK (
      "expiresAt" IS NULL OR "settledAt" IS NOT NULL
    )
);

CREATE TABLE "CredentialBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "state" "CredentialBatchItemState" NOT NULL DEFAULT 'QUEUED',
    "request" TEXT NOT NULL,
    "credentialId" TEXT,
    "warning" JSONB,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "resolutionReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CredentialBatchItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CredentialBatchItem_index_non_negative_check" CHECK ("index" >= 0)
);

CREATE UNIQUE INDEX "CredentialBatch_tenantId_idempotencyKey_key"
  ON "CredentialBatch"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "CredentialBatch_id_tenantId_key"
  ON "CredentialBatch"("id", "tenantId");
CREATE INDEX "CredentialBatch_tenantId_createdAt_idx"
  ON "CredentialBatch"("tenantId", "createdAt");
CREATE INDEX "CredentialBatch_state_lastProgressAt_idx"
  ON "CredentialBatch"("state", "lastProgressAt");
CREATE INDEX "CredentialBatch_expiresAt_idx" ON "CredentialBatch"("expiresAt");
CREATE UNIQUE INDEX "CredentialBatchItem_batchId_index_key"
  ON "CredentialBatchItem"("batchId", "index");
CREATE INDEX "CredentialBatchItem_batchId_state_index_idx"
  ON "CredentialBatchItem"("batchId", "state", "index");

ALTER TABLE "CredentialBatch"
  ADD CONSTRAINT "CredentialBatch_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CredentialBatchItem"
  ADD CONSTRAINT "CredentialBatchItem_batchId_tenantId_fkey"
  FOREIGN KEY ("batchId", "tenantId") REFERENCES "CredentialBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CredentialBatchItem"
  ADD CONSTRAINT "CredentialBatchItem_credentialId_tenantId_fkey"
  FOREIGN KEY ("credentialId", "tenantId") REFERENCES "Credential"("id", "tenantId")
  -- Keep the item's tenant fence when a credential is deleted. Prisma's
  -- relation action cannot express a subset of a composite SET NULL action.
  ON DELETE SET NULL ("credentialId") ON UPDATE CASCADE;

-- Per-item backoff keeps one pre-dispatch fault from delaying never-attempted items.
ALTER TABLE "CredentialBatchItem" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "batch_item_retry_schedule_idx"
ON "CredentialBatchItem"("batchId", "state", "nextAttemptAt", "attemptCount", "index");
