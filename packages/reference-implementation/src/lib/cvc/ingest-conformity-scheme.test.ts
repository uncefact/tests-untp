const mockResolveAndParseConformityScheme = jest.fn();

jest.mock('@uncefact/untp-ri-services/cvc', () => ({
  resolveAndParseConformityScheme: (...args: unknown[]) => mockResolveAndParseConformityScheme(...args),
}));

const mockMultibaseDigestFromString = jest.fn();
jest.mock('@uncefact/untp-utils/multibase-digest', () => ({
  MultibaseDigest: {
    fromString: (...args: unknown[]) => mockMultibaseDigestFromString(...args),
  },
}));

const mockTx = {
  conformityProfile: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  conformityScheme: {
    create: jest.fn(),
    update: jest.fn(),
  },
  conformityCriterion: {
    upsert: jest.fn(),
  },
  conformityProfileCriterion: {
    create: jest.fn(),
  },
};

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: {
    conformityScheme: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

import { ingestConformityScheme } from './ingest-conformity-scheme';
import { prisma } from '@/lib/prisma/prisma';
import { CvcFetchStatus, CvcSchemeSource } from '@/lib/prisma/generated';

const mockScheme = prisma.conformityScheme as unknown as {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
};

const SOURCE_URL = 'https://example.com/scheme';
const TENANT_ID = 'tenant-1';
const SCHEMA_URL = 'https://example.com/cvc/ConformityScheme.json';
const fakeLoader = { load: jest.fn() } as never;

function baseInput(overrides: Partial<Parameters<typeof ingestConformityScheme>[0]> = {}) {
  return {
    sourceUrl: SOURCE_URL,
    source: CvcSchemeSource.UNTP,
    tenantId: TENANT_ID,
    conformitySchemaUrl: SCHEMA_URL,
    schemaLoader: fakeLoader,
    ...overrides,
  };
}

function parsedScheme(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: 'https://example.com/scheme',
    sourceUrl: SOURCE_URL,
    specVersion: '0.7.0',
    name: 'Example Scheme',
    profiles: [],
    ...overrides,
  };
}

function parsedProfile(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: 'https://example.com/profile/1.0.0',
    name: 'Example Profile',
    version: '1.0.0',
    status: 'active',
    criteria: [],
    ...overrides,
  };
}

