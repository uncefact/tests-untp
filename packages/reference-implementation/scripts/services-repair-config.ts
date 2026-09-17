/**
 * Replaces a VC instance configuration while preserving unresolved status intents.
 * Checkout: pnpm services:repair-config --instance <id> --config <json-file> --allow-pending
 * Image: docker compose exec -w /app ri node_modules/.bin/tsx scripts/services-repair-config.ts --instance <id> --config <json-file> --allow-pending
 * Stop admission, drain and establish provider quiescence before repair and reconciliation.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const DOCS_URL =
  'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/operations/credential-status-recovery';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });
const { databaseUrlFromEnvParts } = await import('../src/lib/prisma/database-url.js');
const databaseUrl = databaseUrlFromEnvParts();
if (!process.env.RI_DATABASE_URL && databaseUrl) process.env.RI_DATABASE_URL = databaseUrl;
const { prisma } = await import('../src/lib/prisma/prisma.js');
const { repairServiceConfig } = await import('../src/lib/services/repair-config.js');
try {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values, tokens } = parseArgs({
    args,
    tokens: true,
    options: {
      instance: { type: 'string' },
      config: { type: 'string' },
      'allow-pending': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error(`--${token.name} must be supplied only once.`);
    seen.add(token.name);
  }
  if (!values.instance?.trim() || !values.config?.trim())
    throw new Error('--instance <id> and --config <json-file> are required.');
  const config: unknown = JSON.parse(await readFile(values.config, 'utf8'));
  const result = await repairServiceConfig({
    instanceId: values.instance,
    config,
    allowPending: values['allow-pending'],
  });
  console.log(
    `Repaired instance ${result.instanceId}; recorded replacement digest ${result.replacementDigest} on ${result.pendingEntries} pending entry(s). Tokens, original configuration pins and attribution are unchanged. Reconcile each affected entry with acceptProviderChange: true.`,
  );
} catch (error) {
  console.error('Service configuration repair failed:', error);
  console.error(`See ${DOCS_URL}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
