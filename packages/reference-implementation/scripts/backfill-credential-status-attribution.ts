import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

const tenantId = option('--tenant');
const instanceId = option('--instance');
const reason = option('--reason');
const dryRun = process.argv.includes('--dry-run');
const reassign = process.argv.includes('--reassign');
const { databaseUrlFromEnvParts } = await import('../src/lib/prisma/database-url.js');
const constructedDatabaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && constructedDatabaseUrl) process.env.RI_DATABASE_URL = constructedDatabaseUrl;

const { prisma } = await import('../src/lib/prisma/prisma.js');
const { attributeCredentialStatusInstance } = await import(
  '../src/lib/credentials/attribute-credential-status-instance.js'
);

try {
  const result = await attributeCredentialStatusInstance({ tenantId, instanceId, reason, dryRun, reassign }, prisma);
  for (const report of result.reports) {
    if (!report.attributed) continue;
    const evidence =
      report.evidence.outcome === 'agrees' ? 'agrees' : `${report.evidence.outcome}: ${report.evidence.message}`;
    console.log(`${dryRun ? 'would attribute' : 'attributed'} ${report.credentialId} (evidence: ${evidence})`);
  }
  const evidenceRows = result.reports.filter((report) => report.evidence.outcome !== 'agrees').length;
  console.log(
    `${dryRun ? 'would attribute' : 'attributed'} ${
      result.attributed
    } (evidence disagreed or unavailable for ${evidenceRows}, listed above)`,
  );
  for (const failure of result.writeFailures) {
    console.error(`${failure.credentialId}: ${failure.message}`);
  }
  if (result.writeFailures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('Credential-status attribution failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
