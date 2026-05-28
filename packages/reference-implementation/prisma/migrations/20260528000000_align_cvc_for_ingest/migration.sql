-- Rename `CvcSchemeSource` to `ConformitySchemeSource` for naming consistency
-- with the `ConformityScheme*` models and the services-side type union.
ALTER TYPE "CvcSchemeSource" RENAME TO "ConformitySchemeSource";

-- Reconcile the fetch-status enum and rename it to `ConformityFetchStatus`.
-- Add INVALID_JSON, DIGEST_FAILED; drop INVALID and SEED (placeholders with
-- no consumer). TOO_LARGE is retained so an oversized-document failure stays
-- distinguishable from a generic network failure in the operator view.

-- Defensive: pin any rows referencing values about to disappear.
UPDATE "ConformityScheme"
   SET "lastFetchStatus" = 'FETCH_FAILED'
 WHERE "lastFetchStatus" IN ('INVALID', 'SEED');

-- Postgres cannot drop enum values in-place; rebuild the type under its new name.
ALTER TYPE "CvcFetchStatus" RENAME TO "CvcFetchStatus_old";

CREATE TYPE "ConformityFetchStatus" AS ENUM (
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
    ALTER COLUMN "lastFetchStatus" TYPE "ConformityFetchStatus"
    USING "lastFetchStatus"::text::"ConformityFetchStatus";

DROP TYPE "CvcFetchStatus_old";

-- Lookup key for ingest: existing cache validators are fetched by
-- (sourceUrl, tenantId) since the canonical id is only known after resolve.
CREATE UNIQUE INDEX "ConformityScheme_sourceUrl_tenantId_key"
    ON "ConformityScheme"("sourceUrl", "tenantId");

-- Track when this row was last successfully fetched (or unchanged via the skip
-- chain). The discovery loop uses this column to evict rows whose owner-side
-- URL has been unreachable for too long.
ALTER TABLE "ConformityScheme" ADD COLUMN "lastSuccessAt" TIMESTAMP(3);

-- Backfill: rows currently marked SUCCESS must have succeeded at least once;
-- lastFetchedAt is the best available approximation.
UPDATE "ConformityScheme"
   SET "lastSuccessAt" = "lastFetchedAt"
 WHERE "lastFetchStatus" = 'SUCCESS';
