#!/usr/bin/env tsx
/**
 * Inspects one tenant-owned credential batch item.
 *
 * Usage:
 *   pnpm batch:inspect-item -- --tenant TENANT --batch BATCH --index=<n> \
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

let disconnectPrisma: (() => Promise<void>) | undefined;

try {
  const { values } = parseOperatorArgs(process.argv.slice(2), {
    tenant: { type: 'string' },
    batch: { type: 'string' },
    index: { type: 'string' },
    reason: { type: 'string' },
    'disclose-request': { type: 'boolean', default: false },
  });

  function requiredValue(name: string, rejectNul = false): string {
    const value = values[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`--${name} is required`);
    const trimmed = value.trim();
    // This guard turns SQLSTATE 22021 into a named flag for an operator typing against their own database; it is not a security boundary.
    if (rejectNul && trimmed.includes('\0')) throw new Error(`--${name} must not contain a NUL character`);
    return trimmed;
  }

  function parseIndex(): number {
    const value = requiredValue('index');
    if (!/^\d+$/.test(value)) throw new Error('--index must be a non-negative integer');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('--index is outside the safe integer range');
    return parsed;
  }

  const options = {
    tenantId: requiredValue('tenant', true),
    batchId: requiredValue('batch', true),
    index: parseIndex(),
    reason: values.reason === undefined ? 'item inspection' : requiredValue('reason', true),
    discloseRequest: values['disclose-request'] === true,
  };

  const { databaseUrlFromEnvParts, setDatabaseUrlIfAbsent } = await import('../src/lib/prisma/database-url.js');
  const databaseUrl = databaseUrlFromEnvParts();
  setDatabaseUrlIfAbsent(process.env, databaseUrl);
  const { runInspectCredentialBatchItem } = await import('../src/lib/credentials/credential-batch-operator.js');
  const { prisma } = await import('../src/lib/prisma/prisma.js');
  disconnectPrisma = () => prisma.$disconnect();

  process.exitCode = await runInspectCredentialBatchItem(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid command arguments');
  process.exitCode = 1;
} finally {
  await disconnectPrisma?.();
}
