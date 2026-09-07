-- The signed JWT segment is the identity of an opened external credential
-- (#956, D1). Existing rows keep a null digest. No released version of the
-- Reference Implementation (last tag v0.4.0) can hold an external record, so
-- there is nothing to backfill.
ALTER TABLE "ExternalCredential"
    ADD COLUMN "contentDigest" TEXT,
    ADD COLUMN "duplicateOfRecordId" TEXT;

-- An advisory row points at the canonical record without taking its digest.
-- The column-specific SET NULL action leaves the advisory row's tenant intact.
ALTER TABLE "ExternalCredential"
    ADD CONSTRAINT "ExternalCredential_duplicateOfRecordId_tenantId_fkey"
    FOREIGN KEY ("duplicateOfRecordId", "tenantId")
    REFERENCES "LibraryRecord"("id", "tenantId")
    ON DELETE SET NULL ("duplicateOfRecordId")
    ON UPDATE CASCADE;

-- The name Prisma generates for the matching `@@index` on the model, which
-- is its own truncation of the column list.
CREATE INDEX "ExternalCredential_tenantId_duplicateOfRecordId_createdAt_i_idx"
    ON "ExternalCredential"("tenantId", "duplicateOfRecordId", "createdAt", "id");

CREATE UNIQUE INDEX "ExternalCredential_tenantId_contentDigest_key"
    ON "ExternalCredential"("tenantId", "contentDigest")
    WHERE "contentDigest" IS NOT NULL;

-- A row either holds a content identity or points at the record that does.
-- Holding both would hide it from the advisory lookup, which selects on a
-- null digest.
ALTER TABLE "ExternalCredential"
    ADD CONSTRAINT "ExternalCredential_content_identity_exclusive_check"
    CHECK (NOT ("contentDigest" IS NOT NULL AND "duplicateOfRecordId" IS NOT NULL));
