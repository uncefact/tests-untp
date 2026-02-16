/*
  Warnings:

  - Made the column `validationPattern` on table `SchemeQualifier` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ProductLevel" AS ENUM ('MODEL', 'BATCH', 'ITEM');

-- AlterEnum
ALTER TYPE "AdapterType" ADD VALUE 'UNCEFACT_STORAGE';

-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'STORAGE';

-- AlterTable
ALTER TABLE "SchemeQualifier" ALTER COLUMN "validationPattern" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" RENAME CONSTRAINT "Organization_pkey" TO "Tenant_pkey";

-- CreateTable
CREATE TABLE "OrganisationEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" JSONB,
    "primaryIdentifierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" JSONB,
    "operatingOrganisationId" TEXT,
    "primaryIdentifierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" "ProductLevel" NOT NULL,
    "parentId" TEXT,
    "brandOrganisationId" TEXT,
    "manufacturingFacilityId" TEXT,
    "primaryIdentifierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationSecondaryIdentifier" (
    "organisationId" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,

    CONSTRAINT "OrganisationSecondaryIdentifier_pkey" PRIMARY KEY ("organisationId","identifierId")
);

-- CreateTable
CREATE TABLE "FacilitySecondaryIdentifier" (
    "facilityId" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,

    CONSTRAINT "FacilitySecondaryIdentifier_pkey" PRIMARY KEY ("facilityId","identifierId")
);

-- CreateTable
CREATE TABLE "ProductSecondaryIdentifier" (
    "productId" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,

    CONSTRAINT "ProductSecondaryIdentifier_pkey" PRIMARY KEY ("productId","identifierId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationEntity_primaryIdentifierId_key" ON "OrganisationEntity"("primaryIdentifierId");

-- CreateIndex
CREATE INDEX "OrganisationEntity_tenantId_idx" ON "OrganisationEntity"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_primaryIdentifierId_key" ON "Facility"("primaryIdentifierId");

-- CreateIndex
CREATE INDEX "Facility_tenantId_idx" ON "Facility"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_primaryIdentifierId_key" ON "Product"("primaryIdentifierId");

-- CreateIndex
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");

-- CreateIndex
CREATE INDEX "Product_parentId_idx" ON "Product"("parentId");

-- RenameForeignKey
ALTER TABLE "Did" RENAME CONSTRAINT "Did_organizationId_fkey" TO "Did_tenantId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceInstance" RENAME CONSTRAINT "ServiceInstance_organizationId_fkey" TO "ServiceInstance_tenantId_fkey";

-- RenameForeignKey
ALTER TABLE "User" RENAME CONSTRAINT "User_organizationId_fkey" TO "User_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "OrganisationEntity" ADD CONSTRAINT "OrganisationEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationEntity" ADD CONSTRAINT "OrganisationEntity_primaryIdentifierId_fkey" FOREIGN KEY ("primaryIdentifierId") REFERENCES "Identifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_operatingOrganisationId_fkey" FOREIGN KEY ("operatingOrganisationId") REFERENCES "OrganisationEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_primaryIdentifierId_fkey" FOREIGN KEY ("primaryIdentifierId") REFERENCES "Identifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandOrganisationId_fkey" FOREIGN KEY ("brandOrganisationId") REFERENCES "OrganisationEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturingFacilityId_fkey" FOREIGN KEY ("manufacturingFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_primaryIdentifierId_fkey" FOREIGN KEY ("primaryIdentifierId") REFERENCES "Identifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSecondaryIdentifier" ADD CONSTRAINT "OrganisationSecondaryIdentifier_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "OrganisationEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSecondaryIdentifier" ADD CONSTRAINT "OrganisationSecondaryIdentifier_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "Identifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySecondaryIdentifier" ADD CONSTRAINT "FacilitySecondaryIdentifier_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySecondaryIdentifier" ADD CONSTRAINT "FacilitySecondaryIdentifier_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "Identifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSecondaryIdentifier" ADD CONSTRAINT "ProductSecondaryIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSecondaryIdentifier" ADD CONSTRAINT "ProductSecondaryIdentifier_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "Identifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
