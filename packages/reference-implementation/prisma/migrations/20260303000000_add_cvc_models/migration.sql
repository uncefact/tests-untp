-- CreateTable
CREATE TABLE "CvcCatalogue" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "CvcCatalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformityScheme" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogueId" TEXT NOT NULL,

    CONSTRAINT "ConformityScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformityProfile" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,

    CONSTRAINT "ConformityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "conformityTopic" TEXT,
    "passThreshold" JSONB,
    "documentation" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileCriterion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,

    CONSTRAINT "ProfileCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvcCatalogue_tenantId_idx" ON "CvcCatalogue"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CvcCatalogue_canonicalId_tenantId_key" ON "CvcCatalogue"("canonicalId", "tenantId");

-- CreateIndex
CREATE INDEX "ConformityScheme_catalogueId_idx" ON "ConformityScheme"("catalogueId");

-- CreateIndex
CREATE UNIQUE INDEX "ConformityScheme_canonicalId_tenantId_key" ON "ConformityScheme"("canonicalId", "tenantId");

-- CreateIndex
CREATE INDEX "ConformityProfile_schemeId_idx" ON "ConformityProfile"("schemeId");

-- CreateIndex
CREATE UNIQUE INDEX "ConformityProfile_canonicalId_tenantId_key" ON "ConformityProfile"("canonicalId", "tenantId");

-- CreateIndex
CREATE INDEX "Criterion_tenantId_idx" ON "Criterion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_canonicalId_tenantId_key" ON "Criterion"("canonicalId", "tenantId");

-- CreateIndex
CREATE INDEX "ProfileCriterion_criterionId_idx" ON "ProfileCriterion"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileCriterion_profileId_criterionId_key" ON "ProfileCriterion"("profileId", "criterionId");

-- AddForeignKey
ALTER TABLE "CvcCatalogue" ADD CONSTRAINT "CvcCatalogue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformityScheme" ADD CONSTRAINT "ConformityScheme_catalogueId_fkey" FOREIGN KEY ("catalogueId") REFERENCES "CvcCatalogue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConformityProfile" ADD CONSTRAINT "ConformityProfile_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "ConformityScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileCriterion" ADD CONSTRAINT "ProfileCriterion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ConformityProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileCriterion" ADD CONSTRAINT "ProfileCriterion_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
