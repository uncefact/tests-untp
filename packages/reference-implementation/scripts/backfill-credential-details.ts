/**
 * Captures descriptive fields onto credential rows issued before those
 * columns existed (#953).
 *
 * Rows still at EXTRACTION_PENDING are fetched from storage, decrypted when
 * the row holds a key, decoded, and written with the library-facing details
 * plus the spec version the matching data-model bridge was resolved with.
 * Rows already EXTRACTED or EXTRACTION_FAILED are left untouched, so
 * re-running converges to no changes.
 *
 * Usage (from packages/reference-implementation, source checkout):
 *   pnpm backfill:credential-details [-- --dry-run]
 *
 * Usage (inside the published Docker image, which carries no package
 * manifest for this package, so the pnpm alias has no script to resolve):
 *   docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-credential-details.ts [--dry-run]
 *
 * Requires a database target: a pre-set RI_DATABASE_URL is honoured as given,
 * and the RI_POSTGRES_* variables are used to construct one only when it is
 * absent. `--dry-run` reports which rows would change and which would fail
 * without writing anything.
 *
 * Operator-run rather than automatic because the job fetches every tenant's
 * stored artefact. A wrong details write is not itself destructive to the
 * stored credential, but the fetch is an external side effect and the window
 * of EXTRACTION_PENDING rows should be closed by a human immediately after
 * the descriptive-column migration deploys. See
 * docs/adrs/043-data-backfill-conventions.md for that rule and where each
 * kind of backfill lives.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DOCS_URL =
  'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/operations/backfills/credential-details';

const dryRun = process.argv.includes('--dry-run');

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
const { backfillCredentialDetails } = await import('../src/lib/credentials/backfill-credential-details.js');

try {
  const result = await backfillCredentialDetails(prisma, { dryRun });
  const verb = dryRun ? 'would update' : 'updated';
  const failVerb = dryRun ? 'would fail' : 'failed';
  console.log(
    `${dryRun ? 'Dry run' : 'Backfill complete'}: ${result.scanned} scanned, ${result.updated} ${verb}, ${
      result.failed
    } ${failVerb}.`,
  );
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(`${failure.id} ${failure.errorClass}: ${failure.message}`);
    }
    console.error(`See ${DOCS_URL}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Backfill failed:', error);
  console.error(`See ${DOCS_URL}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
