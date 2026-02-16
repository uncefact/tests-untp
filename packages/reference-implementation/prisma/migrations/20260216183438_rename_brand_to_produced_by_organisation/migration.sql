-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_brandOrganisationId_fkey";

-- RenameColumn (data-preserving)
ALTER TABLE "Product" RENAME COLUMN "brandOrganisationId" TO "producedByOrganisationId";

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_producedByOrganisationId_fkey" FOREIGN KEY ("producedByOrganisationId") REFERENCES "OrganisationEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
