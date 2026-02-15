-- Rename table
ALTER TABLE "Organization" RENAME TO "Tenant";

-- Rename FK columns
ALTER TABLE "User" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "Did" RENAME COLUMN "organizationId" TO "tenantId";
ALTER TABLE "ServiceInstance" RENAME COLUMN "organizationId" TO "tenantId";

-- Rename indexes (Prisma uses specific naming)
ALTER INDEX "Did_organizationId_idx" RENAME TO "Did_tenantId_idx";
ALTER INDEX "ServiceInstance_organizationId_serviceType_idx" RENAME TO "ServiceInstance_tenantId_serviceType_idx";
