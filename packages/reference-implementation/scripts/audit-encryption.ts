/**
 * Read-only audit of data encrypted at rest under DATA_ENCRYPTION_KEY.
 *
 * Attempts to decrypt every stored envelope (service instance configurations
 * and credential decryption keys) under the active key and reports the
 * result per store, without writing anything. Run it before a key rotation,
 * after a database restore, and during incident triage; it also doubles as
 * the dry run for `backfill:decryption-keys`, reporting what that command
 * would change.
 *
 * Usage (from packages/reference-implementation, source checkout):
 *   pnpm audit:encryption
 *
 * Usage (inside the published Docker image, which ships no pnpm):
 *   docker compose exec -w /app ri node_modules/.bin/tsx scripts/audit-encryption.ts
 *
 * Requires DATA_ENCRYPTION_KEY and a database target: a pre-set
 * RI_DATABASE_URL is honoured as given, and the RI_POSTGRES_* variables are
 * used to construct one only when it is absent.
 *
 * The scan is best-effort under concurrent writes: quiesce writers when the
 * result gates a rotation or a restore; a run against a live system is a
 * point-in-time report.
 *
 * Exit codes: 0 when every envelope decrypted cleanly (including when
 * nothing existed to verify the key against, which is stated explicitly);
 * 1 when any decrypt failure or corrupted row was found, or the audit could
 * not complete (the output distinguishes the two).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DOCS_URL = 'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/operations/encryption-audit';

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
const { auditEncryption, buildAuditReport } = await import('../src/lib/credentials/audit-encryption.js');
const { getEncryptionService } = await import('../src/lib/encryption/encryption.js');

try {
  const result = await auditEncryption(prisma, getEncryptionService());
  const report = buildAuditReport(result, DOCS_URL);
  for (const line of report.lines) {
    (line.stream === 'err' ? console.error : console.log)(line.text);
  }
  process.exitCode = report.exitCode;
} catch (error) {
  console.error('Audit could not complete:', error);
  console.error(`See ${DOCS_URL}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
