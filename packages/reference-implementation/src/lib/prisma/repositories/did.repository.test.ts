import { createDid, getDidById, listDids, updateDid, updateDidStatus, getDefaultDid } from './did.repository';
import type { DidStatus } from '../generated';

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    did: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockDid = prisma.did as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
};

describe('did.repository', () => {
  const ORG_ID = 'org-1';
  const DID_RECORD = {
    id: 'did-record-1',
    tenantId: ORG_ID,
    did: 'did:web:example.com:org:123',
    type: 'MANAGED',
    method: 'DID_WEB',
    name: 'Test DID',
    description: null,
    keyId: 'key-1',
    status: 'UNVERIFIED',
    isDefault: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDid', () => {
    it('creates a DID record with provided fields', async () => {
      mockDid.create.mockResolvedValue(DID_RECORD);

      const result = await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'MANAGED',
        keyId: 'key-1',
        name: 'Test DID',
      });

      expect(mockDid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: ORG_ID,
          did: 'did:web:example.com:org:123',
          type: 'MANAGED',
          method: 'DID_WEB',
          keyId: 'key-1',
          name: 'Test DID',
          isDefault: false,
          status: 'UNVERIFIED',
        }),
      });
      expect(result).toEqual(DID_RECORD);
    });

    it('defaults name to the DID string when not provided', async () => {
      mockDid.create.mockResolvedValue(DID_RECORD);

      await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'MANAGED',
        keyId: 'key-1',
      });

      expect(mockDid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'did:web:example.com:org:123',
        }),
      });
    });

    it('sets status to provided value', async () => {
      mockDid.create.mockResolvedValue({ ...DID_RECORD, status: 'UNVERIFIED' });

      await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'SELF_MANAGED',
        keyId: 'key-1',
        status: 'UNVERIFIED',
      });

      expect(mockDid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'UNVERIFIED',
        }),
      });
    });

    it('passes serviceInstanceId through to prisma when provided', async () => {
      mockDid.create.mockResolvedValue({ ...DID_RECORD, serviceInstanceId: 'si-1' });

      await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'MANAGED',
        keyId: 'key-1',
        serviceInstanceId: 'si-1',
      });

      expect(mockDid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          serviceInstanceId: 'si-1',
        }),
      });
    });

    it('passes undefined serviceInstanceId when not provided', async () => {
      mockDid.create.mockResolvedValue(DID_RECORD);

      await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'MANAGED',
        keyId: 'key-1',
      });

      expect(mockDid.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          serviceInstanceId: undefined,
        }),
      });
    });
  });

  describe('getDidById', () => {
    it('returns the DID if it belongs to the organisation', async () => {
      mockDid.findFirst.mockResolvedValue(DID_RECORD);

      const result = await getDidById('did-record-1', ORG_ID);

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'did-record-1',
          OR: [{ tenantId: ORG_ID }, { isDefault: true }],
        },
      });
      expect(result).toEqual(DID_RECORD);
    });

    it('returns null for a DID from another organisation', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await getDidById('did-record-1', 'other-org');
      expect(result).toBeNull();
    });
  });

  describe('listDids', () => {
    it('lists DIDs for the organisation including defaults', async () => {
      mockDid.findMany.mockResolvedValue([DID_RECORD]);

      const result = await listDids(ORG_ID);

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: ORG_ID }, { isDefault: true }],
        },
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([DID_RECORD]);
    });

    it('applies type and status filters', async () => {
      mockDid.findMany.mockResolvedValue([]);

      await listDids(ORG_ID, { type: 'MANAGED', status: 'ACTIVE' });

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          type: 'MANAGED',
          status: 'ACTIVE',
        }),
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies serviceInstanceId filter', async () => {
      mockDid.findMany.mockResolvedValue([]);

      await listDids(ORG_ID, { serviceInstanceId: 'inst-1' });

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          serviceInstanceId: 'inst-1',
        }),
        take: 100,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies pagination', async () => {
      mockDid.findMany.mockResolvedValue([]);

      await listDids(ORG_ID, { limit: 10, offset: 20 });

      expect(mockDid.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('updateDid', () => {
    it('updates name and description', async () => {
      mockDid.findFirst.mockResolvedValue(DID_RECORD);
      mockDid.update.mockResolvedValue({ ...DID_RECORD, name: 'New Name', description: 'New desc' });

      const result = await updateDid('did-record-1', ORG_ID, {
        name: 'New Name',
        description: 'New desc',
      });

      expect(mockDid.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { name: 'New Name', description: 'New desc' },
      });
      expect(result.name).toBe('New Name');
    });

    it('throws if DID does not belong to the organisation', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      await expect(updateDid('did-record-1', 'other-org', { name: 'New' })).rejects.toThrow(
        'DID not found or access denied',
      );
    });
  });

  describe('updateDidStatus', () => {
    it('updates the status', async () => {
      mockDid.findFirst.mockResolvedValue(DID_RECORD);
      mockDid.update.mockResolvedValue({ ...DID_RECORD, status: 'VERIFIED' });

      const result = await updateDidStatus('did-record-1', ORG_ID, 'VERIFIED' as DidStatus);

      expect(mockDid.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { status: 'VERIFIED' },
      });
      expect(result.status).toBe('VERIFIED');
    });

    it('throws if DID does not belong to the organisation', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      await expect(updateDidStatus('did-record-1', 'other-org', 'VERIFIED' as DidStatus)).rejects.toThrow(
        'DID not found or access denied',
      );
    });
  });

  describe('getDefaultDid', () => {
    it('returns the default DID', async () => {
      const defaultDid = { ...DID_RECORD, isDefault: true, type: 'DEFAULT' };
      mockDid.findFirst.mockResolvedValue(defaultDid);

      const result = await getDefaultDid();

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
      expect(result).toEqual(defaultDid);
    });

    it('returns null when no default DID exists', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await getDefaultDid();
      expect(result).toBeNull();
    });
  });
});
