#!/usr/bin/env tsx
/**
 * Resolves one settled OUTCOME_UNKNOWN credential batch item.
 *
 * Usage:
 *   pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index=<n> \
 *     --version 7 --issued CREDENTIAL --reason TICKET [--dry-run]
 *   pnpm batch:resolve-item -- --tenant TENANT --batch BATCH --index=<n> \
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

let disconnectPrisma: (() => Promise<void>) | undefined;

try {
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

  function requiredValue(name: string, rejectNul = false, missingMessage = `--${name} is required`): string {
    const value = values[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(missingMessage);
    const trimmed = value.trim();
    // This guard turns SQLSTATE 22021 into a named flag for an operator typing against their own database; it is not a security boundary.
    if (rejectNul && trimmed.includes('\0')) throw new Error(`--${name} must not contain a NUL character`);
    return trimmed;
  }

  function parseInteger(name: string): number {
    const value = requiredValue(name);
    if (!/^\d+$/.test(value)) throw new Error(`--${name} must be a non-negative integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} is outside the safe integer range`);
    return parsed;
  }

  const issuedSupplied = typeof values.issued === 'string';
  const evidenceSupplied = typeof values.evidence === 'string';
  const failed = values.failed === true;
  const tenantId = requiredValue('tenant', true);
  const batchId = requiredValue('batch', true);
  const index = parseInteger('index');
  const expectedVersion = parseInteger('version');
  if (issuedSupplied && evidenceSupplied) throw new Error('--evidence applies only with --failed');
  if (failed === issuedSupplied) throw new Error('choose exactly one of --issued or --failed');
  const resolution = failed
    ? { state: 'FAILED' as const, evidence: requiredValue('evidence', true) }
    : {
        state: 'ISSUED' as const,
        credentialId: requiredValue('issued', true),
      };
  const options = {
    tenantId,
    batchId,
    index,
    expectedVersion,
    resolution,
    reason: requiredValue('reason', true),
    dryRun: values['dry-run'] === true,
  };

  const { databaseUrlFromEnvParts, setDatabaseUrlIfAbsent } = await import('../src/lib/prisma/database-url.js');
  const databaseUrl = databaseUrlFromEnvParts();
  setDatabaseUrlIfAbsent(process.env, databaseUrl);
  const { runResolveCredentialBatchItem } = await import('../src/lib/credentials/credential-batch-operator.js');
  const { prisma } = await import('../src/lib/prisma/prisma.js');
  disconnectPrisma = () => prisma.$disconnect();

  process.exitCode = await runResolveCredentialBatchItem(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid command arguments');
  process.exitCode = 1;
} finally {
  await disconnectPrisma?.();
}
