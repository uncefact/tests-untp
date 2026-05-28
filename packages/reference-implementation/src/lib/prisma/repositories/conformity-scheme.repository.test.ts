import { findConformitySchemeByCanonicalId } from './conformity-scheme.repository';
import { SYSTEM_TENANT_ID } from '../constants';

jest.mock('../prisma', () => ({
  prisma: {
    conformityScheme: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from '../prisma';

const mockFindMany = (prisma.conformityScheme as unknown as { findMany: jest.Mock }).findMany;

const TENANT = 'tenant-1';
const CANONICAL = 'https://coppermark.org';

/** Builds a persisted-scheme row as Prisma would return it (with the include graph). */
function schemeRow(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: CANONICAL,
    tenantId: SYSTEM_TENANT_ID,
    sourceUrl: 'https://coppermark.org/scheme.json',
    specVersion: '0.7.0',
    name: 'Coppermark',
    description: 'A scheme',
    documentation: null,
    ownerCanonicalId: 'https://coppermark.org',
    ownerName: 'Coppermark Org',
    profiles: [
      {
        canonicalId: 'https://coppermark.org/rra/v3.0',
        name: 'RRA v3.0',
        version: '3.0',
        status: 'active',
        description: null,
        documentation: null,
        validFrom: '2025-01-01',
        criteria: [
          {
            criterion: {
              canonicalId: 'https://coppermark.org/rra/v3.0/criterion/26',
              name: 'Criterion 26',
              version: '3.0',
              status: 'active',
              description: null,
              documentation: null,
              topics: [{ canonicalId: 'https://vocabulary.uncefact.org/conformity-topic/greenhouse-gas-emissions' }],
              tags: [],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('findConformitySchemeByCanonicalId', () => {
  it('projects a persisted row into the utils ConformityScheme shape', async () => {
    mockFindMany.mockResolvedValue([schemeRow()]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(result).toEqual({
      canonicalId: CANONICAL,
      sourceUrl: 'https://coppermark.org/scheme.json',
      specVersion: '0.7.0',
      name: 'Coppermark',
      description: 'A scheme',
      owner: { canonicalId: 'https://coppermark.org', name: 'Coppermark Org' },
      profiles: [
        {
          canonicalId: 'https://coppermark.org/rra/v3.0',
          name: 'RRA v3.0',
          version: '3.0',
          status: 'active',
          validFrom: '2025-01-01',
          criteria: [
            {
              canonicalId: 'https://coppermark.org/rra/v3.0/criterion/26',
              name: 'Criterion 26',
              version: '3.0',
              status: 'active',
              topics: [{ canonicalId: 'https://vocabulary.uncefact.org/conformity-topic/greenhouse-gas-emissions' }],
              tags: [],
            },
          ],
        },
      ],
    });
  });

  it('queries both the system-tenant and caller-tenant lanes', async () => {
    mockFindMany.mockResolvedValue([]);
    await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { canonicalId: CANONICAL, tenantId: { in: [SYSTEM_TENANT_ID, TENANT] } } }),
    );
  });

  it('prefers the system-tenant row over a tenant-imported row for the same URI', async () => {
    mockFindMany.mockResolvedValue([
      schemeRow({ tenantId: TENANT, name: 'Tenant Import' }),
      schemeRow({ tenantId: SYSTEM_TENANT_ID, name: 'System Canonical' }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.name).toBe('System Canonical');
  });

  it('falls back to the tenant-imported row when no system row exists', async () => {
    mockFindMany.mockResolvedValue([schemeRow({ tenantId: TENANT, name: 'Tenant Import' })]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.name).toBe('Tenant Import');
  });

  it('omits owner when neither owner field is set', async () => {
    mockFindMany.mockResolvedValue([schemeRow({ ownerCanonicalId: null, ownerName: null })]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result).not.toHaveProperty('owner');
  });

  it('filters out a profile-criterion row whose criterion relation is missing', async () => {
    const row = schemeRow();
    row.profiles[0].criteria.unshift({ criterion: null } as unknown as (typeof row.profiles)[0]['criteria'][0]);
    mockFindMany.mockResolvedValue([row]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.profiles[0].criteria).toHaveLength(1);
    expect(result?.profiles[0].criteria[0].canonicalId).toBe('https://coppermark.org/rra/v3.0/criterion/26');
  });

  it('returns null when no row exists in either lane', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await findConformitySchemeByCanonicalId(CANONICAL, TENANT)).toBeNull();
  });

  it('tolerates a null topics column', async () => {
    const row = schemeRow();
    row.profiles[0].criteria[0].criterion.topics = null as unknown as [];
    mockFindMany.mockResolvedValue([row]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.profiles[0].criteria[0].topics).toEqual([]);
  });
});
