-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "facilityId" TEXT,
ADD COLUMN     "organisationId" TEXT,
ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "Credential_tenantId_idx" ON "Credential"("tenantId");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "OrganisationEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
