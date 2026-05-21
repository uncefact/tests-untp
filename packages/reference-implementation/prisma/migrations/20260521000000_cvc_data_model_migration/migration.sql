-- Sunset the prior CVC data model and replace with the UNTP v0.7 shape.
-- See ADR-033 §5 ("Data model and migration") for the decision.
-- Existing CVC data is intentionally dropped; the operator-seed loader
-- repopulates the system tenant on next boot and tenants must re-import
-- any custom schemes through the new tenant API.

-- Drop old tables (in dependency order)
DROP TABLE IF EXISTS "ProfileCriterion" CASCADE;
DROP TABLE IF EXISTS "Criterion" CASCADE;
DROP TABLE IF EXISTS "ConformityProfile" CASCADE;
DROP TABLE IF EXISTS "ConformityScheme" CASCADE;
DROP TABLE IF EXISTS "CvcCatalogue" CASCADE;

-- Enums introduced by the new model
CREATE TYPE "CvcSchemeSource" AS ENUM ('UNTP', 'SYSTEM_SEED', 'TENANT_IMPORTED');
CREATE TYPE "CvcFetchStatus" AS ENUM (
    'SUCCESS',
    'FETCH_FAILED',
    'JSONLD_EXPANSION_FAILED',
    'SCHEMA_INVALID',
    'PARSE_FAILED',
    'TOO_LARGE',
    'INVALID',
    'SEED'
);

-- ConformityScheme: owner-published scheme document, indexed by canonical URI
-- and tenant. New columns track ingestion state and the resolved JSON-LD blob.
CREATE TABLE "ConformityScheme" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "documentation" TEXT,
    "ownerCanonicalId" TEXT,
    "ownerName" TEXT,
    "specVersion" TEXT NOT NULL,
    "source" "CvcSchemeSource" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "etag" TEXT,
    "lastModifiedHeader" TEXT,
    "bodyDigest" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastFetchStatus" "CvcFetchStatus" NOT NULL,
    "rawDocument" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ConformityScheme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConformityScheme_canonicalId_tenantId_key" ON "ConformityScheme"("canonicalId", "tenantId");
CREATE INDEX "ConformityScheme_tenantId_idx" ON "ConformityScheme"("tenantId");
CREATE INDEX "ConformityScheme_source_idx" ON "ConformityScheme"("source");

ALTER TABLE "ConformityScheme"
    ADD CONSTRAINT "ConformityScheme_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ConformityProfile: versioned profile inside a scheme
CREATE TABLE "ConformityProfile" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "documentation" TEXT,
    "validFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,

    CONSTRAINT "ConformityProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConformityProfile_canonicalId_tenantId_key" ON "ConformityProfile"("canonicalId", "tenantId");
CREATE INDEX "ConformityProfile_schemeId_idx" ON "ConformityProfile"("schemeId");

ALTER TABLE "ConformityProfile"
    ADD CONSTRAINT "ConformityProfile_schemeId_fkey"
    FOREIGN KEY ("schemeId") REFERENCES "ConformityScheme"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ConformityCriterion: versioned auditable requirement
CREATE TABLE "ConformityCriterion" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "documentation" TEXT,
    "topics" JSONB,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ConformityCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConformityCriterion_canonicalId_tenantId_key" ON "ConformityCriterion"("canonicalId", "tenantId");
CREATE INDEX "ConformityCriterion_tenantId_idx" ON "ConformityCriterion"("tenantId");

-- ConformityProfileCriterion: join table
CREATE TABLE "ConformityProfileCriterion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,

    CONSTRAINT "ConformityProfileCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConformityProfileCriterion_profileId_criterionId_key" ON "ConformityProfileCriterion"("profileId", "criterionId");
CREATE INDEX "ConformityProfileCriterion_criterionId_idx" ON "ConformityProfileCriterion"("criterionId");

ALTER TABLE "ConformityProfileCriterion"
    ADD CONSTRAINT "ConformityProfileCriterion_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "ConformityProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConformityProfileCriterion"
    ADD CONSTRAINT "ConformityProfileCriterion_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "ConformityCriterion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
