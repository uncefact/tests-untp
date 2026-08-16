const mockFindIdentifiersByValue = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  findIdentifiersByValue: (...args: unknown[]) => mockFindIdentifiersByValue(...args),
}));

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

import { resolvePublishTarget } from './resolve-publish-target';

const TENANT = 'tenant-1';

function identifier(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ident-1',
    value: '09506000134352',
    scheme: {
      name: 'GS1 GTIN',
      primaryKey: 'gtin',
      idrServiceInstanceId: 'idr-scheme-1',
      registrar: { namespace: 'gs1', idrServiceInstanceId: 'idr-registrar-1' },
    },
    ...overrides,
  };
}

function refs(overrides: Record<string, unknown> = {}) {
  return { organisations: [], facilities: [], products: [], ...overrides };
}

describe('resolvePublishTarget', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves the scheme, namespace and both IDR instances from the identifier', async () => {
    mockFindIdentifiersByValue.mockResolvedValue([identifier()]);

    const result = await resolvePublishTarget(refs({ products: [{ id: '09506000134352' }] }), TENANT);

    expect(result).toEqual({
      outcome: 'resolved',
      target: {
        identifierValue: '09506000134352',
        schemePrimaryKey: 'gtin',
        schemeNamespace: 'gs1',
        schemeIdrServiceInstanceId: 'idr-scheme-1',
        registrarIdrServiceInstanceId: 'idr-registrar-1',
      },
    });
  });

  it('narrows the lookup to the scheme the caller named, so a shared value resolves', async () => {
    mockFindIdentifiersByValue.mockResolvedValue([identifier()]);

    const result = await resolvePublishTarget(refs({ products: [{ id: '09506000134352' }] }), TENANT, 'scheme-1');

    expect(mockFindIdentifiersByValue).toHaveBeenCalledWith('09506000134352', TENANT, 'scheme-1');
    expect(result).toMatchObject({ outcome: 'resolved' });
  });

  it('reports ambiguity naming every colliding scheme rather than guessing', async () => {
    mockFindIdentifiersByValue.mockResolvedValue([
      { ...identifier(), schemeId: 'scheme-a' },
      {
        ...identifier({ id: 'ident-2' }),
        schemeId: 'scheme-b',
        scheme: { ...identifier().scheme, name: 'Internal SKU' },
      },
    ]);

    const result = await resolvePublishTarget(refs({ products: [{ id: '09506000134352' }] }), TENANT);

    expect(result).toEqual({
      outcome: 'ambiguous',
      value: '09506000134352',
      candidates: [
        { schemeId: 'scheme-a', schemeName: 'GS1 GTIN' },
        { schemeId: 'scheme-b', schemeName: 'Internal SKU' },
      ],
    });
  });

  it('reports a value no identifier is registered for', async () => {
    mockFindIdentifiersByValue.mockResolvedValue([]);

    const result = await resolvePublishTarget(refs({ products: [{ id: 'unknown' }] }), TENANT);

    expect(result).toEqual({ outcome: 'not-found', value: 'unknown' });
  });

  it.each([
    ['a scheme without a primary key', { ...identifier().scheme, primaryKey: '' }],
    ['a registrar without a namespace', { ...identifier().scheme, registrar: { namespace: '' } }],
  ])('reports %s as incomplete rather than publishing under a partial scheme', async (_label, scheme) => {
    mockFindIdentifiersByValue.mockResolvedValue([identifier({ scheme })]);

    const result = await resolvePublishTarget(refs({ products: [{ id: '09506000134352' }] }), TENANT);

    expect(result).toEqual({ outcome: 'incomplete', value: '09506000134352' });
  });

  it('reports no reference when the payload yields none', async () => {
    const result = await resolvePublishTarget(refs(), TENANT);

    expect(result).toEqual({ outcome: 'no-reference' });
    expect(mockFindIdentifiersByValue).not.toHaveBeenCalled();
  });

  it('prefers the product reference, then facility, then organisation', async () => {
    mockFindIdentifiersByValue.mockResolvedValue([identifier()]);

    await resolvePublishTarget(
      refs({
        products: [{ id: 'product-value' }],
        facilities: [{ id: 'facility-value' }],
        organisations: [{ id: 'org-value' }],
      }),
      TENANT,
    );
    expect(mockFindIdentifiersByValue).toHaveBeenLastCalledWith('product-value', TENANT, undefined);

    await resolvePublishTarget(
      refs({ facilities: [{ id: 'facility-value' }], organisations: [{ id: 'org-value' }] }),
      TENANT,
    );
    expect(mockFindIdentifiersByValue).toHaveBeenLastCalledWith('facility-value', TENANT, undefined);
  });

  it('does not fall through to another entity type when the chosen reference does not resolve', async () => {
    // Publishing under a facility because the product reference missed would
    // be a silent substitution of subject (ADR-043).
    mockFindIdentifiersByValue.mockResolvedValue([]);

    const result = await resolvePublishTarget(
      refs({ products: [{ id: 'product-value' }], facilities: [{ id: 'facility-value' }] }),
      TENANT,
    );

    expect(result).toEqual({ outcome: 'not-found', value: 'product-value' });
    expect(mockFindIdentifiersByValue).toHaveBeenCalledTimes(1);
  });
});
