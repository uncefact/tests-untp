/**
 * The worker's readiness query against a real Postgres (ADR-029 integration
 * layer): the unit suite only pattern-matches the SQL string, so a wrong
 * table or column name would pass it. The rig applies every migration before
 * any suite runs, so the applied set here is the checkout's own.
 */
import path from 'node:path';
import { prisma } from '@/lib/prisma/prisma';
import { assertSchemaReady, listImageMigrations, prismaMigrationRows } from '@/worker/schema-readiness';

const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');

describe('worker schema readiness against the rig database', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reads the applied migrations from _prisma_migrations and finds every migration of this checkout applied', async () => {
    const image = listImageMigrations(migrationsDir);
    expect(image.length).toBeGreaterThan(0);
    const applied = await prismaMigrationRows(prisma).appliedMigrationNames();
    expect(applied).toEqual(expect.arrayContaining(image));
    await expect(assertSchemaReady(prismaMigrationRows(prisma), image)).resolves.toBeUndefined();
  });

  it('refuses when a migration this build ships is rolled back, and passes again once it is not', async () => {
    const image = listImageMigrations(migrationsDir);
    const victim = image[0];
    await prisma.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '${victim}'`,
    );
    try {
      await expect(assertSchemaReady(prismaMigrationRows(prisma), image)).rejects.toThrow(
        expect.objectContaining({ code: 'worker.schema-not-ready', message: expect.stringContaining(victim) }),
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE migration_name = '${victim}'`,
      );
    }
    await expect(assertSchemaReady(prismaMigrationRows(prisma), image)).resolves.toBeUndefined();
  });

  it('names the first-ever boot when the migrations table is absent', async () => {
    // A separate schema with no table stands in for an unmigrated database.
    // SET search_path is session-scoped, so the whole case runs inside one
    // interactive transaction, which pins a single pooled connection; SET
    // LOCAL also ends with the transaction, so nothing leaks to another
    // suite's connection.
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS worker_readiness_probe');
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL search_path TO worker_readiness_probe');
        await expect(prismaMigrationRows(tx).appliedMigrationNames()).rejects.toThrow(
          expect.objectContaining({
            code: 'worker.schema-not-ready',
            message: expect.stringContaining('no migrations table'),
          }),
        );
      });
    } finally {
      await prisma.$executeRawUnsafe('DROP SCHEMA worker_readiness_probe');
    }
  });
});
