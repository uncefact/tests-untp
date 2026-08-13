-- Row provenance for seedable entities (ADR-033, 2026-08-12 update; #727).
-- Every pre-existing row defaults to USER, so nothing predating this feature
-- is deletable by the custom-seed reconcile; rows come under manifest
-- management when the seed next upserts them, and core seed stamps CORE_SEED
-- onto the rows it owns.

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('CORE_SEED', 'CUSTOM_SEED', 'USER');

-- AlterTable
ALTER TABLE "Registrar" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "IdentifierScheme" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "SchemeQualifier" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "DataModel" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "RenderTemplate" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'USER';
