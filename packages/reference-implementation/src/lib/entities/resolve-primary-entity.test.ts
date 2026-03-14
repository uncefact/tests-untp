jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockGetProductByIdentifierValue = jest.fn();
const mockGetFacilityByIdentifierValue = jest.fn();
const mockGetOrganisationByIdentifierValue = jest.fn();

jest.mock('@uncefact/untp-ri-services', () => ({}));

jest.mock('@/lib/prisma/repositories', () => ({
  getProductByIdentifierValue: (...args: unknown[]) => mockGetProductByIdentifierValue(...args),
  getFacilityByIdentifierValue: (...args: unknown[]) => mockGetFacilityByIdentifierValue(...args),
  getOrganisationByIdentifierValue: (...args: unknown[]) => mockGetOrganisationByIdentifierValue(...args),
}));

import { resolvePrimaryEntity } from './resolve-primary-entity';
import type { PrimaryEntityResult } from './resolve-primary-entity';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const SCHEME_INFO = {
  primaryKey: 'gtin',
  idrServiceInstanceId: 'idr-svc-1',
  registrar: { namespace: 'gs1' },
};

function makeEntity(id: string) {
  return {
    id,
    primaryIdentifier: {
      scheme: SCHEME_INFO,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolvePrimaryEntity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty result when no primaryIdentifier', async () => {
    const result = await resolvePrimaryEntity({}, TENANT_ID);

    expect(result).toEqual({});
    expect(mockGetProductByIdentifierValue).not.toHaveBeenCalled();
    expect(mockGetFacilityByIdentifierValue).not.toHaveBeenCalled();
    expect(mockGetOrganisationByIdentifierValue).not.toHaveBeenCalled();
  });

  it('resolves product entity with scheme info', async () => {
    const entity = makeEntity('prod-1');
    mockGetProductByIdentifierValue.mockResolvedValue(entity);

    const result = await resolvePrimaryEntity(
      {
        product: { id: '09506000134352' },
      },
      TENANT_ID,
    );

    expect(mockGetProductByIdentifierValue).toHaveBeenCalledWith('09506000134352', TENANT_ID);
    expect(result).toEqual<PrimaryEntityResult>({
      primaryIdentifier: '09506000134352',
      productId: 'prod-1',
      schemeNamespace: 'gs1',
      schemePrimaryKey: 'gtin',
      schemeIdrServiceInstanceId: 'idr-svc-1',
    });
  });

  it('resolves facility entity when no product ref is present', async () => {
    const entity = makeEntity('fac-1');
    mockGetFacilityByIdentifierValue.mockResolvedValue(entity);

    const result = await resolvePrimaryEntity(
      {
        facility: { id: '9506000134' },
      },
      TENANT_ID,
    );

    expect(mockGetFacilityByIdentifierValue).toHaveBeenCalledWith('9506000134', TENANT_ID);
    expect(result).toEqual<PrimaryEntityResult>({
      primaryIdentifier: '9506000134',
      facilityId: 'fac-1',
      schemeNamespace: 'gs1',
      schemePrimaryKey: 'gtin',
      schemeIdrServiceInstanceId: 'idr-svc-1',
    });
  });

  it('resolves organisation entity when no product or facility ref is present', async () => {
    const entity = makeEntity('org-1');
    mockGetOrganisationByIdentifierValue.mockResolvedValue(entity);

    const result = await resolvePrimaryEntity(
      {
        organisation: { id: '9506000100' },
      },
      TENANT_ID,
    );

    expect(mockGetOrganisationByIdentifierValue).toHaveBeenCalledWith('9506000100', TENANT_ID);
    expect(result).toEqual<PrimaryEntityResult>({
      primaryIdentifier: '9506000100',
      organisationId: 'org-1',
      schemeNamespace: 'gs1',
      schemePrimaryKey: 'gtin',
      schemeIdrServiceInstanceId: 'idr-svc-1',
    });
  });

  it('returns empty result when entity not found in DB', async () => {
    mockGetProductByIdentifierValue.mockResolvedValue(null);

    const result = await resolvePrimaryEntity(
      {
        product: { id: '09506000134352' },
      },
      TENANT_ID,
    );

    expect(mockGetProductByIdentifierValue).toHaveBeenCalledWith('09506000134352', TENANT_ID);
    expect(result).toEqual({});
  });

  it('prioritises product over facility and organisation', async () => {
    const entity = makeEntity('prod-1');
    mockGetProductByIdentifierValue.mockResolvedValue(entity);

    const result = await resolvePrimaryEntity(
      {
        product: { id: 'product-id' },
        facility: { id: 'facility-id' },
        organisation: { id: 'org-id' },
      },
      TENANT_ID,
    );

    expect(mockGetProductByIdentifierValue).toHaveBeenCalledWith('product-id', TENANT_ID);
    expect(mockGetFacilityByIdentifierValue).not.toHaveBeenCalled();
    expect(mockGetOrganisationByIdentifierValue).not.toHaveBeenCalled();
    expect(result).toEqual<PrimaryEntityResult>({
      primaryIdentifier: 'product-id',
      productId: 'prod-1',
      schemeNamespace: 'gs1',
      schemePrimaryKey: 'gtin',
      schemeIdrServiceInstanceId: 'idr-svc-1',
    });
  });
});
