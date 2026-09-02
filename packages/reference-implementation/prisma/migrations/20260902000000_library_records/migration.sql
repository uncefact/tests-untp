-- The credential library's record model (#955; ADR-053 as amended 2026-09-02,
-- ADR-055): one LibraryRecord parent row per record, with Credential and the
-- new ExternalCredential as its origin children sharing its id, CheckRun for
-- verification generations, and the idempotency claim re-pointed at the
-- parent. Existing credentials gain their parent rows here and the
-- descriptive columns #952 added to Credential move across.
--
-- no-rollback (ADR-024): this migration drops columns and renames one, and
-- after it every Credential insert needs a parent row the previous
-- application never writes, so the previous version cannot run against the
-- migrated schema. Deploy as a stop-the-world upgrade; roll forward, not
-- back.
--
-- Prisma runs a PostgreSQL migration inside one transaction (see "On
-- PostgreSQL, a failed run leaves nothing behind" at
-- https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production),
-- so when a statement fails, the data move, the drops and the constraints
-- all roll back together and the failing statement's own error reaches the
-- operator. An explicit BEGIN/COMMIT here would only hide that error behind
-- "current transaction is aborted".

-- CreateEnum
CREATE TYPE "CoreCredentialType" AS ENUM ('DFR', 'DCC', 'DPP', 'DTE', 'DIA');

-- CreateEnum
CREATE TYPE "LibraryRecordOrigin" AS ENUM ('NATIVE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ExternalContentKind" AS ENUM ('CREDENTIAL', 'JSON_OBJECT', 'OPAQUE');

-- CreateEnum
CREATE TYPE "CheckRunState" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL', 'NOT_RUN');

-- CreateEnum
CREATE TYPE "CheckRunFailureCode" AS ENUM ('RETRIEVAL_FAILED', 'DECRYPTION_REQUIRED', 'DECRYPTION_FAILED', 'STORAGE_FAILED', 'VERIFICATION_UNAVAILABLE', 'STORED_COPY_UNAVAILABLE');

-- DropForeignKey
ALTER TABLE "IdempotencyKey" DROP CONSTRAINT "IdempotencyKey_credentialId_fkey";

-- DropIndex
DROP INDEX "IdempotencyKey_credentialId_key";

-- CreateTable
CREATE TABLE "LibraryRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origin" "LibraryRecordOrigin" NOT NULL,
    "name" TEXT,
    "issuerName" TEXT,
    "issuerDid" TEXT,
    "subjectName" TEXT,
    "subjectId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "credentialType" TEXT,
    "coreCredentialType" "CoreCredentialType",
    "coreDataModelVersion" TEXT,
    "detailsStatus" "CredentialDetailsStatus" NOT NULL DEFAULT 'EXTRACTION_PENDING',
    "detailsError" "CredentialDetailsError",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryRecord_pkey" PRIMARY KEY ("id")
);

