import {
  createDid,
  getDidById,
  getDidByDid,
  listDids,
  updateDid,
  updateDidStatus,
  deleteDid,
  getDefaultDid,
  findDidByAliasAndService,
} from './did.repository';
import { DidStatus } from '../generated';
import { SYSTEM_TENANT_ID } from '../constants';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  did: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock('../prisma', () => ({
  prisma: {
    did: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockDid = prisma.did as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
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

    it('clears existing tenant defaults when isDefault is true', async () => {
      const createdRecord = { ...DID_RECORD, isDefault: true };
      mockTx.did.updateMany.mockResolvedValue({ count: 1 });
      mockTx.did.create.mockResolvedValue(createdRecord);

      const result = await createDid({
        tenantId: ORG_ID,
        did: 'did:web:example.com:org:123',
        type: 'MANAGED',
        keyId: 'key-1',
        isDefault: true,
      });

      expect(mockTx.did.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: ORG_ID,
          isDefault: true,
          type: { not: 'DEFAULT' },
        },
        data: { isDefault: false },
      });
      expect(mockTx.did.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: ORG_ID,
          isDefault: true,
        }),
      });
      expect(result).toEqual(createdRecord);
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
          OR: [{ tenantId: ORG_ID }, { isDefault: true, type: 'DEFAULT' }],
        },
      });
      expect(result).toEqual(DID_RECORD);
    });

    it('returns null for a DID from another organisation', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await getDidById('did-record-1', 'other-org');
      expect(result).toBeNull();
    });

    it('returns system DEFAULT DID with isDefault false when tenant has own default', async () => {
      const systemDid = { ...DID_RECORD, id: 'sys-did', type: 'DEFAULT', isDefault: true, tenantId: SYSTEM_TENANT_ID };
      const tenantDid = { ...DID_RECORD, id: 'tenant-did', isDefault: true };

      // First call returns the system DID, second call finds tenant default
      mockDid.findFirst.mockResolvedValueOnce(systemDid).mockResolvedValueOnce(tenantDid);

      const result = await getDidById('sys-did', ORG_ID);

      expect(result).toEqual({ ...systemDid, isDefault: false });
    });

    it('returns system DEFAULT DID with isDefault true when tenant has no default', async () => {
      const systemDid = { ...DID_RECORD, id: 'sys-did', type: 'DEFAULT', isDefault: true, tenantId: SYSTEM_TENANT_ID };

      // First call returns the system DID, second call finds no tenant default
      mockDid.findFirst.mockResolvedValueOnce(systemDid).mockResolvedValueOnce(null);

      const result = await getDidById('sys-did', ORG_ID);

      expect(result).toEqual(systemDid);
    });
  });

  describe('getDidByDid', () => {
    it('returns the DID when found by DID string and tenantId', async () => {
      mockDid.findFirst.mockResolvedValue(DID_RECORD);

      const result = await getDidByDid('did:web:example.com:org:123', ORG_ID);

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          did: 'did:web:example.com:org:123',
          OR: [{ tenantId: ORG_ID }, { isDefault: true, type: 'DEFAULT' }],
        },
      });
      expect(result).toEqual(DID_RECORD);
    });

    it('returns the system default DID even for a different tenant', async () => {
      const defaultDid = { ...DID_RECORD, isDefault: true, tenantId: SYSTEM_TENANT_ID };
      mockDid.findFirst.mockResolvedValue(defaultDid);

      const result = await getDidByDid('did:web:example.com:org:123', 'other-org');

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          did: 'did:web:example.com:org:123',
          OR: [{ tenantId: 'other-org' }, { isDefault: true, type: 'DEFAULT' }],
        },
      });
      expect(result).toEqual(defaultDid);
    });

    it('returns null when the DID does not exist', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await getDidByDid('did:web:nonexistent', ORG_ID);
      expect(result).toBeNull();
    });

    it('returns system DEFAULT DID with isDefault false when tenant has own default', async () => {
      const systemDid = { ...DID_RECORD, type: 'DEFAULT', isDefault: true, tenantId: SYSTEM_TENANT_ID };
      const tenantDid = { ...DID_RECORD, id: 'tenant-did', isDefault: true };

      mockDid.findFirst.mockResolvedValueOnce(systemDid).mockResolvedValueOnce(tenantDid);

      const result = await getDidByDid('did:web:example.com:org:123', ORG_ID);

      expect(result).toEqual({ ...systemDid, isDefault: false });
    });
  });

  describe('listDids', () => {
    it('lists DIDs for the organisation including defaults', async () => {
      mockDid.findMany.mockResolvedValue([DID_RECORD]);
      mockDid.count.mockResolvedValue(1);

      const result = await listDids(ORG_ID);

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: ORG_ID }, { isDefault: true, type: 'DEFAULT' }],
        },
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockDid.count).toHaveBeenCalledWith({
        where: {
          OR: [{ tenantId: ORG_ID }, { isDefault: true, type: 'DEFAULT' }],
        },
      });
      expect(result).toEqual({ data: [DID_RECORD], total: 1 });
    });

    it('applies type and status filters', async () => {
      mockDid.findMany.mockResolvedValue([]);
      mockDid.count.mockResolvedValue(0);

      await listDids(ORG_ID, { type: 'MANAGED', status: 'ACTIVE' });

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          type: 'MANAGED',
          status: 'ACTIVE',
        }),
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies serviceInstanceId filter', async () => {
      mockDid.findMany.mockResolvedValue([]);
      mockDid.count.mockResolvedValue(0);

      await listDids(ORG_ID, { serviceInstanceId: 'inst-1' });

      expect(mockDid.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          serviceInstanceId: 'inst-1',
        }),
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('applies pagination', async () => {
      mockDid.findMany.mockResolvedValue([]);
      mockDid.count.mockResolvedValue(0);

      await listDids(ORG_ID, { limit: 10, offset: 20 });

      expect(mockDid.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it('returns system DEFAULT DID with isDefault false when tenant has own default', async () => {
      const systemDid = { ...DID_RECORD, id: 'sys-did', type: 'DEFAULT', isDefault: true, tenantId: SYSTEM_TENANT_ID };
      const tenantDid = { ...DID_RECORD, id: 'tenant-did', type: 'MANAGED', isDefault: true };

      mockDid.findMany.mockResolvedValue([systemDid, tenantDid]);
      mockDid.count.mockResolvedValue(2);

      const result = await listDids(ORG_ID);

      expect(result.data[0]).toEqual(expect.objectContaining({ id: 'sys-did', isDefault: false }));
      expect(result.data[1]).toEqual(expect.objectContaining({ id: 'tenant-did', isDefault: true }));
    });

    it('keeps system DEFAULT DID with isDefault true when tenant has no default', async () => {
      const systemDid = { ...DID_RECORD, id: 'sys-did', type: 'DEFAULT', isDefault: true, tenantId: SYSTEM_TENANT_ID };
      const tenantDid = { ...DID_RECORD, id: 'tenant-did', type: 'MANAGED', isDefault: false };

      mockDid.findMany.mockResolvedValue([systemDid, tenantDid]);
      mockDid.count.mockResolvedValue(2);

      const result = await listDids(ORG_ID);

      expect(result.data[0]).toEqual(expect.objectContaining({ id: 'sys-did', isDefault: true }));
    });
  });

  describe('updateDid', () => {
    it('updates name and description', async () => {
      mockTx.did.findFirst.mockResolvedValue(DID_RECORD);
      mockTx.did.update.mockResolvedValue({ ...DID_RECORD, name: 'New Name', description: 'New desc' });

      const result = await updateDid('did-record-1', ORG_ID, {
        name: 'New Name',
        description: 'New desc',
      });

      expect(mockTx.did.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { name: 'New Name', description: 'New desc' },
      });
      expect(result.name).toBe('New Name');
    });

    it('sets isDefault to true and clears previous default in same tenant', async () => {
      mockTx.did.findFirst.mockResolvedValue(DID_RECORD);
      mockTx.did.updateMany.mockResolvedValue({ count: 1 });
      mockTx.did.update.mockResolvedValue({ ...DID_RECORD, isDefault: true });

      const result = await updateDid('did-record-1', ORG_ID, { isDefault: true });

      expect(mockTx.did.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: ORG_ID,
          isDefault: true,
          id: { not: 'did-record-1' },
          type: { not: 'DEFAULT' },
        },
        data: { isDefault: false },
      });
      expect(mockTx.did.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { isDefault: true },
      });
      expect(result.isDefault).toBe(true);
    });

    it('passes isDefault: false without clearing other defaults', async () => {
      mockTx.did.findFirst.mockResolvedValue(DID_RECORD);
      mockTx.did.update.mockResolvedValue({ ...DID_RECORD, isDefault: false });

      const result = await updateDid('did-record-1', ORG_ID, { isDefault: false });

      expect(mockTx.did.updateMany).not.toHaveBeenCalled();
      expect(mockTx.did.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { isDefault: false },
      });
      expect(result.isDefault).toBe(false);
    });

    it('throws ValidationError when setting isDefault on a DEFAULT type DID', async () => {
      mockTx.did.findFirst.mockResolvedValue({ ...DID_RECORD, type: 'DEFAULT' });

      await expect(updateDid('did-record-1', ORG_ID, { isDefault: true })).rejects.toThrow(
        'Cannot modify default status of system DIDs',
      );
      expect(mockTx.did.updateMany).not.toHaveBeenCalled();
      expect(mockTx.did.update).not.toHaveBeenCalled();
    });

    it('throws if DID does not belong to the organisation', async () => {
      mockTx.did.findFirst.mockResolvedValue(null);

      await expect(updateDid('did-record-1', 'other-org', { name: 'New' })).rejects.toThrow(
        'DID not found or access denied',
      );
    });
  });

  describe('updateDidStatus', () => {
    it('updates the status', async () => {
      mockTx.did.findFirst.mockResolvedValue(DID_RECORD);
      mockTx.did.update.mockResolvedValue({ ...DID_RECORD, status: 'VERIFIED' });

      const result = await updateDidStatus('did-record-1', ORG_ID, 'VERIFIED' as DidStatus);

      expect(mockTx.did.update).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
        data: { status: 'VERIFIED' },
      });
      expect(result.status).toBe('VERIFIED');
    });

    it('throws if DID does not belong to the organisation', async () => {
      mockTx.did.findFirst.mockResolvedValue(null);

      await expect(updateDidStatus('did-record-1', 'other-org', 'VERIFIED' as DidStatus)).rejects.toThrow(
        'DID not found or access denied',
      );
    });
  });

  describe('deleteDid', () => {
    it('deletes the DID when it belongs to the organisation', async () => {
      mockTx.did.findFirst.mockResolvedValue(DID_RECORD);
      mockTx.did.delete.mockResolvedValue(DID_RECORD);

      await deleteDid('did-record-1', ORG_ID);

      expect(mockTx.did.findFirst).toHaveBeenCalledWith({
        where: { id: 'did-record-1', tenantId: ORG_ID },
      });
      expect(mockTx.did.delete).toHaveBeenCalledWith({
        where: { id: 'did-record-1' },
      });
    });

    it('throws NotFoundError when DID does not exist', async () => {
      mockTx.did.findFirst.mockResolvedValue(null);

      await expect(deleteDid('nonexistent', ORG_ID)).rejects.toThrow('DID not found or access denied');
      expect(mockTx.did.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when DID belongs to a different organisation', async () => {
      mockTx.did.findFirst.mockResolvedValue(null);

      await expect(deleteDid('did-record-1', 'other-org')).rejects.toThrow('DID not found or access denied');
      expect(mockTx.did.delete).not.toHaveBeenCalled();
    });
  });

  describe('findDidByAliasAndService', () => {
    it('returns true when a matching DID exists on the service instance', async () => {
      mockDid.findFirst.mockResolvedValue({ id: 'did-record-1' });

      const result = await findDidByAliasAndService('my-alias', 'si-1');

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          serviceInstanceId: 'si-1',
          did: { endsWith: ':my-alias' },
        },
        select: { id: true },
      });
      expect(result).toBe(true);
    });

    it('returns false when no matching DID exists', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await findDidByAliasAndService('nonexistent', 'si-1');

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          serviceInstanceId: 'si-1',
          did: { endsWith: ':nonexistent' },
        },
        select: { id: true },
      });
      expect(result).toBe(false);
    });

    it('returns false when matching alias exists on a different service instance', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await findDidByAliasAndService('my-alias', 'si-2');

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: {
          serviceInstanceId: 'si-2',
          did: { endsWith: ':my-alias' },
        },
        select: { id: true },
      });
      expect(result).toBe(false);
    });
  });

  describe('getDefaultDid', () => {
    it('returns the system default DID when no tenantId is provided', async () => {
      const defaultDid = { ...DID_RECORD, isDefault: true, type: 'DEFAULT' };
      mockDid.findFirst.mockResolvedValue(defaultDid);

      const result = await getDefaultDid();

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true, type: 'DEFAULT' },
      });
      expect(result).toEqual(defaultDid);
    });

    it('returns null when no default DID exists', async () => {
      mockDid.findFirst.mockResolvedValue(null);

      const result = await getDefaultDid();
      expect(result).toBeNull();
    });

    it('returns tenant default DID when tenant has one set', async () => {
      const tenantDid = { ...DID_RECORD, isDefault: true, type: 'MANAGED' };
      mockDid.findFirst.mockResolvedValueOnce(tenantDid);

      const result = await getDefaultDid(ORG_ID);

      expect(mockDid.findFirst).toHaveBeenCalledWith({
        where: { tenantId: ORG_ID, isDefault: true, type: { not: 'DEFAULT' } },
      });
      expect(result).toEqual(tenantDid);
    });

    it('falls back to system default when tenant has no default', async () => {
      const systemDid = { ...DID_RECORD, isDefault: true, type: 'DEFAULT' };
      mockDid.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(systemDid);

      const result = await getDefaultDid(ORG_ID);

      expect(mockDid.findFirst).toHaveBeenCalledTimes(2);
      expect(mockDid.findFirst).toHaveBeenNthCalledWith(1, {
        where: { tenantId: ORG_ID, isDefault: true, type: { not: 'DEFAULT' } },
      });
      expect(mockDid.findFirst).toHaveBeenNthCalledWith(2, {
        where: { isDefault: true, type: 'DEFAULT' },
      });
      expect(result).toEqual(systemDid);
    });
  });
});
