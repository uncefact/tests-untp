-- AlterTable: rename hash to digestMultibase on Credential
ALTER TABLE "Credential" RENAME COLUMN "hash" TO "digestMultibase";

-- AlterTable: rename hash to digestMultibase on RenderTemplate
ALTER TABLE "RenderTemplate" RENAME COLUMN "hash" TO "digestMultibase";
