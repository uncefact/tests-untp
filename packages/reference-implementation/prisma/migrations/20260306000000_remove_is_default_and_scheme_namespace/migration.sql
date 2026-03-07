-- AlterTable
ALTER TABLE "IdentifierScheme" DROP COLUMN "isDefault",
DROP COLUMN "namespace";

-- AlterTable
ALTER TABLE "Registrar" DROP COLUMN "isDefault";
