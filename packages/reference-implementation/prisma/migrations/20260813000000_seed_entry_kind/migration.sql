-- Seed entry provenance for SYSTEM_SEED conformity schemes (#728): URL rows
-- are re-fetchable by the periodic refresh; FILE rows refresh at boot from
-- the mounted seed file. Pre-existing rows stay NULL and are treated as URL
-- when their sourceUrl is http(s), until the next seed run stamps them.

-- CreateEnum
CREATE TYPE "SeedEntryKind" AS ENUM ('URL', 'FILE');

-- AlterTable
ALTER TABLE "ConformityScheme" ADD COLUMN "seedEntryKind" "SeedEntryKind";
