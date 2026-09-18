#!/usr/bin/env tsx
/**
 * Inspects one tenant-owned credential batch item.
 *
 * Usage:
 *   pnpm batch:inspect-item -- --tenant TENANT --batch BATCH --index 0 \
 *     [--reason TICKET] [--disclose-request]
 *
 * Identifiers and the batch request digest are printed by default. The
 * decrypted original request is printed only with --disclose-request, after
 * the access audit line has been written.
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
  reason: { type: 'string' },
  'disclose-request': { type: 'boolean', default: false },
});

function requiredValue(name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`--${name} is required`);
  return value.trim();
}

function parseIndex(): number {
  const value = requiredValue('index');
  if (!/^\d+$/.test(value)) throw new Error('--index must be a non-negative integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--index is outside the safe integer range');
  return parsed;
}

const options = {
  tenantId: requiredValue('tenant'),
  batchId: requiredValue('batch'),
  index: parseIndex(),
  reason: typeof values.reason === 'string' && values.reason.trim() !== '' ? values.reason.trim() : 'item inspection',
  discloseRequest: values['disclose-request'] === true,
};

const { runInspectCredentialBatchItem } = await import('../src/lib/credentials/credential-batch-operator.js');
const { prisma } = await import('../src/lib/prisma/prisma.js');

try {
  process.exitCode = await runInspectCredentialBatchItem(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid command arguments');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
