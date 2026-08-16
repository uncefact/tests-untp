import { PrismaClient } from '../../../src/lib/prisma/generated/index.js';

/**
 * Test-side database helpers. Every client constructed here reads
 * `RI_DATABASE_URL`, which globalSetup has already pointed at the rig's
 * owned database; suites must construct clients through this module (or the
 * application's own singleton) rather than hand-building URLs.
 */

/** A dedicated client, e.g. the second connection in a concurrency test. */
export function createRigClient(): PrismaClient {
  return new PrismaClient();
}

/**
 * Truncates all application tables, preserving `_prisma_migrations` so the
 * schema stays migrated for the whole run. CASCADE keeps the statement
 * order-independent; identity is cuid-based so sequences are not a concern.
 */
export async function truncateApplicationTables(client: PrismaClient): Promise<void> {
  const rows = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
}