-- Every existing credential becomes the native child of a new parent row
-- that carries its captured descriptive fields (ADR-053 decisions 1 and 5,
-- as amended). The parent keeps the credential's id, so nothing that refers
-- to a credential by id changes. The core kind (decision 8) comes from the
-- type name when it is a core name, otherwise from the core parent of the
-- extension data model of that name (see the join below). A row that matches
-- neither keeps its asserted type with a null core kind. The operator-run
-- details backfill (#953) selects every record whose core kind is null,
-- whatever its extraction status, and fills it in from the signed
-- credential's type array, so a row left null here is converged by the next
-- backfill run.
WITH core("name", "kind") AS (
    VALUES
        ('DigitalProductPassport', 'DPP'::"CoreCredentialType"),
        ('DigitalConformityCredential', 'DCC'::"CoreCredentialType"),
        ('DigitalFacilityRecord', 'DFR'::"CoreCredentialType"),
        ('DigitalTraceabilityEvent', 'DTE'::"CoreCredentialType"),
        ('DigitalIdentityAnchor', 'DIA'::"CoreCredentialType")
)
INSERT INTO "LibraryRecord" (
    "id", "tenantId", "origin",
    "name", "issuerName", "issuerDid", "subjectName", "subjectId", "validFrom", "validUntil",
    "credentialType", "coreCredentialType", "coreDataModelVersion", "detailsStatus", "detailsError",
    "createdAt", "updatedAt"
)
SELECT
    c."id", c."tenantId", 'NATIVE',
    c."name", c."issuerName", c."issuerDid", c."subjectName", c."subjectId", c."validFrom", c."validUntil",
    c."credentialType",
    COALESCE(direct."kind", viaExtension."kind"),
    c."coreDataModelVersion", c."detailsStatus", c."detailsError",
    c."createdAt", c."updatedAt"
FROM "Credential" c
LEFT JOIN core direct ON direct."name" = c."credentialType"
-- Issuance resolved an extension's data model by the requested type and
-- version among the models visible to the tenant: its own and the system
-- tenant's (the rule in listDataModels; the system tenant's id is
-- SYSTEM_TENANT_ID in src/lib/prisma/constants.ts, written here as a
-- literal). The extension version was never recorded, so that choice cannot
-- be replayed exactly. A core kind is derived only when the visible
-- candidates agree: among those whose core parent's version matches the
-- row's recorded core version when any does, else among all of them.
-- Candidates naming two different core kinds leave the row null rather than
-- guess, and so does a candidate whose parent is not a core name at all: it
-- stays in the set (left join) so it can block agreement, never silently
-- dropped. The lookup only runs for a type the direct map did not settle.
LEFT JOIN LATERAL (
    SELECT CASE
        WHEN count(*) FILTER (WHERE cand."versionMatch") > 0 THEN
            CASE WHEN count(*) FILTER (WHERE cand."versionMatch" AND cand."kind" IS NULL) = 0
                  AND count(DISTINCT cand."kind") FILTER (WHERE cand."versionMatch") = 1
                 THEN min(cand."kind"::text) FILTER (WHERE cand."versionMatch") END
        WHEN count(*) FILTER (WHERE cand."kind" IS NULL) = 0
         AND count(DISTINCT cand."kind") = 1 THEN min(cand."kind"::text)
    END::"CoreCredentialType" AS "kind"
    FROM (
        SELECT parentKind."kind", p."version" = c."coreDataModelVersion" AS "versionMatch"
        FROM "DataModel" d
        JOIN "DataModel" p ON p."id" = d."parentConfigId"
        LEFT JOIN core parentKind ON parentKind."name" = p."credentialType"
        WHERE d."credentialType" = c."credentialType"
          AND d."isExtension" = true
          AND (d."tenantId" = c."tenantId" OR d."tenantId" = 'caq0ibyulrnh85itqtbgusfp3')
    ) cand
) viaExtension ON direct."kind" IS NULL;

-- The captured columns now live on the parent (decision 5). Destructive:
-- see the header.
-- AlterTable
ALTER TABLE "Credential" DROP COLUMN "coreDataModelVersion",
DROP COLUMN "credentialType",
DROP COLUMN "detailsError",
DROP COLUMN "detailsStatus",
DROP COLUMN "issuerDid",
DROP COLUMN "issuerName",
DROP COLUMN "name",
DROP COLUMN "subjectId",
DROP COLUMN "subjectName",
DROP COLUMN "validFrom",
DROP COLUMN "validUntil",
ADD COLUMN     "origin" "LibraryRecordOrigin" NOT NULL DEFAULT 'NATIVE';

-- A claim's result column now points at the parent record (#955): the same
-- ids, so the rename keeps every in-flight claim's link intact.
ALTER TABLE "IdempotencyKey" RENAME COLUMN "credentialId" TO "recordId";

-- CreateTable
CREATE TABLE "ExternalCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origin" "LibraryRecordOrigin" NOT NULL DEFAULT 'EXTERNAL',
    "sourceUrl" TEXT,
    "sourceDigest" TEXT,
    "encrypted" BOOLEAN,
    "contentKind" "ExternalContentKind",
    "storageUri" TEXT,
    "storageDigestMultibase" TEXT,
    "storageServiceInstanceId" TEXT,
    "storageExternalId" TEXT,
    "storageBucket" TEXT,
    "decryptionKey" TEXT,
    "displayName" TEXT NOT NULL,
    "declaredCredentialType" "CoreCredentialType" NOT NULL,
    "dateReceived" DATE,
    "notes" TEXT,
    "annotationVersion" INTEGER NOT NULL DEFAULT 1,
    "decryptionKeyUnused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "state" "CheckRunState" NOT NULL,
    "retrieval" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "decryption" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "digest" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "proof" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "status" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "temporal" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "schemaConformance" "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
    "failureCode" "CheckRunFailureCode",
    "failureMessage" TEXT,
    "failureRetryable" BOOLEAN,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastEnqueuedAt" TIMESTAMP(3),

    CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryRecord_tenantId_idx" ON "LibraryRecord"("tenantId");

