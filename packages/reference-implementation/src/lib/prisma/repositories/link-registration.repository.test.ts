// Transaction mock — functions called via $transaction callback
const mockTx = {
  linkRegistration: {
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../prisma', () => ({
  prisma: {
    linkRegistration: {
      create: jest.fn(),
      createMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

import { prisma } from '../prisma';
import {
  createLinkRegistration,
  createManyLinkRegistrations,
  getLinkRegistrationByIdrLinkId,
  listLinkRegistrations,
  updateLinkRegistration,
  deleteLinkRegistration,
} from './link-registration.repository';
import { NotFoundError } from '@/lib/api/errors';

const mockLinkRegistration = prisma.linkRegistration as unknown as {
  create: jest.Mock;
  createMany: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

const SAMPLE_INPUT = {
  tenantId: 'tenant-1',
  identifierId: 'ident-1',
  idrLinkId: 'idr-link-1',
  linkType: 'untp:dpp',
  targetUrl: 'https://example.com/credential.json',
  mimeType: 'application/json',
  resolverUri: 'https://resolver.example.com/01/09520123456788',
};

const SAMPLE_RECORD = {
  ...SAMPLE_INPUT,
  id: 'lr-1',
  qualifierPath: null,
  publishedAt: new Date('2024-01-01'),
};

describe('link-registration.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLinkRegistration', () => {
    it('creates a link registration', async () => {
      mockLinkRegistration.create.mockResolvedValue(SAMPLE_RECORD);

      const result = await createLinkRegistration(SAMPLE_INPUT);

      expect(mockLinkRegistration.create).toHaveBeenCalledWith({ data: SAMPLE_INPUT });
      expect(result).toEqual(SAMPLE_RECORD);
    });
  });

  describe('createManyLinkRegistrations', () => {
    it('bulk-creates link registrations', async () => {
      mockLinkRegistration.createMany.mockResolvedValue({ count: 2 });

      await createManyLinkRegistrations([SAMPLE_INPUT, { ...SAMPLE_INPUT, idrLinkId: 'idr-link-2' }]);

      expect(mockLinkRegistration.createMany).toHaveBeenCalledWith({
        data: [SAMPLE_INPUT, { ...SAMPLE_INPUT, idrLinkId: 'idr-link-2' }],
      });
    });

    it('skips when input array is empty', async () => {
      await createManyLinkRegistrations([]);

      expect(mockLinkRegistration.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getLinkRegistrationByIdrLinkId', () => {
    it('returns a link registration by IDR link ID', async () => {
      mockLinkRegistration.findFirst.mockResolvedValue(SAMPLE_RECORD);

      const result = await getLinkRegistrationByIdrLinkId('idr-link-1', 'ident-1', 'tenant-1');

      expect(mockLinkRegistration.findFirst).toHaveBeenCalledWith({
        where: { idrLinkId: 'idr-link-1', identifierId: 'ident-1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(SAMPLE_RECORD);
    });

    it('returns null when not found', async () => {
      mockLinkRegistration.findFirst.mockResolvedValue(null);

      const result = await getLinkRegistrationByIdrLinkId('missing', 'ident-1', 'tenant-1');

      expect(result).toBeNull();
    });
  });

  describe('listLinkRegistrations', () => {
    it('lists link registrations for an identifier', async () => {
      mockLinkRegistration.findMany.mockResolvedValue([SAMPLE_RECORD]);
      mockLinkRegistration.count.mockResolvedValue(1);

      const result = await listLinkRegistrations('ident-1', 'tenant-1');

      expect(mockLinkRegistration.findMany).toHaveBeenCalledWith({
        where: { identifierId: 'ident-1', tenantId: 'tenant-1' },
        orderBy: { publishedAt: 'desc' },
      });
      expect(mockLinkRegistration.count).toHaveBeenCalledWith({
        where: { identifierId: 'ident-1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual({ data: [SAMPLE_RECORD], total: 1 });
    });
  });

  describe('updateLinkRegistration', () => {
    it('updates a link registration', async () => {
      const updatedRecord = { ...SAMPLE_RECORD, targetUrl: 'https://updated.com/cred.json' };
      mockTx.linkRegistration.findFirst.mockResolvedValue(SAMPLE_RECORD);
      mockTx.linkRegistration.update.mockResolvedValue(updatedRecord);

      const result = await updateLinkRegistration('idr-link-1', 'ident-1', 'tenant-1', {
        targetUrl: 'https://updated.com/cred.json',
      });

      expect(mockTx.linkRegistration.findFirst).toHaveBeenCalledWith({
        where: { idrLinkId: 'idr-link-1', identifierId: 'ident-1', tenantId: 'tenant-1' },
      });
      expect(mockTx.linkRegistration.update).toHaveBeenCalledWith({
        where: { id: 'lr-1' },
        data: { targetUrl: 'https://updated.com/cred.json' },
      });
      expect(result).toEqual(updatedRecord);
    });

    it('throws NotFoundError when link registration not found', async () => {
      mockTx.linkRegistration.findFirst.mockResolvedValue(null);

      await expect(
        updateLinkRegistration('missing', 'ident-1', 'tenant-1', {
          targetUrl: 'https://updated.com',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteLinkRegistration', () => {
    it('deletes a link registration', async () => {
      mockTx.linkRegistration.findFirst.mockResolvedValue(SAMPLE_RECORD);
      mockTx.linkRegistration.delete.mockResolvedValue(SAMPLE_RECORD);

      const result = await deleteLinkRegistration('idr-link-1', 'ident-1', 'tenant-1');

      expect(mockTx.linkRegistration.findFirst).toHaveBeenCalledWith({
        where: { idrLinkId: 'idr-link-1', identifierId: 'ident-1', tenantId: 'tenant-1' },
      });
      expect(mockTx.linkRegistration.delete).toHaveBeenCalledWith({ where: { id: 'lr-1' } });
      expect(result).toEqual(SAMPLE_RECORD);
    });

    it('throws NotFoundError when link registration not found', async () => {
      mockTx.linkRegistration.findFirst.mockResolvedValue(null);

      await expect(deleteLinkRegistration('missing', 'ident-1', 'tenant-1')).rejects.toThrow(NotFoundError);
    });
  });
});
