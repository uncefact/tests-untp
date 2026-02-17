-- AlterTable: Add linkTemplate to IdentifierScheme
-- Two-step approach: add as nullable with default, backfill, then make required
ALTER TABLE "IdentifierScheme" ADD COLUMN "linkTemplate" TEXT NOT NULL DEFAULT '/{primaryKey}/{value}';

-- Remove the default so future inserts must provide the value explicitly
ALTER TABLE "IdentifierScheme" ALTER COLUMN "linkTemplate" DROP DEFAULT;

-- AlterTable: Add order to SchemeQualifier with a default of 0
ALTER TABLE "SchemeQualifier" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
