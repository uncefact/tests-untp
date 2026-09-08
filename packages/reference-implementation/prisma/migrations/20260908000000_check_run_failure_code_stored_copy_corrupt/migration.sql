-- AlterEnum
-- A durable copy that reads back but does not match the digest recorded when
-- it was stored settles as STORED_COPY_CORRUPT rather than sharing
-- STORED_COPY_UNAVAILABLE with a copy that could not be read at all.
ALTER TYPE "CheckRunFailureCode" ADD VALUE 'STORED_COPY_CORRUPT';
