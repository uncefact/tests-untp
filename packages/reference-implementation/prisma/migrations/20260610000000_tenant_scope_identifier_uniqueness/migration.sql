-- DropIndex
DROP INDEX "Identifier_schemeId_value_key";

-- CreateIndex
CREATE UNIQUE INDEX "Identifier_schemeId_value_tenantId_key" ON "Identifier"("schemeId", "value", "tenantId");
