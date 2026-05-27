-- Reconcile CvcFetchStatus with what resolveAndParseConformityScheme returns.
-- Add INVALID_JSON, DIGEST_FAILED; drop INVALID and SEED (placeholders with
-- no consumer). TOO_LARGE is retained so an oversized-document failure stays
-- distinguishable from a generic network failure in the operator view.

-- Defensive: pin any rows referencing values about to disappear.
UPDATE "ConformityScheme"
   SET "lastFetchStatus" = 'FETCH_FAILED'
 WHERE "lastFetchStatus" IN ('INVALID', 'SEED');

-- Postgres cannot drop enum values in-place; rebuild the type.
ALTER TYPE "CvcFetchStatus" RENAME TO "CvcFetchStatus_old";

CREATE TYPE "CvcFetchStatus" AS ENUM (
    'SUCCESS',
    'FETCH_FAILED',
    'TOO_LARGE',
    'INVALID_JSON',
    'SCHEMA_INVALID',
    'JSONLD_EXPANSION_FAILED',
    'PARSE_FAILED',
    'DIGEST_FAILED'
);

ALTER TABLE "ConformityScheme"
    ALTER COLUMN "lastFetchStatus" TYPE "CvcFetchStatus"
    USING "lastFetchStatus"::text::"CvcFetchStatus";

DROP TYPE "CvcFetchStatus_old";

-- Lookup key for ingest: existing cache validators are fetched by
-- (sourceUrl, tenantId) since the canonical id is only known after resolve.
CREATE UNIQUE INDEX "ConformityScheme_sourceUrl_tenantId_key"
    ON "ConformityScheme"("sourceUrl", "tenantId");
