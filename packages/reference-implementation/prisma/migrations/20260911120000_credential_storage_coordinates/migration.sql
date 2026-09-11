-- Where a native credential's durable copy lives, recorded at issuance so
-- DELETE /api/v1/credentials/{id} can remove exactly that object. Rows issued
-- before this migration keep nulls; deleting them leaves their copy in place.
ALTER TABLE "Credential" ADD COLUMN "storageServiceInstanceId" TEXT;
ALTER TABLE "Credential" ADD COLUMN "storageExternalId" TEXT;
ALTER TABLE "Credential" ADD COLUMN "storageBucket" TEXT;
