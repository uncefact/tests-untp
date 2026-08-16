import type { Prisma } from '../prisma/generated';

/**
 * Serialises the CVC structural writers for a tenant: scheme persist
 * (delete-and-recreate of profiles), seeded-scheme eviction, and the
 * orphan-criterion sweep. Each acquires this transaction-scoped Postgres
 * advisory lock first, so a sweep can never observe a criterion as
 * unreferenced while another writer is mid-way through recreating its joins.
 * The lock releases automatically when the transaction ends.
 */
export async function acquireCvcStructuralLock(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cvc:' + tenantId}))`;
}
