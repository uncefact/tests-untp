-- AlterTable: change credentialType from enum to plain text
ALTER TABLE "DataModel" ALTER COLUMN "credentialType" SET DATA TYPE TEXT;

-- DropEnum (no longer referenced by any model)
DROP TYPE "CredentialType";
