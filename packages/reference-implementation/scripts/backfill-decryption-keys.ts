/**
 * Encrypts plaintext credential decryption keys at rest.
 *
 * Credential records written before keys were encrypted at rest (#697) hold
 * the plaintext key returned by the storage service. This script wraps those
 * values in encrypted envelopes in place; rows already holding an envelope
 * are left untouched, so re-running converges to no changes.
 *
 * Usage (from packages/reference-implementation):
 *   pnpm backfill:decryption-keys
 *
 * Requires the RI_POSTGRES_* variables (or a pre-set RI_DATABASE_URL) and
 * DATA_ENCRYPTION_KEY matching the key the application runs with. The run
 * aborts before writing if an existing envelope cannot be decrypted with it.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Construct RI_DATABASE_URL from individual env vars (same as prisma.config.ts)
const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;
if (RI_POSTGRES_USER && RI_POSTGRES_PASSWORD && RI_POSTGRES_DB && RI_POSTGRES_HOST && RI_POSTGRES_PORT) {
  process.env.RI_DATABASE_URL = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;
}

const { prisma } = await import('../src/lib/prisma/prisma.js');
const { backfillDecryptionKeys } = await import('../src/lib/credentials/backfill-decryption-keys.js');

try {
  const result = await backfillDecryptionKeys(prisma);
  if (!result.keyVerified) {
    console.warn(
      'Warning: no existing encrypted key was available to validate DATA_ENCRYPTION_KEY against; ' +
        'ensure it matches the key the application runs with before relying on the wrapped values.',
    );
  }
  console.log(`Backfill complete: ${result.wrapped} wrapped, ${result.alreadyProtected} already protected.`);
} catch (error) {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