-- CreateIndex
CREATE INDEX "LibraryRecord_tenantId_origin_idx" ON "LibraryRecord"("tenantId", "origin");

-- CreateIndex
CREATE INDEX "LibraryRecord_tenantId_coreCredentialType_idx" ON "LibraryRecord"("tenantId", "coreCredentialType");

-- CreateIndex
CREATE INDEX "LibraryRecord_tenantId_issuerDid_idx" ON "LibraryRecord"("tenantId", "issuerDid");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRecord_id_tenantId_key" ON "LibraryRecord"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRecord_id_tenantId_origin_key" ON "LibraryRecord"("id", "tenantId", "origin");

-- CreateIndex
CREATE INDEX "ExternalCredential_tenantId_idx" ON "ExternalCredential"("tenantId");

-- CreateIndex
CREATE INDEX "ExternalCredential_tenantId_declaredCredentialType_idx" ON "ExternalCredential"("tenantId", "declaredCredentialType");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCredential_id_tenantId_origin_key" ON "ExternalCredential"("id", "tenantId", "origin");

-- CreateIndex
CREATE INDEX "CheckRun_state_lastEnqueuedAt_idx" ON "CheckRun"("state", "lastEnqueuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckRun_recordId_generation_key" ON "CheckRun"("recordId", "generation");

-- CreateIndex
CREATE INDEX "Credential_organisationId_idx" ON "Credential"("organisationId");

-- CreateIndex
CREATE INDEX "Credential_facilityId_idx" ON "Credential"("facilityId");

-- CreateIndex
CREATE INDEX "Credential_productId_idx" ON "Credential"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_id_tenantId_origin_key" ON "Credential"("id", "tenantId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_recordId_key" ON "IdempotencyKey"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_recordId_tenantId_key" ON "IdempotencyKey"("recordId", "tenantId");

-- AddForeignKey
ALTER TABLE "LibraryRecord" ADD CONSTRAINT "LibraryRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_id_tenantId_origin_fkey" FOREIGN KEY ("id", "tenantId", "origin") REFERENCES "LibraryRecord"("id", "tenantId", "origin") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_recordId_tenantId_fkey" FOREIGN KEY ("recordId", "tenantId") REFERENCES "LibraryRecord"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCredential" ADD CONSTRAINT "ExternalCredential_id_tenantId_origin_fkey" FOREIGN KEY ("id", "tenantId", "origin") REFERENCES "LibraryRecord"("id", "tenantId", "origin") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCredential" ADD CONSTRAINT "ExternalCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_recordId_tenantId_fkey" FOREIGN KEY ("recordId", "tenantId") REFERENCES "LibraryRecord"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Each child table carries its origin so the composite foreign key to the
-- parent can pin it: a Credential attaches only to a NATIVE parent, an
-- ExternalCredential only to an EXTERNAL one, each within its own tenant.
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_origin_check" CHECK ("origin" = 'NATIVE');
ALTER TABLE "ExternalCredential" ADD CONSTRAINT "ExternalCredential_origin_check" CHECK ("origin" = 'EXTERNAL');

-- A record has exactly one child (ADR-053 decision 1). Checked when the
-- transaction commits, so the write paths, which create parent and child
-- together, pass, and a parent left without a child cannot be committed.
-- The write paths insert the parent before the child, so the check has to
-- stay deferred: a session that sets its constraints immediate cannot create
-- a record.
CREATE FUNCTION library_record_has_one_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    children integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "LibraryRecord" WHERE "id" = NEW."id") THEN
        RETURN NULL;
    END IF;
    SELECT (SELECT count(*) FROM "Credential" WHERE "id" = NEW."id")
         + (SELECT count(*) FROM "ExternalCredential" WHERE "id" = NEW."id")
    INTO children;
    IF children <> 1 THEN
        RAISE EXCEPTION 'LibraryRecord % must have exactly one child row, found %', NEW."id", children
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "LibraryRecord_has_one_child"
    AFTER INSERT OR UPDATE OF "id", "tenantId", "origin" ON "LibraryRecord"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION library_record_has_one_child();

