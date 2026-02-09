-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('DID');

-- CreateEnum
CREATE TYPE "AdapterType" AS ENUM ('VCKIT');

-- CreateTable
CREATE TABLE "ServiceInstance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "adapterType" "AdapterType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceInstance_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Did" ADD COLUMN "serviceInstanceId" TEXT;

-- CreateIndex
CREATE INDEX "ServiceInstance_organizationId_serviceType_idx" ON "ServiceInstance"("organizationId", "serviceType");

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_serviceInstanceId_fkey" FOREIGN KEY ("serviceInstanceId") REFERENCES "ServiceInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInstance" ADD CONSTRAINT "ServiceInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
