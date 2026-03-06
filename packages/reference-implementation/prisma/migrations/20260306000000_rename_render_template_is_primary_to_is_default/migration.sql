-- AlterTable: rename isPrimary to isDefault on RenderTemplate
ALTER TABLE "RenderTemplate" RENAME COLUMN "isPrimary" TO "isDefault";
