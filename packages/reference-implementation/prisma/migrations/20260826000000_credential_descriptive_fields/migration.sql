-- Capture credential descriptive fields at issue time (#952).
-- Pre-existing rows keep NULL names and dates, and EXTRACTION_PENDING. New
-- issuances set EXTRACTED explicitly. EXTRACTION_FAILED is written by the
-- job that reads the pre-existing rows (#953).

-- CreateEnum
CREATE TYPE "CredentialDetailsStatus" AS ENUM ('EXTRACTED', 'EXTRACTION_PENDING', 'EXTRACTION_FAILED');
CREATE TYPE "CredentialDetailsError" AS ENUM ('UNREADABLE_ENVELOPE', 'BRIDGE_ERROR', 'DECRYPT_FAILED');

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN "name" TEXT,
ADD COLUMN "issuerName" TEXT,
ADD COLUMN "issuerDid" TEXT,
ADD COLUMN "subjectName" TEXT,
ADD COLUMN "subjectId" TEXT,
ADD COLUMN "validFrom" TIMESTAMP(3),
ADD COLUMN "validUntil" TIMESTAMP(3),
ADD COLUMN "detailsStatus" "CredentialDetailsStatus" NOT NULL DEFAULT 'EXTRACTION_PENDING',
ADD COLUMN "detailsError" "CredentialDetailsError";
