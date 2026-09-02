/**
 * The Prisma adapter for the envelope stores (envelope-stores.ts): every
 * store's operations over its delegate, with the column named literally, so
 * each store doubles as the worked example for the next.
 *
 * PRISMA_STORE_COLUMNS names the schema column behind each store. The build
 * (scripts/check-encrypted-columns.ts, run by `pnpm build`) and
 * prisma-envelope-stores.test.ts both hold it equal to the set of columns
 * tagged `@encryptedAtRest` in schema.prisma, so an encrypted column added to
 * the schema without an adapter here fails the build (ADR-055). Both read
 * the tags from the generated client, so they see a schema change only after
 * `prisma generate`, which the build script runs first. Prisma does not
 * cover `Prisma.dmmf` by its versioning promise, so the installed client is
 * pinned exactly and the check fails loudly, not silently, if the field
 * documentation ever stops arriving.
 */
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import {
  eachPage,
  type CurrentValue,
  type EnvelopeStore,
  type EnvelopeStoreId,
  type EnvelopeStores,
  type StoredValue,
} from './envelope-stores';

/**
 * The schema column each store reads, as `Model.field`. The label is checked
 * against the schema's tags; nothing checks it against the query below, so
 * it must name the column the store's adapter actually selects.
 */
export const PRISMA_STORE_COLUMNS: Record<EnvelopeStoreId, string> = {
  serviceInstances: 'ServiceInstance.config',
  credentials: 'Credential.decryptionKey',
  idempotencyResponses: 'IdempotencyKey.responseBody',
};

type Cursor = { id?: { gt: string } };
type Page = { orderBy: { id: 'asc' }; take: number };
type KeyFilter = { not: null } | { startsWith: string };

/**
 * The subset of the Prisma client the adapter needs, one delegate per store:
 * a cursor-paginated `findMany`, a compare-and-swap `updateMany` that
 * matches the exact stored value alongside the id, and a `findUnique` to
 * re-read one row. Structural so tests can supply an in-memory fake, and
 * narrow enough that the real delegate satisfies it.
 */
export type PrismaEnvelopeStoresClient = {
  serviceInstance: {
    findMany(
      args: { where: Cursor; select: { id: true; config: true } } & Page,
    ): Promise<Array<{ id: string; config: string }>>;
    updateMany(args: { where: { id: string; config: string }; data: { config: string } }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { id: true; config: true };
    }): Promise<{ id: string; config: string } | null>;
  };
  credential: {
    findMany(
      args: { where: { decryptionKey: KeyFilter } & Cursor; select: { id: true; decryptionKey: true } } & Page,
    ): Promise<Array<{ id: string; decryptionKey: string | null }>>;
    updateMany(args: {
      where: { id: string; decryptionKey: string };
      data: { decryptionKey: string };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { id: true; decryptionKey: true };
    }): Promise<{ id: string; decryptionKey: string | null } | null>;
  };
  idempotencyKey: {
    findMany(
      args: { where: { responseBody: KeyFilter } & Cursor; select: { id: true; responseBody: true } } & Page,
    ): Promise<Array<{ id: string; responseBody: string | null }>>;
    updateMany(args: {
      where: { id: string; responseBody: string };
      data: { responseBody: string | null };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { id: true; responseBody: true };
    }): Promise<{ id: string; responseBody: string | null } | null>;
  };
};

const BATCH_SIZE = 100;
const page: Page = { orderBy: { id: 'asc' }, take: BATCH_SIZE };

/** The cursor clause for the page after `cursor`; nothing on the first page. */
function after(cursor: string | undefined): Cursor {
  return cursor !== undefined ? { id: { gt: cursor } } : {};
}

/** A nullable column read back: undefined means the row is gone, null that its value was cleared. */
function current(value: string | null | undefined): CurrentValue {
  if (value === undefined) return { kind: 'missing' };
  return value === null ? { kind: 'cleared' } : { kind: 'present', value };
}

function serviceInstances(client: PrismaEnvelopeStoresClient): EnvelopeStore {
  // The column cannot be null, so every row is a candidate and no filter applies.
  const rows = (): AsyncGenerator<StoredValue> =>
    eachPage(async (cursor) =>
      (
        await client.serviceInstance.findMany({
          where: after(cursor),
          select: { id: true, config: true },
          ...page,
        })
      ).map((row) => ({ id: row.id, value: row.config })),
    );
  return {
    rows,
    candidates: rows,
    async casWrite(id, expected, next) {
      const { count } = await client.serviceInstance.updateMany({
        where: { id, config: expected },
        data: { config: next },
      });
      return count === 1;
    },
    async discard() {
      // The column cannot be null and the store is not discardable; nothing asks.
      throw new Error('A service instance configuration is never discarded');
    },
    async readCurrent(id) {
      const row = await client.serviceInstance.findUnique({ where: { id }, select: { id: true, config: true } });
      return current(row?.config);
    },
  };
}

function credentials(client: PrismaEnvelopeStoresClient): EnvelopeStore {
  const rows = (filter: KeyFilter): AsyncGenerator<StoredValue> =>
    eachPage(async (cursor) =>
      (
        await client.credential.findMany({
          where: { decryptionKey: filter, ...after(cursor) },
          select: { id: true, decryptionKey: true },
          ...page,
        })
      ).map((row) => ({ id: row.id, value: row.decryptionKey })),
    );
  return {
    rows: () => rows({ not: null }),
    // Legacy plaintext keys (ENVELOPE_STORE_INFO.credentials.plaintextAllowed)
    // are not worth sampling at startup; only envelope-shaped values are.
    candidates: () => rows({ startsWith: '{' }),
    async casWrite(id, expected, next) {
      const { count } = await client.credential.updateMany({
        where: { id, decryptionKey: expected },
        data: { decryptionKey: next },
      });
      return count === 1;
    },
    async discard() {
      // Losing a native key loses the credential; the store is not discardable and nothing asks.
      throw new Error('A credential decryption key is never discarded');
    },
    async readCurrent(id) {
      const row = await client.credential.findUnique({ where: { id }, select: { id: true, decryptionKey: true } });
      return current(row?.decryptionKey);
    },
  };
}

function idempotencyResponses(client: PrismaEnvelopeStoresClient): EnvelopeStore {
  const rows = (): AsyncGenerator<StoredValue> =>
    eachPage(async (cursor) =>
      (
        await client.idempotencyKey.findMany({
          where: { responseBody: { not: null }, ...after(cursor) },
          select: { id: true, responseBody: true },
          ...page,
        })
      ).map((row) => ({ id: row.id, value: row.responseBody })),
    );
  return {
    rows,
    candidates: rows,
    async casWrite(id, expected, next) {
      const { count } = await client.idempotencyKey.updateMany({
        where: { id, responseBody: expected },
        data: { responseBody: next },
      });
      return count === 1;
    },
    async discard(id, expected) {
      const { count } = await client.idempotencyKey.updateMany({
        where: { id, responseBody: expected },
        data: { responseBody: null },
      });
      return count === 1;
    },
    async readCurrent(id) {
      const row = await client.idempotencyKey.findUnique({ where: { id }, select: { id: true, responseBody: true } });
      return current(row?.responseBody);
    },
  };
}

/** Every store, bound to the given client. A store listed in the port without an adapter here fails to compile. */
export function prismaEnvelopeStores(client: PrismaEnvelopeStoresClient): EnvelopeStores {
  return {
    serviceInstances: serviceInstances(client),
    credentials: credentials(client),
    idempotencyResponses: idempotencyResponses(client),
  };
}
