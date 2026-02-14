-- CreateTable
CREATE TABLE "Registrar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "url" TEXT,
    "idrServiceInstanceId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registrar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentifierScheme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registrarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryKey" TEXT NOT NULL,
    "validationPattern" TEXT NOT NULL,
    "namespace" TEXT,
    "idrServiceInstanceId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentifierScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemeQualifier" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "validationPattern" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchemeQualifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identifier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Registrar_tenantId_idx" ON "Registrar"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentifierScheme_registrarId_primaryKey_tenantId_key" ON "IdentifierScheme"("registrarId", "primaryKey", "tenantId");

-- CreateIndex
CREATE INDEX "IdentifierScheme_tenantId_idx" ON "IdentifierScheme"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeQualifier_schemeId_key_key" ON "SchemeQualifier"("schemeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Identifier_schemeId_value_key" ON "Identifier"("schemeId", "value");

-- CreateIndex
CREATE INDEX "Identifier_tenantId_idx" ON "Identifier"("tenantId");

-- AddForeignKey
ALTER TABLE "Registrar" ADD CONSTRAINT "Registrar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registrar" ADD CONSTRAINT "Registrar_idrServiceInstanceId_fkey" FOREIGN KEY ("idrServiceInstanceId") REFERENCES "ServiceInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentifierScheme" ADD CONSTRAINT "IdentifierScheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentifierScheme" ADD CONSTRAINT "IdentifierScheme_registrarId_fkey" FOREIGN KEY ("registrarId") REFERENCES "Registrar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentifierScheme" ADD CONSTRAINT "IdentifierScheme_idrServiceInstanceId_fkey" FOREIGN KEY ("idrServiceInstanceId") REFERENCES "ServiceInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemeQualifier" ADD CONSTRAINT "SchemeQualifier_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "IdentifierScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identifier" ADD CONSTRAINT "Identifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identifier" ADD CONSTRAINT "Identifier_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "IdentifierScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
