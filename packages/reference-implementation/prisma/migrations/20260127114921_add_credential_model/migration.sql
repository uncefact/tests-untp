-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "decryptionKey" TEXT,
    "credentialType" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);
