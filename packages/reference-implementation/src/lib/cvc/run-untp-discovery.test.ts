const mockIngestConformityScheme = jest.fn();

jest.mock('./ingest-conformity-scheme', () => ({
  ingestConformityScheme: (...args: unknown[]) => mockIngestConformityScheme(...args),
}));

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: {
    conformityScheme: {
      deleteMany: jest.fn(),
    },
  },
}));

import { runUntpDiscovery } from './run-untp-discovery';
import { prisma } from '@/lib/prisma/prisma';
import { ConformityFetchStatus, ConformitySchemeSource } from '@/lib/prisma/generated';

const mockScheme = prisma.conformityScheme as unknown as {
  deleteMany: jest.Mock;
};

const REGISTER_URL = 'https://example.com/register.json';
const SCHEMA_URL = 'https://example.com/cvc/ConformityScheme.json';
const TENANT_ID = 'tenant-1';
const fakeLoader = { load: jest.fn() } as never;

function fetchRegisterReturning(body: unknown, ok = true): jest.Mock {
  return jest.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? 'OK' : 'Service Unavailable',
    json: async () => body,
  }));
}

function registerDoc(entries: Array<{ id: string; vocabularyURL: string; name?: string }>) {
  return {
    '@context': ['https://vocabulary.uncefact.org/registers/context/0.1.0/context.jsonld'],
    '@type': ['ConformityVocabularyCatalogueRegister', 'Register'],
    id: 'https://registers.uncefact.org/untp/cvc',
    name: 'Test Register',
    entries: entries.map((e) => ({
      '@type': ['ConformityVocabularyCatalogueEntry', 'ConformityScheme'],
      id: e.id,
      name: e.name ?? `Scheme ${e.id}`,
      vocabularyURL: e.vocabularyURL,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme.deleteMany.mockResolvedValue({ count: 0 });
});

describe('runUntpDiscovery', () => {
  it('iterates the register and aggregates per-entry ingest outcomes', async () => {
    const fetchRegister = fetchRegisterReturning(
      registerDoc([
        { id: 'reg/a', vocabularyURL: 'https://owner/a' },
        { id: 'reg/b', vocabularyURL: 'https://owner/b' },
        { id: 'reg/c', vocabularyURL: 'https://owner/c' },
      ]),
    );
    mockIngestConformityScheme
      .mockResolvedValueOnce({ kind: 'success', schemeId: 'row-a' })
      .mockResolvedValueOnce({ kind: 'unchanged', schemeId: 'row-b' })
      .mockResolvedValueOnce({ kind: 'failure', error: { status: 'FETCH_FAILED' } });

    const result = await runUntpDiscovery({
      tenantId: TENANT_ID,
      registerUrl: REGISTER_URL,
      conformitySchemaUrl: SCHEMA_URL,
      schemaLoader: fakeLoader,
      fetchRegister,
    });

    expect(result.iterated).toBe(3);
    expect(result.succeeded).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockIngestConformityScheme).toHaveBeenCalledTimes(3);
    expect(mockIngestConformityScheme).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://owner/a',
        source: ConformitySchemeSource.UNTP,
        tenantId: TENANT_ID,
        conformitySchemaUrl: SCHEMA_URL,
      }),
    );
  });

  it('evicts UNTP rows whose sourceUrl was not in the register pass', async () => {
    const fetchRegister = fetchRegisterReturning(registerDoc([{ id: 'reg/a', vocabularyURL: 'https://owner/a' }]));
    mockIngestConformityScheme.mockResolvedValue({ kind: 'success', schemeId: 'row-a' });
    mockScheme.deleteMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });

    const result = await runUntpDiscovery({
      tenantId: TENANT_ID,
      registerUrl: REGISTER_URL,
      conformitySchemaUrl: SCHEMA_URL,
      schemaLoader: fakeLoader,
      fetchRegister,
    });

    expect(result.evictedUnseen).toBe(2);
    expect(mockScheme.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenantId: TENANT_ID,
        source: ConformitySchemeSource.UNTP,
        sourceUrl: { notIn: ['https://owner/a'] },
      },
    });
  });

  it('skips the unseen-eviction pass when the register has zero entries', async () => {
    const fetchRegister = fetchRegisterReturning(registerDoc([]));

    const result = await runUntpDiscovery({
      tenantId: TENANT_ID,
      registerUrl: REGISTER_URL,
      conformitySchemaUrl: SCHEMA_URL,
      schemaLoader: fakeLoader,
      fetchRegister,
    });

    expect(result.iterated).toBe(0);
    expect(result.evictedUnseen).toBe(0);
    // Stale-failure eviction still runs; unseen eviction does not.
    expect(mockScheme.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockScheme.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastFetchStatus: { not: ConformityFetchStatus.SUCCESS } }),
      }),
    );
  });

  it('evicts UNTP rows that have been failing past the staleFailureMs threshold', async () => {
    const fetchRegister = fetchRegisterReturning(registerDoc([{ id: 'reg/a', vocabularyURL: 'https://owner/a' }]));
    mockIngestConformityScheme.mockResolvedValue({ kind: 'success', schemeId: 'row-a' });
    mockScheme.deleteMany
      .mockResolvedValueOnce({ count: 0 }) // unseen eviction
      .mockResolvedValueOnce({ count: 3 }); // stale-failure eviction

    const result = await runUntpDiscovery({
      tenantId: TENANT_ID,
      registerUrl: REGISTER_URL,
      conformitySchemaUrl: SCHEMA_URL,
      schemaLoader: fakeLoader,
      fetchRegister,
      staleFailureMs: 1000,
    });

    expect(result.evictedStaleFailures).toBe(3);
    expect(mockScheme.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: TENANT_ID,
        source: ConformitySchemeSource.UNTP,
        lastFetchStatus: { not: ConformityFetchStatus.SUCCESS },
        lastSuccessAt: { lt: expect.any(Date) },
      },
    });
  });

  it('throws and runs no eviction when the register fetch fails', async () => {
    const fetchRegister = fetchRegisterReturning({}, false);

    await expect(
      runUntpDiscovery({
        tenantId: TENANT_ID,
        registerUrl: REGISTER_URL,
        conformitySchemaUrl: SCHEMA_URL,
        schemaLoader: fakeLoader,
        fetchRegister,
      }),
    ).rejects.toThrow(/register fetch failed/i);

    expect(mockIngestConformityScheme).not.toHaveBeenCalled();
    expect(mockScheme.deleteMany).not.toHaveBeenCalled();
  });
});
