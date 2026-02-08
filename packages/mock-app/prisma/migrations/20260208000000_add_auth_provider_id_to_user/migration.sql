-- AlterTable
ALTER TABLE "User" ADD COLUMN "authProviderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_authProviderId_key" ON "User"("authProviderId");
