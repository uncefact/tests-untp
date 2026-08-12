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
  createManyLinkRegistrations,
  getLinkRegistrationByIdrLinkId,
  listLinkRegistrations,
  updateLinkRegistration,
  deleteLinkRegistration,
} from './link-registration.repository';
import { NotFoundError } from '@/lib/api/errors';
import { prismaError } from '../db-errors.fixtures';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

const mockLinkRegistration = prisma.linkRegistration as unknown as {
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

    it('maps a foreign-key violation on identifierId to NotFoundError', async () => {
      // The route pre-checks the identifier and returns 404; an identifier
      // deleted between that check and this write surfaces as the same 404.
      mockLinkRegistration.createMany.mockRejectedValue(
        prismaError('P2003', 'Foreign key constraint failed on the field: `identifierId`'),
      );

      const result = createManyLinkRegistrations([SAMPLE_INPUT]);

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Identifier not found');
    });

    it('rethrows a foreign-key violation on tenantId rather than blaming the identifier', async () => {
      const tenantFkError = prismaError('P2003', 'Foreign key constraint failed on the field: `tenantId`');
      mockLinkRegistration.createMany.mockRejectedValue(tenantFkError);

      await expect(createManyLinkRegistrations([SAMPLE_INPUT])).rejects.toBe(tenantFkError);
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
        take: DEFAULT_PAGE_LIMIT,
        skip: undefined,
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

    it('maps a record-not-found race to NotFoundError', async () => {
      // The findFirst pre-check does not lock the row, so a concurrent delete
      // can land between it and the update; the loser gets the same 404.
      mockTx.linkRegistration.findFirst.mockResolvedValue(SAMPLE_RECORD);
      mockTx.linkRegistration.update.mockRejectedValue(prismaError('P2025'));

      const result = updateLinkRegistration('idr-link-1', 'ident-1', 'tenant-1', {
        targetUrl: 'https://updated.com',
      });

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Link registration not found');
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

    it('maps a record-not-found race to NotFoundError', async () => {
      mockTx.linkRegistration.findFirst.mockResolvedValue(SAMPLE_RECORD);
      mockTx.linkRegistration.delete.mockRejectedValue(prismaError('P2025'));

      const result = deleteLinkRegistration('idr-link-1', 'ident-1', 'tenant-1');

      await expect(result).rejects.toThrow(NotFoundError);
      await expect(result).rejects.toThrow('Link registration not found');
    });
  });
});
