#!/usr/bin/env tsx
/**
 * Resolves one settled OUTCOME_UNKNOWN credential batch item.
 *
 * Usage:
 *   pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index 0 \
 *     --version 7 --issued CREDENTIAL --reason TICKET [--dry-run]
 *   pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index 0 \
 *     --version 7 --failed --evidence TICKET --reason EXPLANATION [--dry-run]
 *
 * The command prints the durable before and after states. Its repository
 * operation is transactionally fenced and never enqueues issuance.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseOperatorArgs } from './parse-operator-args.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { values } = parseOperatorArgs(process.argv.slice(2), {
  tenant: { type: 'string' },
  batch: { type: 'string' },
  index: { type: 'string' },
  version: { type: 'string' },
  issued: { type: 'string' },
  evidence: { type: 'string' },
  reason: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  failed: { type: 'boolean', default: false },
});

function requiredValue(name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`--${name} is required`);
  return value.trim();
}

function parseInteger(name: string): number {
  const value = requiredValue(name);
  if (!/^\d+$/.test(value)) throw new Error(`--${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} is outside the safe integer range`);
  return parsed;
}

const issued = typeof values.issued === 'string' ? values.issued.trim() : undefined;
const failed = values.failed === true;
if (failed === (issued !== undefined && issued !== '')) throw new Error('choose exactly one of --issued or --failed');
const resolution = failed
  ? { state: 'FAILED' as const, evidence: requiredValue('evidence') }
  : {
      state: 'ISSUED' as const,
      credentialId:
        issued ??
        (() => {
          throw new Error('--issued is required');
        })(),
    };
const options = {
  tenantId: requiredValue('tenant'),
  batchId: requiredValue('batch'),
  index: parseInteger('index'),
  expectedVersion: parseInteger('version'),
  resolution,
  reason: requiredValue('reason'),
  dryRun: values['dry-run'] === true,
};

const { runResolveCredentialBatchItem } = await import('../src/lib/credentials/credential-batch-operator.js');
const { prisma } = await import('../src/lib/prisma/prisma.js');

try {
  process.exitCode = await runResolveCredentialBatchItem(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid command arguments');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
