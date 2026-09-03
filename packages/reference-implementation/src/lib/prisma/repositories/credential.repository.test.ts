import {
  createCredential,
  listCredentials,
  updateCredentialPublished,
  getCredentialById,
} from './credential.repository';
import { IdempotencyClaimLostError } from './idempotency-key.repository';
import { NotFoundError } from '@/lib/api/errors';
import { prismaError } from '../db-errors.fixtures';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import { CoreCredentialType, CredentialDetailsError, LibraryRecordOrigin, IdempotencyOperation } from '../generated';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
jest.mock('../prisma', () => {
  const prismaMock: {
    libraryRecord: { create: jest.Mock; update: jest.Mock };
    credential: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    idempotencyKey: { updateMany: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  } = {
    libraryRecord: { create: jest.fn(), update: jest.fn() },
    credential: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    idempotencyKey: {
      updateMany: jest.fn(),
      findUnique: jest.fn(async () => null),
    },
    $transaction: jest.fn(),
  };
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockLibraryRecord = prisma.libraryRecord as unknown as { create: jest.Mock; update: jest.Mock };
const mockCredential = prisma.credential as unknown as {
  create: jest.Mock;
  findMany: jest.Mock;
  findFirst: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
};
const mockIdempotencyKey = prisma.idempotencyKey as unknown as { updateMany: jest.Mock; findUnique: jest.Mock };
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

describe('credential.repository', () => {
  const TENANT_ID = 'tenant-1';

  /** A parent row as Prisma returns it. */
  function record(i: number, overrides: Record<string, unknown> = {}) {
    return {
      id: `credential-${i}`,
      tenantId: TENANT_ID,
      origin: LibraryRecordOrigin.NATIVE,
      name: null,
      issuerName: null,
      issuerDid: null,
      subjectName: null,
      subjectId: null,
      validFrom: null,
      validUntil: null,
      credentialType: 'DigitalConformityCredential',
      coreCredentialType: CoreCredentialType.DCC,
      coreDataModelVersion: '0.6.1',
      detailsStatus: 'EXTRACTION_PENDING',
      detailsError: null,
      createdAt: new Date('2023-12-31'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    };
  }

  /** A child row with its parent included, as the read paths fetch it. */
  function childWithRecord(i: number, overrides: Record<string, unknown> = {}) {
    return {
      id: `credential-${i}`,
      tenantId: TENANT_ID,
      storageUri: `https://storage.example/credential-${i}`,
      digestMultibase: `z${i}`,
      decryptionKey: null,
      isPublished: false,
      organisationId: null,
      facilityId: null,
      productId: null,
      origin: 'NATIVE',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
      record: record(i),
    };
  }

  /** What callers see: the child with the parent's shared fields flattened on. */
  /** The child as a reader sees it: the origin column is the database's, never the response's. */
  function visibleChild(child: Record<string, unknown>) {
    const { origin: _origin, ...visible } = child;
    return visible;
  }

  function flattened(i: number, overrides: Record<string, unknown> = {}) {
    const { record: parent, ...child } = childWithRecord(i, overrides);
    return {
      ...visibleChild(child),
      credentialType: parent.credentialType,
      coreCredentialType: parent.coreCredentialType,
      coreDataModelVersion: parent.coreDataModelVersion,
      name: parent.name,
      issuerName: parent.issuerName,
      issuerDid: parent.issuerDid,
      subjectName: parent.subjectName,
      subjectId: parent.subjectId,
      validFrom: parent.validFrom,
      validUntil: parent.validUntil,
      detailsStatus: parent.detailsStatus,
      detailsError: parent.detailsError,
      createdAt: parent.createdAt,
      updatedAt: parent.updatedAt,
    };
  }

  // More than DEFAULT_PAGE_LIMIT so an unbounded query is distinguishable
  // from a correctly-paged one.
  const SEED_ROWS = Array.from({ length: DEFAULT_PAGE_LIMIT + 5 }, (_, i) => childWithRecord(i));

  const NEW_INPUT = {
    tenantId: TENANT_ID,
    storageUri: 'https://storage.example/credential-new',
    digestMultibase: 'zNew',
    credentialType: 'DigitalProductPassport',
    coreCredentialType: CoreCredentialType.DPP,
    coreDataModelVersion: '0.6.1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors Prisma's own take/skip semantics (an undefined take is
    // unbounded), so this catches the repository omitting the default
    // limit rather than merely asserting on the call arguments.
    mockCredential.findMany.mockImplementation(({ take, skip }: { take?: number; skip?: number } = {}) => {
      const start = skip ?? 0;
      const end = take !== undefined ? start + take : undefined;
      return Promise.resolve(SEED_ROWS.slice(start, end));
    });
    mockCredential.count.mockResolvedValue(SEED_ROWS.length);
    mockLibraryRecord.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...record(99),
      id: 'cred-new',
      ...data,
    }));
    mockCredential.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...childWithRecord(99),
      record: undefined,
      ...data,
    }));
  });

  describe('listCredentials', () => {
    it('bounds the result to DEFAULT_PAGE_LIMIT when limit is omitted and flattens the parent onto each row', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID });
      expect(result.data).toHaveLength(DEFAULT_PAGE_LIMIT);
      expect(result.data[0]).toEqual(flattened(0));
      expect(result.data[0]).not.toHaveProperty('record');
      expect(mockCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: DEFAULT_PAGE_LIMIT, include: { record: true } }),
      );
      // Ordered by the timestamp the response carries (the parent's), id as tie-break.
      expect(mockCredential.findMany.mock.calls[0][0].orderBy).toEqual([
        { record: { createdAt: 'desc' } },
        { id: 'desc' },
      ]);
    });

    it('still pages as requested when a limit is supplied', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID, limit: 5, offset: 10 });
      expect(result.data).toHaveLength(5);
      expect(result.data[0].id).toBe('credential-10');
      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
    });

    it('filters by type through the parent record, where the type now lives', async () => {
      await listCredentials({ tenantId: TENANT_ID, credentialType: 'DigitalProductPassport', isPublished: true });
      const where = { tenantId: TENANT_ID, record: { credentialType: 'DigitalProductPassport' }, isPublished: true };
      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(mockCredential.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('getCredentialById', () => {
    it('reads the child with its parent, scoped to the tenant, and flattens it', async () => {
      mockCredential.findFirst.mockResolvedValue(childWithRecord(3));
      await expect(getCredentialById('credential-3', TENANT_ID)).resolves.toEqual(flattened(3));
      expect(mockCredential.findFirst).toHaveBeenCalledWith({
        where: { id: 'credential-3', tenantId: TENANT_ID },
        include: { record: true },
      });
    });

    it('returns null when the tenant does not own the id', async () => {
      mockCredential.findFirst.mockResolvedValue(null);
      await expect(getCredentialById('credential-3', 'other')).resolves.toBeNull();
    });
  });

  describe('createCredential', () => {
    it('writes the parent record and the child with one id, in one transaction, and returns the flattened row', async () => {
      const result = await createCredential({
        ...NEW_INPUT,
        details: {
          name: 'Wool Passport',
          issuerName: 'Example Issuer',
          issuerDid: 'did:web:issuer.example',
          subjectName: 'Merino batch',
          subjectId: 'https://example.com/product/1',
          validFrom: new Date('2024-01-15T00:00:00.000Z'),
          validUntil: new Date('2025-01-15T00:00:00.000Z'),
        },
        detailsStatus: 'EXTRACTED',
      });

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockLibraryRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          origin: LibraryRecordOrigin.NATIVE,
          credentialType: 'DigitalProductPassport',
          coreCredentialType: CoreCredentialType.DPP,
          coreDataModelVersion: '0.6.1',
          name: 'Wool Passport',
          issuerDid: 'did:web:issuer.example',
          validUntil: new Date('2025-01-15T00:00:00.000Z'),
          detailsStatus: 'EXTRACTED',
        }),
      });
      const parentData = mockLibraryRecord.create.mock.calls[0][0].data;
      const childData = mockCredential.create.mock.calls[0][0].data;
      // One instant for every timestamp on both rows.
      expect(parentData.createdAt).toBeInstanceOf(Date);
      expect(parentData.updatedAt).toBe(parentData.createdAt);
      expect(childData.createdAt).toBe(parentData.createdAt);
      expect(childData.updatedAt).toBe(parentData.createdAt);
      expect(childData).toEqual({
        id: 'cred-new',
        tenantId: TENANT_ID,
        createdAt: parentData.createdAt,
        updatedAt: parentData.createdAt,
        storageUri: 'https://storage.example/credential-new',
        digestMultibase: 'zNew',
        decryptionKey: undefined,
        isPublished: false,
        organisationId: undefined,
        facilityId: undefined,
        productId: undefined,
      });
      expect(result.entityLinkFailed).toBe(false);
      expect(result.credential).toEqual(
        expect.objectContaining({ id: 'cred-new', name: 'Wool Passport', coreCredentialType: CoreCredentialType.DPP }),
      );
      expect(result.credential).not.toHaveProperty('record');
    });

    it('writes the failure reason on the parent when the details could not be read', async () => {
      await createCredential({
        ...NEW_INPUT,
        detailsStatus: 'EXTRACTION_FAILED',
        detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
      });
      expect(mockLibraryRecord.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          detailsStatus: 'EXTRACTION_FAILED',
          detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
        }),
      );
    });

    it('stores a null core kind when the caller has none', async () => {
      await createCredential({ ...NEW_INPUT, coreCredentialType: undefined });
      expect(mockLibraryRecord.create.mock.calls[0][0].data.coreCredentialType).toBeNull();
    });

    it.each(['organisationId', 'facilityId', 'productId'])(
      'retries the whole transaction without entity links when %s vanished, so a stored credential is never lost',
      async (column) => {
        // ADR-044: the credential is already signed and stored externally by
        // this point, so an entity that disappeared mid-request must not fail
        // the write. The retry drops only the links and says so.
        mockCredential.create.mockRejectedValueOnce(
          prismaError('P2003', `Foreign key constraint failed on the field: \`${column}\``),
        );

        const result = await createCredential({
          ...NEW_INPUT,
          organisationId: 'org-1',
          facilityId: 'fac-1',
          productId: 'prod-1',
        });

        expect(result.entityLinkFailed).toBe(true);
        expect(mockTransaction).toHaveBeenCalledTimes(2);
        expect(mockLibraryRecord.create).toHaveBeenCalledTimes(2);
        expect(mockCredential.create).toHaveBeenCalledTimes(2);
        const retryData = mockCredential.create.mock.calls[1][0].data;
        expect(retryData).not.toHaveProperty('organisationId');
        expect(retryData).not.toHaveProperty('facilityId');
        expect(retryData).not.toHaveProperty('productId');
        // The captured fields ride the parent on the retry too.
        expect(mockLibraryRecord.create.mock.calls[1][0].data).toEqual(
          expect.objectContaining({ credentialType: 'DigitalProductPassport', coreDataModelVersion: '0.6.1' }),
        );
      },
    );

    it('rethrows a foreign-key violation on a column that is not an entity link', async () => {
      // Only the optional enrichment columns are retried; a tenant that
      // vanished is a real failure and stays fatal under ADR-036.
      const fkError = prismaError('P2003', 'Foreign key constraint failed on the field: `tenantId`');
      mockLibraryRecord.create.mockRejectedValue(fkError);

      await expect(createCredential({ ...NEW_INPUT, organisationId: 'org-1' })).rejects.toBe(fkError);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('maps a unique-constraint conflict to the API conflict error without retrying', async () => {
      const other = prismaError('P2002', 'Unique constraint failed');
      mockCredential.create.mockRejectedValue(other);

      await expect(createCredential(NEW_INPUT)).rejects.toMatchObject({
        name: 'ConflictError',
        message: 'A credential record with this identity already exists',
      });
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('associates the idempotency claim with the parent record in the same transaction', async () => {
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await createCredential({ ...NEW_INPUT, idempotencyClaimId: 'claim-1' });

      expect(result.credential.id).toBe('cred-new');
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockIdempotencyKey.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-1', recordId: null, operation: IdempotencyOperation.CREDENTIAL_ISSUE },
        data: { recordId: 'cred-new', resultRecordedAt: expect.any(Date) },
      });
    });

    it('throws IdempotencyClaimLostError inside the transaction when the association matches zero rows', async () => {
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(createCredential({ ...NEW_INPUT, idempotencyClaimId: 'claim-1' })).rejects.toBeInstanceOf(
        IdempotencyClaimLostError,
      );
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('keeps the idempotency association on the entity-link retry', async () => {
      mockCredential.create.mockRejectedValueOnce(
        prismaError('P2003', 'Foreign key constraint failed on the field: `organisationId`'),
      );
      mockIdempotencyKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await createCredential({ ...NEW_INPUT, organisationId: 'org-1', idempotencyClaimId: 'claim-1' });

      expect(result.entityLinkFailed).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(2);
      expect(mockIdempotencyKey.updateMany).toHaveBeenCalledTimes(1);
      expect(mockIdempotencyKey.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-1', recordId: null, operation: IdempotencyOperation.CREDENTIAL_ISSUE },
        data: { recordId: 'cred-new', resultRecordedAt: expect.any(Date) },
      });
    });
  });

  describe('updateCredentialPublished', () => {
    it('updates the published flag scoped to the tenant, touches the parent in the same transaction, and returns the flattened row', async () => {
      const touched = new Date('2024-06-01');
      mockCredential.update.mockResolvedValue(childWithRecord(0, { isPublished: true }));
      mockLibraryRecord.update.mockResolvedValue(record(0, { updatedAt: touched }));

      const result = await updateCredentialPublished('credential-0', TENANT_ID, true);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockCredential.update).toHaveBeenCalledWith({
        where: { id: 'credential-0', tenantId: TENANT_ID },
        data: { isPublished: true },
        include: { record: true },
      });
      expect(mockLibraryRecord.update).toHaveBeenCalledWith({
        where: { id_tenantId: { id: 'credential-0', tenantId: TENANT_ID } },
        data: { updatedAt: expect.any(Date) },
      });
      // The row callers see carries the record's last-modified time, which is the parent's.
      expect(result).toEqual({ ...flattened(0, { isPublished: true }), updatedAt: touched });
    });

    it('maps a record-not-found race to NotFoundError', async () => {
      mockCredential.update.mockRejectedValue(prismaError('P2025'));

      const result = updateCredentialPublished('credential-0', TENANT_ID, true);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Credential not found');
    });

    it('rethrows a non-database error unchanged', async () => {
      const connectionError = new Error('connection lost');
      mockCredential.update.mockRejectedValue(connectionError);

      await expect(updateCredentialPublished('credential-0', TENANT_ID, true)).rejects.toBe(connectionError);
    });
  });
});
