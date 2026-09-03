import { Prisma } from '@/lib/prisma/generated';
import { ENVELOPE_STORE_IDS } from './envelope-stores';
import { PRISMA_STORE_COLUMNS, prismaEnvelopeStores, type PrismaEnvelopeStoresClient } from './prisma-envelope-stores';

const TAG = '@encryptedAtRest';

/** An in-memory delegate for one column that applies the filters, cursor and page size the adapter sends. */
function fakeDelegate<Column extends string, R extends { id: string } & Record<Column, string | null>>(
  rows: R[],
  column: Column,
) {
  type Filter = { not?: null; startsWith?: string } | undefined;
  const findMany = jest.fn(async (args: { where?: Record<string, unknown>; take: number }) => {
    const filter = args.where?.[column] as Filter;
    const cursor = args.where?.id as { gt: string } | undefined;
    return rows
      .filter((row) => (filter !== undefined && 'not' in filter ? row[column] !== null : true))
      .filter((row) => (filter?.startsWith !== undefined ? row[column]?.startsWith(filter.startsWith) ?? false : true))
      .filter((row) => (cursor ? row.id > cursor.gt : true))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, args.take)
      .map((row) => ({ id: row.id, [column]: row[column] }) as { id: string } & Pick<R, Column>);
  });
  const updateMany = jest.fn(
    async (args: { where: { id: string } & Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === args.where.id && r[column] === args.where[column]);
      if (!row) return { count: 0 };
      row[column] = args.data[column] as R[Column];
      return { count: 1 };
    },
  );
  const findUnique = jest.fn(async (args: { where: { id: string } }) => {
    const row = rows.find((r) => r.id === args.where.id);
    return row ? ({ id: row.id, [column]: row[column] } as { id: string } & Pick<R, Column>) : null;
  });
  return { findMany, updateMany, findUnique };
}

type KeyRow = { id: string; decryptionKey: string | null };

function client(
  serviceInstances: { id: string; config: string }[] = [],
  credentials: KeyRow[] = [],
  replays: { id: string; responseBody: string | null }[] = [],
  externals: KeyRow[] = [],
) {
  return {
    serviceInstance: fakeDelegate(serviceInstances, 'config'),
    credential: fakeDelegate(credentials, 'decryptionKey'),
    externalCredential: fakeDelegate(externals, 'decryptionKey'),
    idempotencyKey: fakeDelegate(replays, 'responseBody'),
  } satisfies PrismaEnvelopeStoresClient;
}

async function ids(rows: AsyncGenerator<{ id: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const row of rows) out.push(row.id);
  return out;
}

