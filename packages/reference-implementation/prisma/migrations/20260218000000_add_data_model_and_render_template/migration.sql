-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('DigitalProductPassport', 'DigitalConformityCredential', 'DigitalFacilityRecord', 'DigitalIdentityAnchor', 'DigitalTraceabilityEvent');

-- CreateTable
CREATE TABLE "DataModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "credentialType" "CredentialType" NOT NULL,
    "version" TEXT NOT NULL,
    "isExtension" BOOLEAN NOT NULL DEFAULT true,
    "parentConfigId" TEXT,
    "schemaUrl" TEXT NOT NULL,
    "contextUrl" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataModel_credentialType_version_tenantId_isExtension_name_key" ON "DataModel"("credentialType", "version", "tenantId", "isExtension", "name");

-- CreateIndex
CREATE INDEX "RenderTemplate_tenantId_dataModelId_idx" ON "RenderTemplate"("tenantId", "dataModelId");

-- AddForeignKey
ALTER TABLE "DataModel" ADD CONSTRAINT "DataModel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataModel" ADD CONSTRAINT "DataModel_parentConfigId_fkey" FOREIGN KEY ("parentConfigId") REFERENCES "DataModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderTemplate" ADD CONSTRAINT "RenderTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderTemplate" ADD CONSTRAINT "RenderTemplate_dataModelId_fkey" FOREIGN KEY ("dataModelId") REFERENCES "DataModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
