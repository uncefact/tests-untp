-- Claim an Idempotency-Key before irreversible work (#954).
-- A deleted credential cascades its key away, so a reuse then proceeds as a first request.

-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('CREDENTIAL_ISSUE', 'LIBRARY_REGISTER');

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "key" TEXT NOT NULL,
    "bodyDigest" TEXT NOT NULL,
    "credentialId" TEXT,
    "resultRecordedAt" TIMESTAMP(3),
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_credentialId_key" ON "IdempotencyKey"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_tenantId_operation_key_key" ON "IdempotencyKey"("tenantId", "operation", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
