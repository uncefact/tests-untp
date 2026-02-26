-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "externalIdpGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_externalIdpGroupId_key" ON "Tenant"("externalIdpGroupId");
