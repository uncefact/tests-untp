import {
  importCatalogue,
  deleteCatalogue,
  listCatalogues,
  getCatalogueById,
  listSchemes,
  getSchemeById,
  listProfiles,
  getProfileById,
  listCriteria,
  getCriterionById,
  findCriteriaByCanonicalIds,
  findProfileWithCriteriaByCanonicalId,
} from './cvc.repository';
import { NotFoundError } from '@/lib/api/errors';

// Transaction mock — functions called via $transaction callback
const mockTx = {
  cvcCatalogue: {
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  },
  criterion: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  profileCriterion: {
    createMany: jest.fn(),
  },
};

jest.mock('../prisma', () => ({
  prisma: {
    cvcCatalogue: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    conformityScheme: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    conformityProfile: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    criterion: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    profileCriterion: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

import { prisma } from '../prisma';

const mockCatalogue = prisma.cvcCatalogue as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  delete: jest.Mock;
};

const mockScheme = prisma.conformityScheme as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

const mockProfile = prisma.conformityProfile as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

const mockCriterion = prisma.criterion as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  deleteMany: jest.Mock;
};

const TENANT_ID = 'tenant-1';
const SYSTEM_TENANT = 'system';
const NOW = new Date('2025-01-01');

const CATALOGUE_RECORD = {
  id: 'cat-1',
  canonicalId: 'https://example.com/catalogue/1',
  name: 'Test Catalogue',
  sourceUrl: 'https://example.com/catalogue.json',
  specVersion: '0.7.0',
  metadata: null,
  importedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  tenantId: TENANT_ID,
};

const SCHEME_RECORD = {
  id: 'scheme-1',
  canonicalId: 'https://example.com/scheme/1',
  name: 'Test Scheme',
  slug: 'test-scheme',
  description: 'A test scheme',
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
  tenantId: TENANT_ID,
  catalogueId: 'cat-1',
};

const PROFILE_RECORD = {
  id: 'profile-1',
  canonicalId: 'https://example.com/profile/1',
  name: 'Test Profile',
  slug: 'test-profile',
  version: '1.0',
  status: 'active',
  description: 'A test profile',
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
  tenantId: TENANT_ID,
  schemeId: 'scheme-1',
};

const CRITERION_RECORD = {
  id: 'crit-1',
  canonicalId: 'https://example.com/criterion/1',
  name: 'Test Criterion',
  version: '1.0',
  status: 'active',
  description: 'A test criterion',
  conformityTopic: 'environment',
  tags: ['env'],
  passThreshold: null,
  documentation: null,
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
  tenantId: TENANT_ID,
};

describe('cvc.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // importCatalogue
  // -------------------------------------------------------------------------

  describe('importCatalogue', () => {
    const importInput = {
      tenantId: TENANT_ID,
      canonicalId: 'https://example.com/catalogue/1',
      name: 'Test Catalogue',
      sourceUrl: 'https://example.com/catalogue.json',
      specVersion: '0.7.0',
      schemes: [
        {
          canonicalId: 'https://example.com/scheme/1',
          name: 'Scheme One',
          slug: 'scheme-one',
          profiles: [
            {
              canonicalId: 'https://example.com/profile/1',
              name: 'Profile One',
              slug: 'profile-one',
              version: '1.0',
              status: 'active',
              criteria: [
                {
                  canonicalId: 'https://example.com/criterion/1',
                  name: 'Criterion One',
                  version: '1.0',
                  status: 'active',
                },
                {
                  canonicalId: 'https://example.com/criterion/2',
                  name: 'Criterion Two',
                  version: '1.0',
                  status: 'active',
                },
              ],
            },
          ],
        },
      ],
    };

    it('creates a catalogue with nested schemes, profiles, and criteria', async () => {
      mockTx.cvcCatalogue.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.criterion.deleteMany.mockResolvedValue({ count: 0 });

      mockTx.criterion.upsert
        .mockResolvedValueOnce({ id: 'crit-1', canonicalId: 'https://example.com/criterion/1' })
        .mockResolvedValueOnce({ id: 'crit-2', canonicalId: 'https://example.com/criterion/2' });

      const createdCatalogue = {
        ...CATALOGUE_RECORD,
        schemes: [
          {
            ...SCHEME_RECORD,
            canonicalId: 'https://example.com/scheme/1',
            profiles: [
              {
                ...PROFILE_RECORD,
                canonicalId: 'https://example.com/profile/1',
              },
            ],
          },
        ],
      };
      mockTx.cvcCatalogue.create.mockResolvedValue(createdCatalogue);
      mockTx.profileCriterion.createMany.mockResolvedValue({ count: 2 });

      const result = await importCatalogue(importInput);

      expect(mockTx.cvcCatalogue.deleteMany).toHaveBeenCalledWith({
        where: { canonicalId: importInput.canonicalId, tenantId: TENANT_ID },
      });

      expect(mockTx.criterion.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, profiles: { none: {} } },
      });

      expect(mockTx.criterion.upsert).toHaveBeenCalledTimes(2);
      expect(mockTx.criterion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            canonicalId_tenantId: {
              canonicalId: 'https://example.com/criterion/1',
              tenantId: TENANT_ID,
            },
          },
        }),
      );

      expect(mockTx.cvcCatalogue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            canonicalId: importInput.canonicalId,
            tenantId: TENANT_ID,
            name: importInput.name,
            sourceUrl: importInput.sourceUrl,
          }),
        }),
      );

      expect(mockTx.profileCriterion.createMany).toHaveBeenCalledWith({
        data: [
          { profileId: 'profile-1', criterionId: 'crit-1' },
          { profileId: 'profile-1', criterionId: 'crit-2' },
        ],
        skipDuplicates: true,
      });

      expect(result.summary).toEqual({ schemes: 1, profiles: 1, criteria: 2 });
    });

    it('deletes existing catalogue before re-importing', async () => {
      mockTx.cvcCatalogue.deleteMany.mockResolvedValue({ count: 1 });
      mockTx.criterion.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.criterion.upsert
        .mockResolvedValueOnce({ id: 'crit-1', canonicalId: 'https://example.com/criterion/1' })
        .mockResolvedValueOnce({ id: 'crit-2', canonicalId: 'https://example.com/criterion/2' });

      const createdCatalogue = {
        ...CATALOGUE_RECORD,
        schemes: [
          {
            ...SCHEME_RECORD,
            canonicalId: 'https://example.com/scheme/1',
            profiles: [
              {
                ...PROFILE_RECORD,
                canonicalId: 'https://example.com/profile/1',
              },
            ],
          },
        ],
      };
      mockTx.cvcCatalogue.create.mockResolvedValue(createdCatalogue);
      mockTx.profileCriterion.createMany.mockResolvedValue({ count: 2 });

      await importCatalogue(importInput);

      expect(mockTx.cvcCatalogue.deleteMany).toHaveBeenCalledWith({
        where: { canonicalId: importInput.canonicalId, tenantId: TENANT_ID },
      });
    });

    it('deduplicates criteria by canonicalId across profiles', async () => {
      const inputWithDupes = {
        ...importInput,
        schemes: [
          {
            canonicalId: 'https://example.com/scheme/1',
            name: 'Scheme One',
            slug: 'scheme-one',
            profiles: [
              {
                canonicalId: 'https://example.com/profile/1',
                name: 'Profile One',
                slug: 'profile-one',
                version: '1.0',
                status: 'active',
                criteria: [
                  {
                    canonicalId: 'https://example.com/criterion/shared',
                    name: 'Shared',
                    version: '1.0',
                    status: 'active',
                  },
                ],
              },
              {
                canonicalId: 'https://example.com/profile/2',
                name: 'Profile Two',
                slug: 'profile-two',
                version: '1.0',
                status: 'active',
                criteria: [
                  {
                    canonicalId: 'https://example.com/criterion/shared',
                    name: 'Shared',
                    version: '1.0',
                    status: 'active',
                  },
                ],
              },
            ],
          },
        ],
      };

      mockTx.cvcCatalogue.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.criterion.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.criterion.upsert.mockResolvedValue({
        id: 'crit-shared',
        canonicalId: 'https://example.com/criterion/shared',
      });

      const createdCatalogue = {
        ...CATALOGUE_RECORD,
        schemes: [
          {
            ...SCHEME_RECORD,
            canonicalId: 'https://example.com/scheme/1',
            profiles: [
              { ...PROFILE_RECORD, id: 'profile-1', canonicalId: 'https://example.com/profile/1' },
              { ...PROFILE_RECORD, id: 'profile-2', canonicalId: 'https://example.com/profile/2' },
            ],
          },
        ],
      };
      mockTx.cvcCatalogue.create.mockResolvedValue(createdCatalogue);
      mockTx.profileCriterion.createMany.mockResolvedValue({ count: 1 });

      const result = await importCatalogue(inputWithDupes);

      // Only one upsert despite the criterion appearing in two profiles
      expect(mockTx.criterion.upsert).toHaveBeenCalledTimes(1);
      expect(result.summary.criteria).toBe(1);
    });

    it('uses a 30-second transaction timeout', async () => {
      mockTx.cvcCatalogue.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.criterion.deleteMany.mockResolvedValue({ count: 0 });
      mockTx.cvcCatalogue.create.mockResolvedValue({ ...CATALOGUE_RECORD, schemes: [] });

      await importCatalogue({ ...importInput, schemes: [] });

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
    });
  });

  // -------------------------------------------------------------------------
  // deleteCatalogue
  // -------------------------------------------------------------------------

  describe('deleteCatalogue', () => {
    it('deletes the catalogue and cleans orphan criteria in a transaction', async () => {
      mockTx.cvcCatalogue.findFirst.mockResolvedValue(CATALOGUE_RECORD);
      mockTx.cvcCatalogue.delete.mockResolvedValue(CATALOGUE_RECORD);
      mockTx.criterion.deleteMany.mockResolvedValue({ count: 0 });

      await deleteCatalogue('cat-1', TENANT_ID);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(mockTx.cvcCatalogue.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-1', tenantId: TENANT_ID },
      });
      expect(mockTx.cvcCatalogue.delete).toHaveBeenCalledWith({ where: { id: 'cat-1', tenantId: TENANT_ID } });
      expect(mockTx.criterion.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, profiles: { none: {} } },
      });
    });

    it('throws NotFoundError when catalogue does not exist', async () => {
      mockTx.cvcCatalogue.findFirst.mockResolvedValue(null);

      await expect(deleteCatalogue('cat-missing', TENANT_ID)).rejects.toThrow(NotFoundError);
      await expect(deleteCatalogue('cat-missing', TENANT_ID)).rejects.toThrow('Catalogue not found or access denied');
    });
  });

  // -------------------------------------------------------------------------
  // listCatalogues
  // -------------------------------------------------------------------------

  describe('listCatalogues', () => {
    it('lists catalogues with system tenant visibility', async () => {
      mockCatalogue.count.mockResolvedValue(1);
      mockCatalogue.findMany.mockResolvedValue([CATALOGUE_RECORD]);

      const result = await listCatalogues(TENANT_ID);

      const expectedWhere = {
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
      };
      expect(mockCatalogue.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockCatalogue.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: { _count: { select: { schemes: true } } },
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: [CATALOGUE_RECORD], total: 1 });
    });

    it('applies pagination options', async () => {
      mockCatalogue.count.mockResolvedValue(0);
      mockCatalogue.findMany.mockResolvedValue([]);

      await listCatalogues(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockCatalogue.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 20 }));
    });
  });

  // -------------------------------------------------------------------------
  // getCatalogueById
  // -------------------------------------------------------------------------

  describe('getCatalogueById', () => {
    it('returns catalogue with system tenant visibility', async () => {
      mockCatalogue.findFirst.mockResolvedValue(CATALOGUE_RECORD);

      const result = await getCatalogueById('cat-1', TENANT_ID);

      expect(mockCatalogue.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'cat-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
        include: { _count: { select: { schemes: true } } },
      });
      expect(result).toEqual(CATALOGUE_RECORD);
    });

    it('returns null when catalogue does not exist', async () => {
      mockCatalogue.findFirst.mockResolvedValue(null);

      const result = await getCatalogueById('cat-missing', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listSchemes
  // -------------------------------------------------------------------------

  describe('listSchemes', () => {
    it('lists schemes with system tenant visibility', async () => {
      mockScheme.count.mockResolvedValue(1);
      mockScheme.findMany.mockResolvedValue([SCHEME_RECORD]);

      const result = await listSchemes(TENANT_ID);

      const expectedWhere = {
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
      };
      expect(mockScheme.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockScheme.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: { _count: { select: { profiles: true } } },
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: [SCHEME_RECORD], total: 1 });
    });

    it('filters by catalogueId when provided', async () => {
      mockScheme.count.mockResolvedValue(1);
      mockScheme.findMany.mockResolvedValue([SCHEME_RECORD]);

      await listSchemes(TENANT_ID, { catalogueId: 'cat-1' });

      expect(mockScheme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ catalogueId: 'cat-1' }),
        }),
      );
    });

    it('applies pagination options', async () => {
      mockScheme.count.mockResolvedValue(0);
      mockScheme.findMany.mockResolvedValue([]);

      await listSchemes(TENANT_ID, { limit: 5, offset: 10 });

      expect(mockScheme.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
    });
  });

  // -------------------------------------------------------------------------
  // getSchemeById
  // -------------------------------------------------------------------------

  describe('getSchemeById', () => {
    it('returns scheme with profiles included', async () => {
      const schemeWithProfiles = { ...SCHEME_RECORD, profiles: [PROFILE_RECORD] };
      mockScheme.findFirst.mockResolvedValue(schemeWithProfiles);

      const result = await getSchemeById('scheme-1', TENANT_ID);

      expect(mockScheme.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'scheme-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
        include: { profiles: true },
      });
      expect(result).toEqual(schemeWithProfiles);
    });

    it('returns null when scheme does not exist', async () => {
      mockScheme.findFirst.mockResolvedValue(null);

      const result = await getSchemeById('scheme-missing', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listProfiles
  // -------------------------------------------------------------------------

  describe('listProfiles', () => {
    it('lists profiles with system tenant visibility', async () => {
      mockProfile.count.mockResolvedValue(1);
      mockProfile.findMany.mockResolvedValue([PROFILE_RECORD]);

      const result = await listProfiles(TENANT_ID);

      const expectedWhere = {
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
      };
      expect(mockProfile.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockProfile.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: { _count: { select: { criteria: true } } },
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: [PROFILE_RECORD], total: 1 });
    });

    it('filters by schemeId when provided', async () => {
      mockProfile.count.mockResolvedValue(1);
      mockProfile.findMany.mockResolvedValue([PROFILE_RECORD]);

      await listProfiles(TENANT_ID, { schemeId: 'scheme-1' });

      expect(mockProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ schemeId: 'scheme-1' }),
        }),
      );
    });

    it('applies pagination options', async () => {
      mockProfile.count.mockResolvedValue(0);
      mockProfile.findMany.mockResolvedValue([]);

      await listProfiles(TENANT_ID, { limit: 25, offset: 50 });

      expect(mockProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25, skip: 50 }));
    });
  });

  // -------------------------------------------------------------------------
  // getProfileById
  // -------------------------------------------------------------------------

  describe('getProfileById', () => {
    it('returns profile with criteria ordered by criterion name', async () => {
      const profileWithCriteria = {
        ...PROFILE_RECORD,
        criteria: [{ id: 'pc-1', profileId: 'profile-1', criterionId: 'crit-1', criterion: CRITERION_RECORD }],
      };
      mockProfile.findFirst.mockResolvedValue(profileWithCriteria);

      const result = await getProfileById('profile-1', TENANT_ID);

      expect(mockProfile.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'profile-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
        include: {
          criteria: {
            orderBy: { criterion: { name: 'asc' } },
            include: { criterion: true },
          },
        },
      });
      expect(result).toEqual(profileWithCriteria);
    });

    it('returns null when profile does not exist', async () => {
      mockProfile.findFirst.mockResolvedValue(null);

      const result = await getProfileById('profile-missing', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listCriteria
  // -------------------------------------------------------------------------

  describe('listCriteria', () => {
    it('lists criteria with system tenant visibility', async () => {
      mockCriterion.count.mockResolvedValue(1);
      mockCriterion.findMany.mockResolvedValue([CRITERION_RECORD]);

      const result = await listCriteria(TENANT_ID);

      const expectedWhere = {
        OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
      };
      expect(mockCriterion.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockCriterion.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        take: 20,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ data: [CRITERION_RECORD], total: 1 });
    });

    it('filters by profileId through join table', async () => {
      mockCriterion.count.mockResolvedValue(1);
      mockCriterion.findMany.mockResolvedValue([CRITERION_RECORD]);

      await listCriteria(TENANT_ID, { profileId: 'profile-1' });

      expect(mockCriterion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            profiles: { some: { profileId: 'profile-1' } },
          }),
        }),
      );
    });

    it('applies pagination options', async () => {
      mockCriterion.count.mockResolvedValue(0);
      mockCriterion.findMany.mockResolvedValue([]);

      await listCriteria(TENANT_ID, { limit: 10, offset: 5 });

      expect(mockCriterion.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 5 }));
    });
  });

  // -------------------------------------------------------------------------
  // getCriterionById
  // -------------------------------------------------------------------------

  describe('getCriterionById', () => {
    it('returns criterion with profile memberships', async () => {
      const criterionWithProfiles = {
        ...CRITERION_RECORD,
        profiles: [{ id: 'pc-1', profileId: 'profile-1', criterionId: 'crit-1', profile: PROFILE_RECORD }],
      };
      mockCriterion.findFirst.mockResolvedValue(criterionWithProfiles);

      const result = await getCriterionById('crit-1', TENANT_ID);

      expect(mockCriterion.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'crit-1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
        include: {
          profiles: { include: { profile: true } },
        },
      });
      expect(result).toEqual(criterionWithProfiles);
    });

    it('returns null when criterion does not exist', async () => {
      mockCriterion.findFirst.mockResolvedValue(null);

      const result = await getCriterionById('crit-missing', TENANT_ID);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findCriteriaByCanonicalIds
  // -------------------------------------------------------------------------

  describe('findCriteriaByCanonicalIds', () => {
    it('returns criteria matching the provided canonical IDs', async () => {
      const criteria = [
        CRITERION_RECORD,
        { ...CRITERION_RECORD, id: 'crit-2', canonicalId: 'https://example.com/criterion/2' },
      ];
      mockCriterion.findMany.mockResolvedValue(criteria);

      const canonicalIds = ['https://example.com/criterion/1', 'https://example.com/criterion/2'];
      const result = await findCriteriaByCanonicalIds(TENANT_ID, canonicalIds);

      expect(mockCriterion.findMany).toHaveBeenCalledWith({
        where: {
          canonicalId: { in: canonicalIds },
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
      });
      expect(result).toEqual(criteria);
    });

    it('returns empty array when no matching criteria found', async () => {
      mockCriterion.findMany.mockResolvedValue([]);

      const result = await findCriteriaByCanonicalIds(TENANT_ID, ['https://example.com/criterion/nonexistent']);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // findProfileWithCriteriaByCanonicalId
  // -------------------------------------------------------------------------

  describe('findProfileWithCriteriaByCanonicalId', () => {
    it('returns profile with nested criteria when found', async () => {
      const profileWithCriteria = {
        ...PROFILE_RECORD,
        criteria: [
          {
            id: 'pc-1',
            profileId: 'profile-1',
            criterionId: 'crit-1',
            criterion: CRITERION_RECORD,
          },
        ],
      };
      mockProfile.findFirst.mockResolvedValue(profileWithCriteria);

      const result = await findProfileWithCriteriaByCanonicalId(TENANT_ID, 'https://example.com/profile/1');

      expect(mockProfile.findFirst).toHaveBeenCalledWith({
        where: {
          canonicalId: 'https://example.com/profile/1',
          OR: [{ tenantId: TENANT_ID }, { tenantId: SYSTEM_TENANT }],
        },
        include: {
          criteria: {
            include: { criterion: true },
          },
        },
      });
      expect(result).toEqual(profileWithCriteria);
    });

    it('returns null when no matching profile exists', async () => {
      mockProfile.findFirst.mockResolvedValue(null);

      const result = await findProfileWithCriteriaByCanonicalId(TENANT_ID, 'https://example.com/profile/nonexistent');

      expect(result).toBeNull();
    });
  });
});
