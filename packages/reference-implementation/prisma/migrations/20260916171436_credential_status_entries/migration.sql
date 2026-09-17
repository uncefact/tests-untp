-- ADR-024 expand phase: this migration is additive and rollback-safe at the
-- schema level. An operational rollback still requires status admission to
-- stop, dispatchers to drain, and every pending intent to be reconciled or
-- exhausted before the old application is started against the previous schema.
-- During a rolling upgrade, an older application that reaches the pending
-- status trigger receives a database error that it cannot map and therefore
-- returns 500. This is why the migration guide requires status operations to
-- be drained before rolling back.

-- CreateEnum
CREATE TYPE "CredentialStatusProvenance" AS ENUM ('ISSUANCE', 'BACKFILL');

-- CreateEnum
CREATE TYPE "VcServiceAttribution" AS ENUM ('ISSUANCE', 'OPERATOR');

-- CreateEnum
CREATE TYPE "CredentialStatusCapture" AS ENUM ('PENDING', 'CAPTURED', 'FAILED');

-- AlterTable
ALTER TABLE "Credential"
    ADD COLUMN "vcServiceInstanceId" TEXT,
    ADD COLUMN "vcServiceAttribution" "VcServiceAttribution",
    ADD COLUMN "vcServiceAttributedAt" TIMESTAMP(3),
    ADD COLUMN "vcServiceAttributionReason" TEXT,
    ADD COLUMN "statusCapture" "CredentialStatusCapture" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "statusCaptureError" TEXT,
    ADD COLUMN "statusCapturedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CredentialStatusEntry" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalId" TEXT,
    "type" TEXT NOT NULL,
    "statusPurpose" TEXT NOT NULL,
    "statusListCredential" TEXT NOT NULL,
    "statusListIndex" TEXT NOT NULL,
    "statusListVcIssuer" TEXT NOT NULL,
    "descriptor" JSONB NOT NULL,
    "value" BOOLEAN,
    "observedAt" TIMESTAMP(3),
    "valueChangedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "pendingValue" BOOLEAN,
    "pendingSince" TIMESTAMP(3),
    "pendingDeadline" TIMESTAMP(3),
    "pendingToken" TEXT,
    "pendingInstanceId" TEXT,
    "pendingConfigDigest" TEXT,
    "acceptedReplacementDigest" TEXT,
    "provenance" "CredentialStatusProvenance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialStatusEntry_pending_intent_all_or_none_check"
        CHECK (num_nonnulls("pendingValue", "pendingSince", "pendingDeadline", "pendingToken", "pendingInstanceId", "pendingConfigDigest") IN (0, 6)),
    CONSTRAINT "CredentialStatusEntry_accepted_replacement_requires_pending_check"
        CHECK ("acceptedReplacementDigest" IS NULL OR "pendingToken" IS NOT NULL),

    CONSTRAINT "CredentialStatusEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_id_tenantId_key" ON "Credential"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialStatusEntry_credentialId_statusPurpose_key"
    ON "CredentialStatusEntry"("credentialId", "statusPurpose");

-- CreateIndex
CREATE INDEX "CredentialStatusEntry_tenantId_statusPurpose_value_idx"
    ON "CredentialStatusEntry"("tenantId", "statusPurpose", "value");

-- AddForeignKey
ALTER TABLE "CredentialStatusEntry"
    ADD CONSTRAINT "CredentialStatusEntry_credentialId_tenantId_fkey"
    FOREIGN KEY ("credentialId", "tenantId")
    REFERENCES "Credential"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- A rolling-back application must not be able to cascade away a status
-- operation whose provider outcome is unresolved. This guard is on the
-- Credential row's own delete, which also covers a cascade from LibraryRecord.
CREATE FUNCTION credential_status_pending_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    pending_purpose text;
BEGIN
    SELECT "statusPurpose"
      INTO pending_purpose
      FROM "CredentialStatusEntry"
     WHERE "credentialId" = OLD."id"
       AND "tenantId" = OLD."tenantId"
       AND "pendingToken" IS NOT NULL
     ORDER BY "statusPurpose"
     LIMIT 1;

    IF pending_purpose IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot delete Credential % while status purpose % has a pending operation',
            OLD."id", pending_purpose
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER "Credential_status_pending_delete_guard"
    BEFORE DELETE ON "Credential"
    FOR EACH ROW EXECUTE FUNCTION credential_status_pending_delete_guard();
