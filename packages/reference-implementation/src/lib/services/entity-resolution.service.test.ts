const mockGetOrganisationById = jest.fn();
const mockGetFacilityById = jest.fn();
const mockGetProductById = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getOrganisationById: (...args: unknown[]) => mockGetOrganisationById(...args),
  getFacilityById: (...args: unknown[]) => mockGetFacilityById(...args),
  getProductById: (...args: unknown[]) => mockGetProductById(...args),
}));

import { resolveEntities } from './entity-resolution.service';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const MOCK_ORGANISATION = { id: 'org-1', name: 'Test Org' };
const MOCK_FACILITY = { id: 'fac-1', name: 'Test Facility' };
const MOCK_PRODUCT = { id: 'prod-1', name: 'Test Product' };

const ALL_REFS = {
  organisationId: 'org-1',
  facilityId: 'fac-1',
  productId: 'prod-1',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupAllEntitiesFound() {
  mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);
  mockGetFacilityById.mockResolvedValue(MOCK_FACILITY);
  mockGetProductById.mockResolvedValue(MOCK_PRODUCT);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveEntities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy path: each credential type fetches the correct entities ────────

  it('fetches organisation, facility, and product for DigitalProductPassport', async () => {
    setupAllEntitiesFound();

    const result = await resolveEntities('DigitalProductPassport', ALL_REFS, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledWith('org-1', TENANT_ID);
    expect(mockGetFacilityById).toHaveBeenCalledWith('fac-1', TENANT_ID);
    expect(mockGetProductById).toHaveBeenCalledWith('prod-1', TENANT_ID);
    expect(result).toEqual({
      organisation: MOCK_ORGANISATION,
      facility: MOCK_FACILITY,
      product: MOCK_PRODUCT,
    });
  });

  it('fetches only organisation for DigitalConformityCredential', async () => {
    setupAllEntitiesFound();

    const result = await resolveEntities('DigitalConformityCredential', ALL_REFS, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledWith('org-1', TENANT_ID);
    expect(mockGetFacilityById).not.toHaveBeenCalled();
    expect(mockGetProductById).not.toHaveBeenCalled();
    expect(result).toEqual({
      organisation: MOCK_ORGANISATION,
    });
  });

  it('fetches organisation and facility for DigitalFacilityRecord', async () => {
    setupAllEntitiesFound();

    const result = await resolveEntities('DigitalFacilityRecord', ALL_REFS, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledWith('org-1', TENANT_ID);
    expect(mockGetFacilityById).toHaveBeenCalledWith('fac-1', TENANT_ID);
    expect(mockGetProductById).not.toHaveBeenCalled();
    expect(result).toEqual({
      organisation: MOCK_ORGANISATION,
      facility: MOCK_FACILITY,
    });
  });

  it('fetches only organisation for DigitalIdentityAnchor', async () => {
    setupAllEntitiesFound();

    const result = await resolveEntities('DigitalIdentityAnchor', ALL_REFS, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledWith('org-1', TENANT_ID);
    expect(mockGetFacilityById).not.toHaveBeenCalled();
    expect(mockGetProductById).not.toHaveBeenCalled();
    expect(result).toEqual({
      organisation: MOCK_ORGANISATION,
    });
  });

  it('fetches organisation and product for DigitalTraceabilityEvent', async () => {
    setupAllEntitiesFound();

    const result = await resolveEntities('DigitalTraceabilityEvent', ALL_REFS, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledWith('org-1', TENANT_ID);
    expect(mockGetFacilityById).not.toHaveBeenCalled();
    expect(mockGetProductById).toHaveBeenCalledWith('prod-1', TENANT_ID);
    expect(result).toEqual({
      organisation: MOCK_ORGANISATION,
      product: MOCK_PRODUCT,
    });
  });

  // ── NotFoundError: entity not found in database ──────────────────────────

  it('throws NotFoundError when organisation is not found', async () => {
    mockGetOrganisationById.mockResolvedValue(null);

    await expect(
      resolveEntities('DigitalConformityCredential', { organisationId: 'missing-org' }, TENANT_ID),
    ).rejects.toThrow(NotFoundError);

    await expect(
      resolveEntities('DigitalConformityCredential', { organisationId: 'missing-org' }, TENANT_ID),
    ).rejects.toThrow(/Organisation not found: missing-org/);
  });

  it('throws NotFoundError when facility is not found', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);
    mockGetFacilityById.mockResolvedValue(null);

    await expect(
      resolveEntities('DigitalFacilityRecord', { organisationId: 'org-1', facilityId: 'missing-fac' }, TENANT_ID),
    ).rejects.toThrow(NotFoundError);

    await expect(
      resolveEntities('DigitalFacilityRecord', { organisationId: 'org-1', facilityId: 'missing-fac' }, TENANT_ID),
    ).rejects.toThrow(/Facility not found: missing-fac/);
  });

  it('throws NotFoundError when product is not found', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);
    mockGetProductById.mockResolvedValue(null);

    await expect(
      resolveEntities('DigitalTraceabilityEvent', { organisationId: 'org-1', productId: 'missing-prod' }, TENANT_ID),
    ).rejects.toThrow(NotFoundError);

    await expect(
      resolveEntities('DigitalTraceabilityEvent', { organisationId: 'org-1', productId: 'missing-prod' }, TENANT_ID),
    ).rejects.toThrow(/Product not found: missing-prod/);
  });

  // ── ValidationError: unknown credential type ─────────────────────────────

  it('throws ValidationError for unknown credential type', async () => {
    await expect(resolveEntities('UnknownType', ALL_REFS, TENANT_ID)).rejects.toThrow(ValidationError);
    await expect(resolveEntities('UnknownType', ALL_REFS, TENANT_ID)).rejects.toThrow(
      /Unknown credential type: UnknownType/,
    );
  });

  // ── ValidationError: missing required refs ───────────────────────────────

  it('throws ValidationError when organisationId is missing from refs', async () => {
    await expect(resolveEntities('DigitalConformityCredential', {}, TENANT_ID)).rejects.toThrow(ValidationError);
    await expect(resolveEntities('DigitalConformityCredential', {}, TENANT_ID)).rejects.toThrow(
      /organisationId is required/,
    );
  });

  it('throws ValidationError when facilityId is missing from refs', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);

    await expect(resolveEntities('DigitalFacilityRecord', { organisationId: 'org-1' }, TENANT_ID)).rejects.toThrow(
      ValidationError,
    );
    await expect(resolveEntities('DigitalFacilityRecord', { organisationId: 'org-1' }, TENANT_ID)).rejects.toThrow(
      /facilityId is required/,
    );
  });

  it('throws ValidationError when productId is missing from refs', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);

    await expect(resolveEntities('DigitalTraceabilityEvent', { organisationId: 'org-1' }, TENANT_ID)).rejects.toThrow(
      ValidationError,
    );
    await expect(resolveEntities('DigitalTraceabilityEvent', { organisationId: 'org-1' }, TENANT_ID)).rejects.toThrow(
      /productId is required/,
    );
  });

  // ── Does not call unnecessary repos ──────────────────────────────────────

  it('does not call facility or product repos for DigitalConformityCredential', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);

    await resolveEntities('DigitalConformityCredential', { organisationId: 'org-1' }, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledTimes(1);
    expect(mockGetFacilityById).not.toHaveBeenCalled();
    expect(mockGetProductById).not.toHaveBeenCalled();
  });

  it('does not call product repo for DigitalFacilityRecord', async () => {
    mockGetOrganisationById.mockResolvedValue(MOCK_ORGANISATION);
    mockGetFacilityById.mockResolvedValue(MOCK_FACILITY);

    await resolveEntities('DigitalFacilityRecord', { organisationId: 'org-1', facilityId: 'fac-1' }, TENANT_ID);

    expect(mockGetOrganisationById).toHaveBeenCalledTimes(1);
    expect(mockGetFacilityById).toHaveBeenCalledTimes(1);
    expect(mockGetProductById).not.toHaveBeenCalled();
  });
});