-- A constraint trigger checks rows written after it exists, not the rows the
-- data move above wrote, so the migrated parents are checked here once.
DO $$
DECLARE
    orphans integer;
BEGIN
    SELECT count(*) INTO orphans
    FROM "LibraryRecord" r
    WHERE (SELECT count(*) FROM "Credential" c WHERE c."id" = r."id")
        + (SELECT count(*) FROM "ExternalCredential" e WHERE e."id" = r."id") <> 1;
    IF orphans > 0 THEN
        RAISE EXCEPTION 'library_records migration: % LibraryRecord row(s) do not have exactly one child', orphans
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
END $$;

-- The parent is the only delete target. A child deleted while its parent
-- still exists at commit is refused; deleting the parent cascades to the
-- child, so that path is unaffected.
CREATE FUNCTION library_child_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "LibraryRecord" WHERE "id" = OLD."id") THEN
        RAISE EXCEPTION 'Delete LibraryRecord %, not its % child', OLD."id", TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Credential_delete_via_parent"
    AFTER DELETE ON "Credential"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION library_child_delete_guard();

CREATE CONSTRAINT TRIGGER "ExternalCredential_delete_via_parent"
    AFTER DELETE ON "ExternalCredential"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION library_child_delete_guard();

-- Identity (id, tenant, origin) belongs to the record as a whole, so a child
-- row cannot be re-pointed at another parent: changing any of the three on a
-- child is refused. The parent's identity columns cascade to the child, so
-- they are immutable too, which is what "the parent keeps the credential's
-- id" means. Without this, a childless parent created in the same
-- transaction as a child's id change would pass the exactly-one-child check
-- while the child's old parent was left with none.
CREATE FUNCTION library_child_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."origin" IS DISTINCT FROM OLD."origin" THEN
        RAISE EXCEPTION '% %: identity (id, tenantId, origin) cannot change', TG_TABLE_NAME, OLD."id"
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Credential_identity_immutable"
    BEFORE UPDATE OF "id", "tenantId", "origin" ON "Credential"
    FOR EACH ROW EXECUTE FUNCTION library_child_identity_immutable();

CREATE TRIGGER "ExternalCredential_identity_immutable"
    BEFORE UPDATE OF "id", "tenantId", "origin" ON "ExternalCredential"
    FOR EACH ROW EXECUTE FUNCTION library_child_identity_immutable();

-- A credential's entity links are on its response, so a change to them is a
-- change a reader sees and the record's last-modified time moves with it
-- (ADR-053 decision 1). The database does it, because the link also changes
-- when an entity is deleted (ON DELETE SET NULL) and a sweep in the deleting
-- transaction cannot see a link committed after it looked. A key rewrap
-- touches none of these columns, so it stays exempt as decision 1 says.
CREATE OR REPLACE FUNCTION library_record_touch_on_link_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "LibraryRecord" SET "updatedAt" = now() WHERE "id" = NEW."id";
    RETURN NULL;
END;
$$;

CREATE TRIGGER "Credential_link_change_touches_record"
    AFTER UPDATE OF "organisationId", "facilityId", "productId" ON "Credential"
    FOR EACH ROW
    WHEN (OLD."organisationId" IS DISTINCT FROM NEW."organisationId"
       OR OLD."facilityId" IS DISTINCT FROM NEW."facilityId"
       OR OLD."productId" IS DISTINCT FROM NEW."productId")
    EXECUTE FUNCTION library_record_touch_on_link_change();

-- Generations count from 1, and a record has at most one PENDING run: a
-- request arriving while a run is pending joins it instead of racing it
-- (#957), and the partial unique index is what makes the race lose loudly.
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_generation_check" CHECK ("generation" >= 1);
CREATE UNIQUE INDEX "CheckRun_one_pending_per_record" ON "CheckRun"("recordId") WHERE "state" = 'PENDING';

-- The list's issuer filter is case-insensitive on the name (#962).
CREATE INDEX "LibraryRecord_tenantId_lower_issuerName_idx" ON "LibraryRecord"("tenantId", lower("issuerName"));
