import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseOperatorArgs } from './parse-operator-args.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { values } = parseOperatorArgs(process.argv.slice(2), {
  'dry-run': { type: 'boolean', default: false },
  'retry-failed': { type: 'boolean', default: false },
  tenant: { type: 'string' },
});
const dryRun = values['dry-run'] === true;
const retryFailed = values['retry-failed'] === true;
const tenantId = typeof values.tenant === 'string' ? values.tenant : undefined;
if (typeof values.tenant === 'string' && values.tenant.trim() === '') {
  throw new Error('--tenant requires a non-blank tenant id');
}
const { databaseUrlFromEnvParts } = await import('../src/lib/prisma/database-url.js');
const constructedDatabaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) process.env.RI_DATABASE_URL = constructedDatabaseUrl;

const { prisma } = await import('../src/lib/prisma/prisma.js');
const {
  backfillCredentialStatusEntries,
  credentialStatusBackfillExitCode,
  formatCredentialStatusCapture,
  isRetryableCredentialStatusBackfillFailure,
} = await import('../src/lib/credentials/backfill-credential-status-entries.js');

try {
  const result = await backfillCredentialStatusEntries(prisma, {
    dryRun,
    retryFailed,
    ...(tenantId === undefined ? {} : { tenantId }),
  });
  const scope = tenantId === undefined ? 'deployment' : `tenant ${tenantId}`;
  console.log(
    `${dryRun ? 'Dry run' : 'Backfill complete'} for scope ${scope}: ${result.scanned} scanned, ${
      result.captured
    } captured, ${result.failed} failed this run${
      retryFailed ? ' (including retryable failures)' : ''
    }. FAILED rows remaining: ${result.failedRows}${formatFailureBreakdown(
      result.failedByClass,
    )}. Exit gate: ${credentialStatusBackfillExitCode(result)}.`,
  );
  for (const row of result.capturedRows) console.log(formatCredentialStatusCapture(row, dryRun));
  for (const failure of result.failures) {
    console.error(`${failure.id} ${failure.errorClass}: ${failure.message}`);
  }
  const inspectionRows = result.remainingFailures.filter(
    ({ errorClass }) => !isRetryableCredentialStatusBackfillFailure(errorClass),
  );
  if (inspectionRows.length > 0) {
    console.error('Needs inspection:');
    console.error(`Counts: ${formatFailureBreakdown(countByClass(inspectionRows))}.`);
    for (const row of inspectionRows) console.error(`${row.id} ${row.errorClass}`);
  }
  process.exitCode = credentialStatusBackfillExitCode(result);
} catch (error) {
  console.error('Credential-status backfill failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function formatFailureBreakdown(byClass: Record<string, number>): string {
  const entries = Object.entries(byClass).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? '' : ` (${entries.map(([errorClass, count]) => `${errorClass}=${count}`).join(', ')})`;
}

function countByClass(rows: Array<{ errorClass: string }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.errorClass] = (counts[row.errorClass] ?? 0) + 1;
    return counts;
  }, {});
}
