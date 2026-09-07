-- AlterEnum
-- A no-copy recovery whose re-fetch returns a body that neither is the row's
-- held credential nor unopened ciphertext of it (HTML, another JSON object,
-- or opaque bytes) settles with this code rather than being misclassified as
-- a storage failure or a verification-service outage, and rather than
-- treating that body as the credential's replacement content.
ALTER TYPE "CheckRunFailureCode" ADD VALUE 'SOURCE_NOT_CREDENTIAL';
