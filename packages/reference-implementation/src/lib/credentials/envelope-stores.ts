/**
 * Shared iteration over the two stores encrypted at rest under
 * DATA_ENCRYPTION_KEY: credential decryption keys and service instance
 * configurations. Consumed by the backfill (backfill-decryption-keys.ts) and
 * the read-only audit (audit-encryption.ts) so both walk the stores the same
 * way.
 */

export type CredentialKeyRow = { id: string; decryptionKey: string };
export type ServiceInstanceConfigRow = { id: string; config: string };

/**
 * The subset of the Prisma client the envelope-store scans need; structural
 * so tests can supply an in-memory fake. The credential `update` member is
 * used only by the backfill's wrap pass; the audit never calls it.
 */
export type EnvelopeStoresClient = {
  credential: {
    findMany(args: {
      where: { decryptionKey: { not: null }; id?: { gt: string } };
      select: { id: true; decryptionKey: true };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<Array<{ id: string; decryptionKey: string | null }>>;
    update(args: { where: { id: string }; data: { decryptionKey: string } }): Promise<unknown>;
  };
  serviceInstance: {
    findMany(args: {
      where?: { id?: { gt: string } };
      select: { id: true; config: true };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<ServiceInstanceConfigRow[]>;
  };
};

const BATCH_SIZE = 100;

/**
 * Iterates every credential row holding a decryption key, in id order via
 * cursor pagination (`id > cursor`), which does not skip surviving rows when
 * other rows are deleted mid-run.
 */
export async function* eachKeyedCredentialRow(client: EnvelopeStoresClient): AsyncGenerator<CredentialKeyRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.credential.findMany({
      where: { decryptionKey: { not: null }, ...(cursor !== undefined && { id: { gt: cursor } }) },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (row.decryptionKey !== null) {
        yield { id: row.id, decryptionKey: row.decryptionKey };
      }
    }
  }
}

/** Iterates every service instance row, in id order via cursor pagination. */
export async function* eachServiceInstanceRow(client: EnvelopeStoresClient): AsyncGenerator<ServiceInstanceConfigRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.serviceInstance.findMany({
      ...(cursor !== undefined && { where: { id: { gt: cursor } } }),
      select: { id: true, config: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;
    yield* rows;
  }
}
