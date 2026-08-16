import { createRigClient, truncateApplicationTables } from './rig/db';

/**
 * Rig self-check: the resolved database is migrated, writable, and the
 * truncate helper clears application tables while preserving migrations.
 */
describe('integration rig', () => {
  const prisma = createRigClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs against a migrated, writable database and truncates between tests', async () => {
    await truncateApplicationTables(prisma);
    await prisma.tenant.create({ data: { id: 'rig-smoke-tenant', name: 'Rig Smoke' } });
    expect(await prisma.tenant.count()).toBe(1);

    await truncateApplicationTables(prisma);
    expect(await prisma.tenant.count()).toBe(0);

    const migrations = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM _prisma_migrations
    `;
    expect(Number(migrations[0].count)).toBeGreaterThan(0);
  });
});
