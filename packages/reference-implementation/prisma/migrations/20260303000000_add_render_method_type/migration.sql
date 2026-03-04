-- CreateEnum
CREATE TYPE "RenderMethodType" AS ENUM ('RenderTemplate2024', 'WebRenderingTemplate2022');

-- AlterTable
ALTER TABLE "RenderTemplate" ADD COLUMN     "inline" BOOLEAN,
ADD COLUMN     "mediaQuery" TEXT,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "renderMethodType" "RenderMethodType",
ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "storageContentType" TEXT,
ADD COLUMN     "storageExternalId" TEXT,
ADD COLUMN     "storageServiceInstanceId" TEXT;

-- Backfill existing records
UPDATE "RenderTemplate" SET
  "renderMethodType" = 'RenderTemplate2024',
  "inline" = false,
  "mediaType" = 'text/html'
WHERE "renderMethodType" IS NULL;

-- Make renderMethodType non-nullable
ALTER TABLE "RenderTemplate" ALTER COLUMN "renderMethodType" SET NOT NULL;
