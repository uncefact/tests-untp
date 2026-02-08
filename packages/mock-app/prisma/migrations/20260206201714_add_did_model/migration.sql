-- CreateEnum
CREATE TYPE "DidType" AS ENUM ('DEFAULT', 'MANAGED', 'SELF_MANAGED');

-- CreateEnum
CREATE TYPE "DidMethod" AS ENUM ('DID_WEB', 'DID_WEB_VH');

-- CreateEnum
CREATE TYPE "DidStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'VERIFIED', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "Did" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "type" "DidType" NOT NULL,
    "method" "DidMethod" NOT NULL DEFAULT 'DID_WEB',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keyId" TEXT NOT NULL,
    "status" "DidStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Did_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Did_did_key" ON "Did"("did");

-- CreateIndex
CREATE INDEX "Did_organizationId_idx" ON "Did"("organizationId");

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
