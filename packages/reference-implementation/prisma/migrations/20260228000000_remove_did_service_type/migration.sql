-- AlterEnum: remove DID from ServiceType
-- First delete any remaining DID service instances to avoid FK constraint violations
DELETE FROM "ServiceInstance" WHERE "serviceType" = 'DID';

-- Create new enum without DID
CREATE TYPE "ServiceType_new" AS ENUM ('IDR', 'STORAGE', 'VC');

-- Alter the column to use the new enum
ALTER TABLE "ServiceInstance" ALTER COLUMN "serviceType" TYPE "ServiceType_new" USING ("serviceType"::text::"ServiceType_new");

-- Drop old enum and rename new one
DROP TYPE "ServiceType";
ALTER TYPE "ServiceType_new" RENAME TO "ServiceType";
