-- Add apiVersion column with default for backfill
ALTER TABLE "ServiceInstance" ADD COLUMN "apiVersion" TEXT NOT NULL DEFAULT '1.1.0';
