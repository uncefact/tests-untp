/**
 * Encrypts plaintext credential decryption keys at rest.
 *
 * Credential records written before keys were encrypted at rest (#697) hold
 * the plaintext key returned by the storage service. This script wraps those
 * values in encrypted envelopes in place; rows already holding an envelope
 * are left untouched, so re-running converges to no changes.
 *
 * Usage (from packages/reference-implementation, source checkout):
 *   pnpm backfill:decryption-keys [-- --force]
 *
 * Usage (inside the published Docker image, which carries no package
 * manifest for this package, so the pnpm alias has no script to resolve):
 *   docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-decryption-keys.ts [--force]
 *
 * Requires DATA_ENCRYPTION_KEY matching the key the application runs with,
 * and a database target: a pre-set RI_DATABASE_URL is honoured as given, and
 * the RI_POSTGRES_* variables are used to construct one only when it is
 * absent. Before writing anything, the run decrypts every existing envelope
 * (credential keys and service instance configurations) and aborts on any
 * failure; when no envelope exists to check against, it refuses to write
 * unless --force is passed.
 *
 * Operator-run rather than automatic because a wrap cannot be turned back:
 * under the wrong DATA_ENCRYPTION_KEY nobody can unwrap the result, and even
 * a correct wrap is a one-way door for the deployment, since an earlier
 * application version reads an envelope as raw JSON. A human chooses that
 * moment. See docs/adrs/043-data-backfill-conventions.md for that rule, the
 * preflight requirement, and where each kind of backfill lives.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DOCS_URL =
  'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/api/credentials#encryption-and-privacy';

const force = process.argv.includes('--force');

// Honour a pre-set RI_DATABASE_URL; construct from parts only when absent
// (same rule as docker-entrypoint.sh). Guarded assignment: process.env
// coerces undefined to the string "undefined", which would later read as a
// configured (nonsense) connection target.
const { databaseUrlFromEnvParts } = await import('../src/lib/prisma/database-url.js');
const constructedDatabaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) {
  process.env.RI_DATABASE_URL = constructedDatabaseUrl;
}

const { prisma } = await import('../src/lib/prisma/prisma.js');
const { backfillDecryptionKeys, KeyUnverifiedError } = await import(
  '../src/lib/credentials/backfill-decryption-keys.js'
);

if (force) {
  console.warn(
    'Warning: --force supplied. If no existing envelope proves DATA_ENCRYPTION_KEY, plaintext keys ' +
      'will be wrapped without verification, which is unrecoverable under a wrong key. Ensure a ' +
      'database backup exists and the key has been verified out of band before relying on this run.',
  );
}

try {
  const result = await backfillDecryptionKeys(prisma, { force });
  if (!result.keyVerified) {
    console.warn(
      'Warning: no existing encrypted value was available to validate DATA_ENCRYPTION_KEY against; ' +
        'verify a wrapped key decrypts correctly (for example via GET /api/v1/credentials/{id}) before ' +
        'relying on the wrapped values.',
    );
  }
  if (result.suspectRowIds.length > 0) {
    console.error(
      `Skipped ${result.suspectRowIds.length} row(s) whose stored value resembles a corrupted encrypted ` +
        `envelope and cannot be treated as a legacy plaintext key: ${result.suspectRowIds.join(', ')}. ` +
        `Inspect these rows manually. See ${DOCS_URL}`,
    );
    process.exitCode = 1;
  }
  if (result.deletedRowIds.length > 0) {
    console.warn(
      `${result.deletedRowIds.length} row(s) were deleted while the backfill ran and were skipped: ` +
        `${result.deletedRowIds.join(', ')}.`,
    );
  }
  const counts = `${result.wrapped} wrapped, ${result.alreadyProtected} already protected`;
  if (result.suspectRowIds.length > 0) {
    console.log(`Backfill finished with skipped suspect rows: ${counts}, ${result.suspectRowIds.length} skipped.`);
  } else {
    console.log(`Backfill complete: ${counts}.`);
  }
} catch (error) {
  if (error instanceof KeyUnverifiedError) {
    console.error(`${error.message}\nSee ${DOCS_URL}`);
  } else {
    console.error('Backfill failed:', error);
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
