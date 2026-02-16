-- AlterEnum (idempotent — values may already exist from add_master_data_entities)
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'STORAGE';

-- AlterEnum (idempotent — values may already exist from add_master_data_entities)
ALTER TYPE "AdapterType" ADD VALUE IF NOT EXISTS 'UNCEFACT_STORAGE';
