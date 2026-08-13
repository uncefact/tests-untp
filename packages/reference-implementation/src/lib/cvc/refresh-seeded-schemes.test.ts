jest.mock('../prisma/prisma', () => ({
  prisma: {
    conformityScheme: { findMany: jest.fn() },
    dataModel: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./ingest-conformity-scheme', () => ({ ingestConformityScheme: jest.fn() }));
jest.mock('../credentials/schema-loader', () => ({ schemaLoader: { load: jest.fn() } }));
jest.mock('./cvc-structural-lock', () => ({ acquireCvcStructuralLock: jest.fn() }));

import { prisma } from '../prisma/prisma';
import { ingestConformityScheme } from './ingest-conformity-scheme';
import { acquireCvcStructuralLock } from './cvc-structural-lock';
import { refreshSeededSchemes } from './refresh-seeded-schemes';
import { SYSTEM_TENANT_ID } from '../prisma/constants';

const findManyMock = prisma.conformityScheme.findMany as jest.Mock;
const findFirstMock = prisma.dataModel.findFirst as jest.Mock;
const transactionMock = prisma.$transaction as jest.Mock;
const ingestMock = ingestConformityScheme as jest.Mock;

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as never;
}

const sweepTx = {
  conformityCriterion: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
  $executeRaw: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  findFirstMock.mockResolvedValue({ schemaUrl: 'https://example.com/schema.json' });
  ingestMock.mockResolvedValue({ kind: 'unchanged', schemeId: 'row' });
  transactionMock.mockImplementation(async (fn: (tx: typeof sweepTx) => Promise<number>) => fn(sweepTx));
});

describe('refreshSeededSchemes', () => {
  it('re-ingests URL-seeded rows from the database with inputs rebuilt from the row, existing-only', async () => {
    findManyMock.mockResolvedValue([
      { id: 'r1', sourceUrl: 'https://scheme.example.com/mas', specVersion: '0.7.0', seedEntryKind: 'URL' },
    ]);
    ingestMock.mockResolvedValue({ kind: 'success', schemeId: 'r1' });

    const summary = await refreshSeededSchemes(createLogger());

    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://scheme.example.com/mas',
        tenantId: SYSTEM_TENANT_ID,
        source: 'SYSTEM_SEED',
        conformityVocabularySpecVersion: '0.7.0',
        conformitySchemaUrl: 'https://example.com/schema.json',
        // A timer must never create membership; only existing rows refresh.
        requireExistingRow: true,
      }),
    );
    expect(summary.refreshed).toBe(1);
  });

  it('counts a stale outcome as skipped: the row was evicted or replaced mid-refresh', async () => {
    findManyMock.mockResolvedValue([
      { id: 'r1', sourceUrl: 'https://scheme.example.com/mas', specVersion: '0.7.0', seedEntryKind: 'URL' },
    ]);
    ingestMock.mockResolvedValue({ kind: 'stale' });

    const summary = await refreshSeededSchemes(createLogger());

    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.refreshed).toBe(0);
  });

  it('skips FILE-seeded rows and non-fetchable null-marker rows; treats null with http(s) as URL', async () => {
    findManyMock.mockResolvedValue([
      { id: 'f1', sourceUrl: 'urn:example:scheme', specVersion: '0.7.0', seedEntryKind: 'FILE' },
      { id: 'n1', sourceUrl: 'urn:example:legacy', specVersion: '0.7.0', seedEntryKind: null },
      { id: 'n2', sourceUrl: 'https://legacy.example.com/scheme', specVersion: '0.7.0', seedEntryKind: null },
    ]);

    const summary = await refreshSeededSchemes(createLogger());

    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: 'https://legacy.example.com/scheme' }),
    );
    expect(summary.skipped).toBe(2);
    expect(summary.unchanged).toBe(1);
  });

  it('records a failure and continues when a row has no schema binding for its spec version', async () => {
    findManyMock.mockResolvedValue([
      { id: 'r1', sourceUrl: 'https://a.example.com', specVersion: '9.9.9', seedEntryKind: 'URL' },
      { id: 'r2', sourceUrl: 'https://b.example.com', specVersion: '0.7.0', seedEntryKind: 'URL' },
    ]);
    findFirstMock.mockImplementation(async (query: { where: { version: string } }) =>
      query.where.version === '0.7.0' ? { schemaUrl: 'https://example.com/schema.json' } : null,
    );
    const logger = createLogger();

    const summary = await refreshSeededSchemes(logger);

    expect(summary.failed).toBe(1);
    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isExtension: false }) }),
    );
  });

  it('records ingest failures per row without stopping the pass', async () => {
    findManyMock.mockResolvedValue([
      { id: 'r1', sourceUrl: 'https://a.example.com', specVersion: '0.7.0', seedEntryKind: 'URL' },
      { id: 'r2', sourceUrl: 'https://b.example.com', specVersion: '0.7.0', seedEntryKind: 'URL' },
    ]);
    ingestMock
      .mockResolvedValueOnce({ kind: 'failure', error: { status: 'FETCH_FAILED', message: 'down' } })
      .mockResolvedValueOnce({ kind: 'success', schemeId: 'r2' });

    const summary = await refreshSeededSchemes(createLogger());

    expect(summary.failed).toBe(1);
    expect(summary.refreshed).toBe(1);
  });

  it('sweeps orphaned criteria under the structural lock after the pass', async () => {
    const summary = await refreshSeededSchemes(createLogger());

    expect(acquireCvcStructuralLock).toHaveBeenCalledWith(sweepTx, SYSTEM_TENANT_ID);
    expect(sweepTx.conformityCriterion.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: SYSTEM_TENANT_ID, profiles: { none: {} } },
    });
    expect(summary.criteriaSwept).toBe(2);
  });

  it('defers the sweep with a warning only on the anticipated Restrict conflict (P2003)', async () => {
    const { Prisma } = jest.requireActual('../prisma/generated');
    const restrictErr = new Prisma.PrismaClientKnownRequestError('restrict', { code: 'P2003', clientVersion: 'x' });
    transactionMock.mockRejectedValue(restrictErr);
    const logger = createLogger();

    const summary = await refreshSeededSchemes(logger);

    expect(summary.criteriaSwept).toBe(0);
    expect((logger as { warn: jest.Mock }).warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('deferred'),
    );
  });

  it('rethrows any other sweep failure so the pass fails loudly', async () => {
    transactionMock.mockRejectedValue(new Error('database unreachable'));

    await expect(refreshSeededSchemes(createLogger())).rejects.toThrow('database unreachable');
  });

  it('counts a thrown (not returned) ingest error as a failure and continues the pass', async () => {
    findManyMock.mockResolvedValue([
      { id: 'r1', sourceUrl: 'https://a.example.com', specVersion: '0.7.0', seedEntryKind: 'URL' },
      { id: 'r2', sourceUrl: 'https://b.example.com', specVersion: '0.7.0', seedEntryKind: 'URL' },
    ]);
    ingestMock.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({
      kind: 'success',
      schemeId: 'r2',
    });

    const summary = await refreshSeededSchemes(createLogger());

    expect(summary.failed).toBe(1);
    expect(summary.refreshed).toBe(1);
  });
});
