-- AlterTable
ALTER TABLE "CvcCatalogue" ADD COLUMN "specVersion" TEXT NOT NULL DEFAULT '0.7.0';

-- Remove the default after backfilling existing rows
ALTER TABLE "CvcCatalogue" ALTER COLUMN "specVersion" DROP DEFAULT;
