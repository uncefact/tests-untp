-- CreateTable
CREATE TABLE "LinkRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,
    "idrLinkId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "resolverUri" TEXT NOT NULL,
    "qualifierPath" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkRegistration_tenantId_idx" ON "LinkRegistration"("tenantId");

-- CreateIndex
CREATE INDEX "LinkRegistration_identifierId_idx" ON "LinkRegistration"("identifierId");

-- AddForeignKey
ALTER TABLE "LinkRegistration" ADD CONSTRAINT "LinkRegistration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkRegistration" ADD CONSTRAINT "LinkRegistration_identifierId_fkey" FOREIGN KEY ("identifierId") REFERENCES "Identifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