describe('Prisma envelope stores (the adapter)', () => {
  it('backs every schema column tagged @encryptedAtRest, and nothing else', () => {
    // The generated client carries each field's `///` documentation, so the
    // schema's tags and the adapter can be held in step without parsing
    // schema.prisma. An encrypted column added to the schema without an
    // adapter, or an adapter for an untagged column, fails here.
    const tagged = Prisma.dmmf.datamodel.models.flatMap((model) =>
      model.fields.filter((field) => field.documentation?.includes(TAG)).map((field) => `${model.name}.${field.name}`),
    );

    expect(tagged.length).toBeGreaterThan(0);
    expect([...tagged].sort()).toEqual(Object.values(PRISMA_STORE_COLUMNS).sort());
    expect(Object.keys(PRISMA_STORE_COLUMNS).sort()).toEqual([...ENVELOPE_STORE_IDS].sort());
  });

  it('reads service instance configurations without a column filter, one page at a time', async () => {
    const serviceInstances = Array.from({ length: 101 }, (_, i) => ({
      id: `svc-${String(i).padStart(3, '0')}`,
      config: '{}',
    }));
    const c = client(serviceInstances);

    const seen = await ids(prismaEnvelopeStores(c).serviceInstances.candidates());

    expect(seen).toHaveLength(101);
    expect(c.serviceInstance.findMany).toHaveBeenNthCalledWith(1, {
      where: {},
      select: { id: true, config: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    expect(c.serviceInstance.findMany.mock.calls[1][0].where).toEqual({ id: { gt: 'svc-099' } });
  });

  it('walks every keyed credential row but samples only envelope-shaped ones at startup', async () => {
    const c = client(
      [],
      [
        { id: 'a', decryptionKey: 'plaintext' },
        { id: 'b', decryptionKey: '{"envelope":true}' },
        { id: 'c', decryptionKey: null },
      ],
    );
    const stores = prismaEnvelopeStores(c);

    await expect(ids(stores.credentials.rows())).resolves.toEqual(['a', 'b']);
    await expect(ids(stores.credentials.candidates())).resolves.toEqual(['b']);
    expect(c.credential.findMany).toHaveBeenNthCalledWith(1, {
      where: { decryptionKey: { not: null } },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    expect(c.credential.findMany.mock.calls[2][0].where).toEqual({ decryptionKey: { startsWith: '{' } });
  });

  it('walks and samples every keyed external credential row, since that store never holds plaintext', async () => {
    const c = client(
      [],
      [],
      [],
      [
        { id: 'ext-plain', decryptionKey: 'not-an-envelope' },
        { id: 'ext-1', decryptionKey: '{"envelope":true}' },
        { id: 'ext-null', decryptionKey: null },
      ],
    );
    const stores = prismaEnvelopeStores(c);

    await expect(ids(stores.externalCredentials.rows())).resolves.toEqual(['ext-1', 'ext-plain']);
    await expect(ids(stores.externalCredentials.candidates())).resolves.toEqual(['ext-1', 'ext-plain']);
    expect(c.externalCredential.findMany).toHaveBeenNthCalledWith(1, {
      where: { decryptionKey: { not: null } },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    await expect(stores.externalCredentials.casWrite('ext-1', '{"envelope":true}', 'next')).resolves.toBe(true);
    expect(c.externalCredential.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'ext-1', decryptionKey: '{"envelope":true}' },
      data: { decryptionKey: 'next' },
    });
    await expect(stores.externalCredentials.readCurrent('ext-1')).resolves.toEqual({ kind: 'present', value: 'next' });
    await expect(stores.externalCredentials.readCurrent('ext-null')).resolves.toEqual({ kind: 'cleared' });
    await expect(stores.externalCredentials.readCurrent('nope')).resolves.toEqual({ kind: 'missing' });
  });

  it('samples every stored replay body, since that store never holds plaintext', async () => {
    const c = client(
      [],
      [],
      [
        { id: 'claim-1', responseBody: 'not an envelope' },
        { id: 'claim-2', responseBody: '{"envelope":true}' },
        { id: 'claim-3', responseBody: null },
      ],
    );

    await expect(ids(prismaEnvelopeStores(c).idempotencyResponses.candidates())).resolves.toEqual([
      'claim-1',
      'claim-2',
    ]);
  });

  it('compare-and-swaps on the exact stored value and tells a missing row from a cleared one', async () => {
    const credentials: KeyRow[] = [
      { id: 'x', decryptionKey: 'expected' },
      { id: 'cleared', decryptionKey: null },
    ];
    const c = client([], credentials);
    const store = prismaEnvelopeStores(c).credentials;

    await expect(store.casWrite('x', 'stale', 'next')).resolves.toBe(false);
    await expect(store.casWrite('x', 'expected', 'next')).resolves.toBe(true);
    expect(credentials[0].decryptionKey).toBe('next');
    expect(c.credential.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'x', decryptionKey: 'expected' },
      data: { decryptionKey: 'next' },
    });
    await expect(store.readCurrent('gone')).resolves.toEqual({ kind: 'missing' });
    await expect(store.readCurrent('cleared')).resolves.toEqual({ kind: 'cleared' });
    await expect(store.readCurrent('x')).resolves.toEqual({ kind: 'present', value: 'next' });
  });

  it('reads back a service instance configuration and a replay body the same way', async () => {
    const c = client(
      [{ id: 'svc-1', config: 'c' }],
      [],
      [
        { id: 'claim-1', responseBody: 'r' },
        { id: 'claim-cleared', responseBody: null },
      ],
    );
    const stores = prismaEnvelopeStores(c);

    await expect(stores.serviceInstances.readCurrent('svc-1')).resolves.toEqual({ kind: 'present', value: 'c' });
    await expect(stores.serviceInstances.readCurrent('svc-gone')).resolves.toEqual({ kind: 'missing' });
    await expect(stores.idempotencyResponses.readCurrent('claim-1')).resolves.toEqual({ kind: 'present', value: 'r' });
    await expect(stores.idempotencyResponses.readCurrent('claim-cleared')).resolves.toEqual({ kind: 'cleared' });
    await expect(stores.idempotencyResponses.casWrite('claim-1', 'r', 'r2')).resolves.toBe(true);
    await expect(stores.serviceInstances.casWrite('svc-1', 'stale', 'c2')).resolves.toBe(false);
  });

  it('clears a replay body by compare-and-swap, keeping the row, and never clears a configuration or a credential key', async () => {
    const replays = [{ id: 'claim-1', responseBody: 'r' }];
    const c = client([{ id: 'svc-1', config: 'c' }], [], replays);
    const stores = prismaEnvelopeStores(c);

    await expect(stores.idempotencyResponses.discard('claim-1', 'stale')).resolves.toBe(false);
    await expect(stores.idempotencyResponses.discard('claim-1', 'r')).resolves.toBe(true);
    expect(replays[0]).toEqual({ id: 'claim-1', responseBody: null });
    expect(c.idempotencyKey.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'claim-1', responseBody: 'r' },
      data: { responseBody: null },
    });
    await expect(stores.serviceInstances.discard('svc-1', 'c')).rejects.toThrow('never discarded');
    await expect(stores.credentials.discard('cred-1', 'k')).rejects.toThrow('never discarded');
    await expect(stores.externalCredentials.discard('ext-1', 'k')).rejects.toThrow('never discarded');
  });
});
