import { getOrganisationByIdentifierValue, getProductByIdentifierValue, getFacilityByIdentifierValue } from '.';

// Mock Prisma client
jest.mock('../prisma', () => ({
  prisma: {
    organisationEntity: {
      findFirst: jest.fn(),
    },
    facility: {
      findFirst: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '../prisma';

const mockOrgFindFirst = prisma.organisationEntity.findFirst as unknown as jest.Mock;
const mockFacilityFindFirst = prisma.facility.findFirst as unknown as jest.Mock;
const mockProductFindFirst = prisma.product.findFirst as unknown as jest.Mock;

const TENANT_ID = 'tenant-1';

describe('entity lookup by identifier value', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getOrganisationByIdentifierValue ──────────────────────────────────

  describe('getOrganisationByIdentifierValue', () => {
    it('calls findFirst with the correct where clause and includes', async () => {
      const orgRecord = {
        id: 'org-1',
        tenantId: TENANT_ID,
        name: 'Acme Corp',
        primaryIdentifier: {
          id: 'ident-1',
          value: '9506000100',
          scheme: { id: 'scheme-1', registrar: { id: 'reg-1' } },
        },
        secondaryIdentifiers: [],
      };
      mockOrgFindFirst.mockResolvedValue(orgRecord);

      const result = await getOrganisationByIdentifierValue('9506000100', TENANT_ID);

      expect(result).toEqual(orgRecord);
      expect(mockOrgFindFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          primaryIdentifier: { value: '9506000100' },
        },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: {
            include: { identifier: { include: { scheme: { include: { registrar: true } } } } },
          },
        },
      });
    });

    it('returns null when no organisation matches', async () => {
      mockOrgFindFirst.mockResolvedValue(null);

      const result = await getOrganisationByIdentifierValue('nonexistent', TENANT_ID);

      expect(result).toBeNull();
    });
  });

  // ── getFacilityByIdentifierValue ──────────────────────────────────────

  describe('getFacilityByIdentifierValue', () => {
    it('calls findFirst with the correct where clause and includes', async () => {
      const facilityRecord = {
        id: 'facility-1',
        tenantId: TENANT_ID,
        name: 'Factory Alpha',
        primaryIdentifier: {
          id: 'ident-2',
          value: '9506000134',
          scheme: { id: 'scheme-1', registrar: { id: 'reg-1' } },
        },
        secondaryIdentifiers: [],
        operatingOrganisation: null,
      };
      mockFacilityFindFirst.mockResolvedValue(facilityRecord);

      const result = await getFacilityByIdentifierValue('9506000134', TENANT_ID);

      expect(result).toEqual(facilityRecord);
      expect(mockFacilityFindFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          primaryIdentifier: { value: '9506000134' },
        },
        include: {
          primaryIdentifier: { include: { scheme: { include: { registrar: true } } } },
          secondaryIdentifiers: {
            include: { identifier: { include: { scheme: { include: { registrar: true } } } } },
          },
          operatingOrganisation: true,
        },
      });
    });

    it('returns null when no facility matches', async () => {
      mockFacilityFindFirst.mockResolvedValue(null);

      const result = await getFacilityByIdentifierValue('nonexistent', TENANT_ID);

      expect(result).toBeNull();
    });
  });

  // ── getProductByIdentifierValue ───────────────────────────────────────

  describe('getProductByIdentifierValue', () => {
    it('calls findFirst with the correct where clause and includes', async () => {
      const identifierInclude = { include: { scheme: { include: { registrar: true } } } };
      const productRecord = {
        id: 'product-1',
        tenantId: TENANT_ID,
        name: 'Widget X',
        primaryIdentifier: {
          id: 'ident-3',
          value: '09506000134352',
          scheme: { id: 'scheme-1', registrar: { id: 'reg-1' } },
        },
        secondaryIdentifiers: [],
        producedByOrganisation: null,
        manufacturingFacility: null,
        parent: null,
      };
      mockProductFindFirst.mockResolvedValue(productRecord);

      const result = await getProductByIdentifierValue('09506000134352', TENANT_ID);

      expect(result).toEqual(productRecord);
      expect(mockProductFindFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          primaryIdentifier: { value: '09506000134352' },
        },
        include: {
          primaryIdentifier: identifierInclude,
          secondaryIdentifiers: { include: { identifier: identifierInclude } },
          producedByOrganisation: true,
          manufacturingFacility: true,
          parent: { include: { primaryIdentifier: identifierInclude } },
        },
      });
    });

    it('returns null when no product matches', async () => {
      mockProductFindFirst.mockResolvedValue(null);

      const result = await getProductByIdentifierValue('nonexistent', TENANT_ID);

      expect(result).toBeNull();
    });
  });
});
