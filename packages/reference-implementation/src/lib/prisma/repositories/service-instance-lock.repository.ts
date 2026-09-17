import { Prisma } from '../generated';

/**
 * Locks one service instance for the duration of its transaction. The caller
 * must pass Prisma's transaction client: a FOR UPDATE query on the singleton
 * client would release the lock when its autocommit statement ends.
 */
export async function lockServiceInstanceForUpdate(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ServiceInstance"
    WHERE "id" = ${id} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  return locked.length > 0;
}
