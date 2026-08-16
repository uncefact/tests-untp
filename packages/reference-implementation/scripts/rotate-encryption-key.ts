/**
 * Rotates data encrypted at rest from a previous DATA_ENCRYPTION_KEY to the
 * current one.
 *
 * Re-encrypts every stored envelope (service instance configurations and
 * credential decryption keys) that opens under the outgoing key so it opens
 * under the active key. Aborts before any write when a stored envelope
 * opens under neither key or a service configuration is corrupted.
 * Idempotent: re-running with the same key pair converges, including after
 * a mid-run failure.
 *
 * Usage (from packages/reference-implementation, source checkout):
 *   pnpm rotate:encryption-key
 *
 * Usage (inside the published Docker image, which carries no package
 * manifest for this package, so the pnpm alias has no script to resolve.
 * Both keys arrive from .env via compose, and the SKIP_ variables stop
 * the entrypoint's seed, whose own key validation fails by design while
 * the database is still under the old key):
 *   docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
 *     ri node_modules/.bin/tsx scripts/rotate-encryption-key.ts
 *
 * Requires DATA_ENCRYPTION_KEY (the NEW key), OUTGOING_DATA_ENCRYPTION_KEY
 * (the PREVIOUS key), and a database target: a pre-set RI_DATABASE_URL is
 * honoured as given, and the RI_POSTGRES_* variables are used to construct
 * one only when it is absent.
 *
 * Stop every application instance before running this (see the rotation
 * procedure in the operations documentation): the scan is not transactional,
 * and a live writer racing the rotation is reported as a conflict rather
 * than rotated.
 *
 * Exit codes: 0 when every stored envelope ended under the active key;
 * 1 when the run was blocked, finished incomplete (suspect, conflicting, or
 * deleted rows), or could not complete (the output distinguishes these).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DOCS_URL =
  'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/operations/encryption-key-rotation';

// Honour a pre-set RI_DATABASE_URL; construct from parts only when absent
// (same rule as docker-entrypoint.sh). Guarded assignment: process.env
// coerces undefined to the string "undefined", which would later read as a
// configured (nonsense) connection target.
const { databaseUrlFromEnvParts } = await import('../src/lib/prisma/database-url.js');
const constructedDatabaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) {
  process.env.RI_DATABASE_URL = constructedDatabaseUrl;
}

const { createLogger } = await import('@uncefact/untp-ri-services/logging');
const { rotateEncryptionKey, buildRotationReport, validateRotationKeys } = await import(
  '../src/lib/credentials/rotate-encryption-key.js'
);

// The whole key gate (named missing-variable errors, format validation,
// the placeholder policy on the active key, warnings for a placeholder
// outgoing key and identical keys) runs before any database work; see
// validateRotationKeys for the order and rationale.
const logger = createLogger().child({ module: 'rotate-encryption-key' });
const validation = validateRotationKeys(process.env, logger);
if (!validation.ok) {
  console.error(`${validation.error} See ${DOCS_URL}`);
  // process.exit rather than exitCode: nothing is connected yet (prisma is
  // imported below this gate), and top-level execution must stop here.
  process.exit(1);
}
for (const warning of validation.warnings) {
  console.warn(`Warning: ${warning}`);
}

const { prisma } = await import('../src/lib/prisma/prisma.js');

try {
  const result = await rotateEncryptionKey(prisma, validation.services, {
    // Printed before the first write, so a mid-run failure still leaves
    // the operator the classification readout.
    onPreflight: (summary) => {
      const candidates = summary.serviceInstances.outgoingOpened + summary.credentials.outgoingOpened;
      console.log(
        `Preflight: service instances ${summary.serviceInstances.alreadyActive} already active, ` +
          `${summary.serviceInstances.outgoingOpened} to rotate; credentials ` +
          `${summary.credentials.alreadyActive} already active, ${summary.credentials.outgoingOpened} to rotate, ` +
          `${summary.credentials.suspects} suspect, ${summary.credentials.plaintext} legacy plaintext. ` +
          (candidates > 0 ? 'Writing...' : 'Nothing to write.'),
      );
    },
  });
  const report = buildRotationReport(result, DOCS_URL);
  for (const line of report.lines) {
    (line.stream === 'err' ? console.error : console.log)(line.text);
  }
  process.exitCode = report.exitCode;
} catch (error) {
  console.error('Rotation could not complete:', error);
  console.error(`See ${DOCS_URL}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
