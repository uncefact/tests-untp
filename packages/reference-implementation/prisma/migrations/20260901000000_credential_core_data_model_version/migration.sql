-- Store the spec version the data-model bridge was resolved with (#953).
-- Nullable, no default: existing rows stay null until the operator-run
-- backfill derives and writes the version. Not a foreign key to DataModel.

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN "coreDataModelVersion" TEXT;