function parsedCriterion(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: 'https://example.com/criterion/a/1.0.0',
    name: 'Criterion A',
    version: '1.0.0',
    status: 'active',
    topics: [],
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ingestConformityScheme', () => {
  describe('unchanged', () => {
    it('bumps lastFetchedAt only when the resolver reports unchanged', async () => {
      mockScheme.findUnique.mockResolvedValue({
        id: 'row-1',
        etag: '"prev"',
        lastModifiedHeader: 'Tue, 20 May 2026 11:00:00 GMT',
        bodyDigest: 'zPREV',
      });
      mockMultibaseDigestFromString.mockReturnValue({ encoded: 'zPREV' });
      mockResolveAndParseConformityScheme.mockResolvedValue({ kind: 'unchanged' });
      mockScheme.update.mockResolvedValue({ id: 'row-1' });

      const result = await ingestConformityScheme(baseInput());

      expect(result).toEqual({ kind: 'unchanged', schemeId: 'row-1' });
      expect(mockScheme.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { lastFetchedAt: expect.any(Date) },
      });
    });

    it('forwards the row cache validators to resolveAndParseConformityScheme', async () => {
      mockScheme.findUnique.mockResolvedValue({
        id: 'row-1',
        etag: '"prev"',
        lastModifiedHeader: 'Tue, 20 May 2026 11:00:00 GMT',
        bodyDigest: 'zPREV',
      });
      const cachedDigest = { encoded: 'zPREV' };
      mockMultibaseDigestFromString.mockReturnValue(cachedDigest);
      mockResolveAndParseConformityScheme.mockResolvedValue({ kind: 'unchanged' });

      await ingestConformityScheme(baseInput());

      expect(mockResolveAndParseConformityScheme).toHaveBeenCalledWith(
        expect.objectContaining({
          cached: {
            etag: '"prev"',
            lastModifiedHeader: 'Tue, 20 May 2026 11:00:00 GMT',
            bodyDigest: cachedDigest,
          },
        }),
      );
    });

    it('throws if the resolver reports unchanged but no row exists', async () => {
      mockScheme.findUnique.mockResolvedValue(null);
      mockResolveAndParseConformityScheme.mockResolvedValue({ kind: 'unchanged' });

      await expect(ingestConformityScheme(baseInput())).rejects.toThrow(/unchanged with no existing row/);
    });
  });

  describe('failure', () => {
    it('updates lastFetchStatus on the existing row, retains content', async () => {
      mockScheme.findUnique.mockResolvedValue({
        id: 'row-1',
        etag: null,
        lastModifiedHeader: null,
        bodyDigest: null,
      });
      mockResolveAndParseConformityScheme.mockResolvedValue({
        kind: 'failure',
        error: { status: 'FETCH_FAILED', sourceUrl: SOURCE_URL, code: 'x', name: 'X', message: 'm' },
      });

      const result = await ingestConformityScheme(baseInput());

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.schemeId).toBe('row-1');
      expect(mockScheme.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { lastFetchedAt: expect.any(Date), lastFetchStatus: 'FETCH_FAILED' },
      });
      expect(mockScheme.create).not.toHaveBeenCalled();
    });

    it('does not persist anything when no row exists yet (first-time failure)', async () => {
      mockScheme.findUnique.mockResolvedValue(null);
      mockResolveAndParseConformityScheme.mockResolvedValue({
        kind: 'failure',
        error: { status: 'INVALID_JSON', sourceUrl: SOURCE_URL, code: 'x', name: 'X', message: 'm' },
      });

      const result = await ingestConformityScheme(baseInput());

      expect(result).toEqual({
        kind: 'failure',
        error: expect.objectContaining({ status: 'INVALID_JSON' }),
      });
      expect(mockScheme.create).not.toHaveBeenCalled();
      expect(mockScheme.update).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('creates the scheme + profile + criterion + join when no row exists', async () => {
      mockScheme.findUnique.mockResolvedValue(null);
      mockResolveAndParseConformityScheme.mockResolvedValue({
        kind: 'success',
        scheme: parsedScheme({
          profiles: [parsedProfile({ criteria: [parsedCriterion()] })],
        }),
        raw: { '@context': [], id: 'x' },
        bodyDigest: { toString: () => 'zNEW' },
        etag: '"new"',
        lastModifiedHeader: 'Wed, 21 May 2026 12:00:00 GMT',
      });
      mockTx.conformityScheme.create.mockResolvedValue({ id: 'row-new' });
      mockTx.conformityCriterion.upsert.mockResolvedValue({ id: 'crit-1' });
      mockTx.conformityProfile.create.mockResolvedValue({ id: 'prof-1' });
      mockTx.conformityProfileCriterion.create.mockResolvedValue({ id: 'join-1' });

      const result = await ingestConformityScheme(baseInput());

      expect(result).toEqual({ kind: 'success', schemeId: 'row-new' });
      expect(mockTx.conformityProfile.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.conformityScheme.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canonicalId: 'https://example.com/scheme',
          name: 'Example Scheme',
          etag: '"new"',
          lastModifiedHeader: 'Wed, 21 May 2026 12:00:00 GMT',
          bodyDigest: 'zNEW',
          lastFetchStatus: CvcFetchStatus.SUCCESS,
          source: CvcSchemeSource.UNTP,
        }),
        select: { id: true },
      });
      expect(mockTx.conformityProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ schemeId: 'row-new' }) }),
      );
      expect(mockTx.conformityProfileCriterion.create).toHaveBeenCalledWith({
        data: { profileId: 'prof-1', criterionId: 'crit-1' },
      });
    });

    it('deletes existing profiles and propagates cache validators on the update path', async () => {
      mockScheme.findUnique.mockResolvedValue({
        id: 'row-existing',
        etag: '"prev"',
        lastModifiedHeader: null,
        bodyDigest: null,
      });
      mockResolveAndParseConformityScheme.mockResolvedValue({
        kind: 'success',
        scheme: parsedScheme({ profiles: [] }),
        raw: { id: 'x' },
        bodyDigest: { toString: () => 'zNEW' },
        etag: '"new"',
        lastModifiedHeader: 'Wed, 21 May 2026 12:00:00 GMT',
      });
      mockTx.conformityScheme.update.mockResolvedValue({ id: 'row-existing' });

      const result = await ingestConformityScheme(baseInput());

      expect(result).toEqual({ kind: 'success', schemeId: 'row-existing' });
      expect(mockTx.conformityProfile.deleteMany).toHaveBeenCalledWith({ where: { schemeId: 'row-existing' } });
      expect(mockTx.conformityScheme.update).toHaveBeenCalledWith({
        where: { id: 'row-existing' },
        data: expect.objectContaining({
          etag: '"new"',
          lastModifiedHeader: 'Wed, 21 May 2026 12:00:00 GMT',
          bodyDigest: 'zNEW',
          lastFetchStatus: CvcFetchStatus.SUCCESS,
          lastFetchedAt: expect.any(Date),
        }),
        select: { id: true },
      });
      expect(mockTx.conformityScheme.create).not.toHaveBeenCalled();
    });

    it('clears the cached digest when the existing row has no prior digest', async () => {
      mockScheme.findUnique.mockResolvedValue({
        id: 'row-1',
        etag: null,
        lastModifiedHeader: null,
        bodyDigest: null,
      });
      mockResolveAndParseConformityScheme.mockResolvedValue({ kind: 'unchanged' });
      mockScheme.update.mockResolvedValue({ id: 'row-1' });

      await ingestConformityScheme(baseInput());

      expect(mockMultibaseDigestFromString).not.toHaveBeenCalled();
      expect(mockResolveAndParseConformityScheme).toHaveBeenCalledWith(
        expect.objectContaining({
          cached: { etag: undefined, lastModifiedHeader: undefined, bodyDigest: undefined },
        }),
      );
    });

    it('upserts shared criteria once and joins them to each profile that references them', async () => {
      mockScheme.findUnique.mockResolvedValue(null);
      const sharedCriterion = parsedCriterion({ canonicalId: 'https://example.com/criterion/shared/1.0.0' });
      mockResolveAndParseConformityScheme.mockResolvedValue({
        kind: 'success',
        scheme: parsedScheme({
          profiles: [
            parsedProfile({ canonicalId: 'p/1.0.0', criteria: [sharedCriterion] }),
            parsedProfile({ canonicalId: 'p/2.0.0', criteria: [sharedCriterion] }),
          ],
        }),
        raw: { id: 'x' },
        bodyDigest: { toString: () => 'zNEW' },
      });
      mockTx.conformityScheme.create.mockResolvedValue({ id: 'row-new' });
      mockTx.conformityCriterion.upsert.mockResolvedValue({ id: 'crit-shared' });
      mockTx.conformityProfile.create.mockResolvedValueOnce({ id: 'prof-1' }).mockResolvedValueOnce({ id: 'prof-2' });

      await ingestConformityScheme(baseInput());

      expect(mockTx.conformityCriterion.upsert).toHaveBeenCalledTimes(1);
      expect(mockTx.conformityProfileCriterion.create).toHaveBeenNthCalledWith(1, {
        data: { profileId: 'prof-1', criterionId: 'crit-shared' },
      });
      expect(mockTx.conformityProfileCriterion.create).toHaveBeenNthCalledWith(2, {
        data: { profileId: 'prof-2', criterionId: 'crit-shared' },
      });
    });
  });
});
