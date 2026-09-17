import {
  findConformitySchemeByCanonicalId,
  resolveConformityReferences,
  listConformitySchemes,
  listConformityProfiles,
  listConformityCriteria,
} from './conformity-scheme.repository';
import { Prisma } from '../generated';
import { SYSTEM_TENANT_ID } from '../constants';

const mockParseConformityScheme = jest.fn();

jest.mock('../prisma', () => ({
  prisma: {
    conformityScheme: {
      findMany: jest.fn(),
    },
    conformityProfile: {
      findMany: jest.fn(),
    },
    conformityCriterion: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/api/logger', () => {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(function (this: unknown) {
      if (this !== logger) throw new Error('logger method called unbound');
    }),
    error: jest.fn(function (this: unknown) {
      if (this !== logger) throw new Error('logger method called unbound');
    }),
  };
  return { appLogger: { child: () => logger } };
});

jest.mock('@uncefact/untp-utils/conformity-vocabulary', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/conformity-vocabulary');
  return {
    ...actual,
    parseConformityScheme: (...args: unknown[]) => mockParseConformityScheme(...args),
  };
});

import { prisma } from '../prisma';

const mockLogger = jest.requireMock('@/lib/api/logger').appLogger.child() as {
  info: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const mockFindMany = (prisma.conformityScheme as unknown as { findMany: jest.Mock }).findMany;
const mockGlobalFindMany = mockFindMany;
const mockProfileFindMany = (prisma.conformityProfile as unknown as { findMany: jest.Mock }).findMany;
const mockCriterionFindMany = (prisma.conformityCriterion as unknown as { findMany: jest.Mock }).findMany;
const mockTransaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
const mockTransactionFindMany = jest.fn();
const transactionClient = { conformityScheme: { findMany: mockTransactionFindMany } };

const TENANT = 'tenant-1';
const CANONICAL = 'https://coppermark.org';

/** Builds a persisted-scheme row as Prisma would return it (with the include graph). */
function schemeRow(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: CANONICAL,
    id: 'scheme-row-1',
    tenantId: SYSTEM_TENANT_ID,
    sourceUrl: 'https://coppermark.org/scheme.json',
    specVersion: '0.7.0',
    name: 'Coppermark',
    description: 'A scheme',
    documentation: null,
    ownerCanonicalId: 'https://coppermark.org',
    ownerName: 'Coppermark Org',
    rawDocument: null,
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

beforeEach(() => {
  jest.clearAllMocks();
  const actual = jest.requireActual('@uncefact/untp-utils/conformity-vocabulary') as {
    parseConformityScheme: (...args: unknown[]) => unknown;
  };
  mockParseConformityScheme.mockImplementation((...args: unknown[]) => actual.parseConformityScheme(...args));
  mockTransaction.mockImplementation(async (callback: (client: typeof transactionClient) => unknown) =>
    callback(transactionClient),
  );
});

describe('findConformitySchemeByCanonicalId', () => {
  const mockFindMany = mockTransactionFindMany;

  it('uses a repeatable-read transaction for graph and document projection', async () => {
    mockFindMany.mockResolvedValue([schemeRow({ name: 'Transaction graph' })]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(result?.scheme.name).toBe('Transaction graph');
    expect(mockGlobalFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('projects the stored document after the transaction resolves', async () => {
    let transactionResolved = false;
    const actual = jest.requireActual('@uncefact/untp-utils/conformity-vocabulary') as {
      parseConformityScheme: (...args: unknown[]) => unknown;
    };
    mockParseConformityScheme.mockImplementation((...args: unknown[]) => {
      expect(transactionResolved).toBe(true);
      return actual.parseConformityScheme(...args);
    });
    mockTransaction.mockImplementationOnce(async (callback: (client: typeof transactionClient) => unknown) => {
      const result = await callback(transactionClient);
      transactionResolved = true;
      return result;
    });
    mockFindMany.mockResolvedValue([
      schemeRow({
        rawDocument: {
          id: CANONICAL,
          name: 'After transaction',
          schemeScoringFramework: { name: 'Scheme result', score: [{ code: 'A' }] },
        },
      }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(result?.scheme.scoringFramework?.scores.map((score) => score.code)).toEqual(['A']);
    expect(mockParseConformityScheme).toHaveBeenCalledTimes(1);
  });

  it('projects a persisted row into the utils ConformityScheme shape', async () => {
    mockFindMany.mockResolvedValue([schemeRow()]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(result).toEqual({
      scheme: {
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
      },
      scoringEvidence: 'missing-raw-document',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { canonicalId: CANONICAL, sourceUrl: 'https://coppermark.org/scheme.json' },
      'Stored conformity scheme document is missing for score projection',
    );
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
    expect(result?.scheme.name).toBe('System Canonical');
  });

  it('falls back to the tenant-imported row when no system row exists', async () => {
    mockFindMany.mockResolvedValue([schemeRow({ tenantId: TENANT, name: 'Tenant Import' })]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scheme.name).toBe('Tenant Import');
  });

  it('omits owner when neither owner field is set', async () => {
    mockFindMany.mockResolvedValue([schemeRow({ ownerCanonicalId: null, ownerName: null })]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scheme).not.toHaveProperty('owner');
  });

  it('filters out a profile-criterion row whose criterion relation is missing', async () => {
    const row = schemeRow();
    row.profiles[0].criteria.unshift({ criterion: null } as unknown as (typeof row.profiles)[0]['criteria'][0]);
    mockFindMany.mockResolvedValue([row]);
    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scheme.profiles[0].criteria).toHaveLength(1);
    expect(result?.scheme.profiles[0].criteria[0].canonicalId).toBe('https://coppermark.org/rra/v3.0/criterion/26');
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
    expect(result?.scheme.profiles[0].criteria[0].topics).toEqual([]);
  });

  it('projects framework fields from the scheme row document into matching graph entries', async () => {
    const profileId = 'https://coppermark.org/rra/v3.0';
    const criterionId = 'https://coppermark.org/rra/v3.0/criterion/26';
    mockFindMany.mockResolvedValue([
      schemeRow({
        rawDocument: {
          id: CANONICAL,
          name: 'Coppermark',
          schemeScoringFramework: { name: 'Scheme result', score: [{ code: 'A' }] },
          includedProfile: [
            {
              id: profileId,
              name: 'RRA v3.0',
              version: '3.0',
              status: 'active',
              criterionScoringFramework: [{ name: 'Criterion result', score: [{ code: 'B' }] }],
              criterion: [
                {
                  id: criterionId,
                  name: 'Criterion 26',
                  version: '3.0',
                  status: 'active',
                  requiredPerformance: [{ score: { code: 'C' } }],
                },
              ],
            },
          ],
        },
      }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scoringEvidence).toBe('available');
    expect(result?.scheme.scoringFramework?.scores.map((score) => score.code)).toEqual(['A']);
    expect(result?.scheme.profiles[0].criterionScoringFrameworks?.[0].scores.map((score) => score.code)).toEqual(['B']);
    expect(result?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('C');
  });

  it('matches framework evidence to each profile and criterion by canonical id', async () => {
    const profileOne = 'https://scheme.example/profile/one';
    const profileTwo = 'https://scheme.example/profile/two';
    const criterionOneA = 'https://scheme.example/criterion/one-a';
    const criterionOneB = 'https://scheme.example/criterion/one-b';
    const criterionTwoA = 'https://scheme.example/criterion/two-a';
    const criterionTwoB = 'https://scheme.example/criterion/two-b';
    mockFindMany.mockResolvedValue([
      schemeRow({
        profiles: [
          {
            canonicalId: profileOne,
            name: 'Profile one',
            version: '1.0.0',
            status: 'active',
            description: null,
            documentation: null,
            validFrom: null,
            criteria: [
              {
                criterion: {
                  canonicalId: criterionOneA,
                  name: 'Criterion one A',
                  version: '1.0.0',
                  status: 'active',
                  topics: [],
                  tags: [],
                },
              },
              {
                criterion: {
                  canonicalId: criterionOneB,
                  name: 'Criterion one B',
                  version: '1.0.0',
                  status: 'active',
                  topics: [],
                  tags: [],
                },
              },
            ],
          },
          {
            canonicalId: profileTwo,
            name: 'Profile two',
            version: '1.0.0',
            status: 'active',
            description: null,
            documentation: null,
            validFrom: null,
            criteria: [
              {
                criterion: {
                  canonicalId: criterionTwoA,
                  name: 'Criterion two A',
                  version: '1.0.0',
                  status: 'active',
                  topics: [],
                  tags: [],
                },
              },
              {
                criterion: {
                  canonicalId: criterionTwoB,
                  name: 'Criterion two B',
                  version: '1.0.0',
                  status: 'active',
                  topics: [],
                  tags: [],
                },
              },
            ],
          },
        ],
        rawDocument: {
          id: CANONICAL,
          name: 'Coppermark',
          includedProfile: [
            {
              id: profileTwo,
              name: 'Profile two',
              version: '1.0.0',
              status: 'active',
              criterionScoringFramework: [{ name: 'Profile two framework', score: [{ code: 'P2' }] }],
              criterion: [
                {
                  id: criterionTwoB,
                  name: 'Criterion two B',
                  version: '1.0.0',
                  status: 'active',
                  requiredPerformance: [{ score: { code: 'C2B' } }],
                },
                {
                  id: criterionTwoA,
                  name: 'Criterion two A',
                  version: '1.0.0',
                  status: 'active',
                  requiredPerformance: [{ score: { code: 'C2A' } }],
                },
              ],
            },
            {
              id: profileOne,
              name: 'Profile one',
              version: '1.0.0',
              status: 'active',
              criterionScoringFramework: [{ name: 'Profile one framework', score: [{ code: 'P1' }] }],
              criterion: [
                {
                  id: criterionOneB,
                  name: 'Criterion one B',
                  version: '1.0.0',
                  status: 'active',
                  requiredPerformance: [{ score: { code: 'C1B' } }],
                },
                {
                  id: criterionOneA,
                  name: 'Criterion one A',
                  version: '1.0.0',
                  status: 'active',
                  requiredPerformance: [{ score: { code: 'C1A' } }],
                },
              ],
            },
          ],
        },
      }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scheme.profiles).toEqual([
      expect.objectContaining({
        canonicalId: profileOne,
        criterionScoringFrameworks: [{ name: 'Profile one framework', scores: [{ code: 'P1' }] }],
        criteria: [
          expect.objectContaining({ canonicalId: criterionOneA, requiredPerformance: [{ score: { code: 'C1A' } }] }),
          expect.objectContaining({ canonicalId: criterionOneB, requiredPerformance: [{ score: { code: 'C1B' } }] }),
        ],
      }),
      expect.objectContaining({
        canonicalId: profileTwo,
        criterionScoringFrameworks: [{ name: 'Profile two framework', scores: [{ code: 'P2' }] }],
        criteria: [
          expect.objectContaining({ canonicalId: criterionTwoA, requiredPerformance: [{ score: { code: 'C2A' } }] }),
          expect.objectContaining({ canonicalId: criterionTwoB, requiredPerformance: [{ score: { code: 'C2B' } }] }),
        ],
      }),
    ]);
  });

  it('does not parse or project scores when score projection is not requested', async () => {
    mockFindMany.mockResolvedValue([
      schemeRow({ rawDocument: { id: CANONICAL, name: 'Coppermark', schemeScoringFramework: { score: 17 } } }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT, { projectScores: false });
    expect(result?.scoringEvidence).toBe('not-requested');
    expect(result?.scheme.scoringFramework).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('keeps the graph and reports unparseable scoring evidence with failure pointers', async () => {
    mockFindMany.mockResolvedValue([
      schemeRow({
        rawDocument: {
          id: CANONICAL,
          name: 'Coppermark',
          schemeScoringFramework: { name: 'Bad', score: [{ code: 17 }] },
        },
      }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scoringEvidence).toBe('unparseable-raw-document');
    expect(result?.scheme.profiles).toHaveLength(1);
    expect(result?.scheme.scoringFramework).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'scheme-row-1',
        tenantId: SYSTEM_TENANT_ID,
        specVersion: '0.7.0',
        failurePointers: ['/schemeScoringFramework/score/0/code'],
      }),
      expect.any(String),
    );
  });

  it('logs one warning per unreadable document body', async () => {
    mockFindMany.mockResolvedValue([
      schemeRow({
        rawDocument: {
          id: CANONICAL,
          name: 'Repeated failure',
          schemeScoringFramework: { name: 'Bad', score: [{ code: 17 }] },
        },
      }),
    ]);

    const first = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    const second = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(first?.scoringEvidence).toBe('unparseable-raw-document');
    expect(second?.scoringEvidence).toBe('unparseable-raw-document');
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'scheme-row-1', tenantId: SYSTEM_TENANT_ID, specVersion: '0.7.0' }),
      expect.any(String),
    );
  });

  it('logs two warnings when the same row has different unreadable bodies', async () => {
    mockFindMany
      .mockResolvedValueOnce([
        schemeRow({
          rawDocument: {
            id: CANONICAL,
            name: 'Different body one',
            schemeScoringFramework: { name: 'Bad', score: [{ code: 17 }] },
          },
        }),
      ])
      .mockResolvedValueOnce([
        schemeRow({
          rawDocument: {
            id: CANONICAL,
            name: 'Different body two',
            schemeScoringFramework: { name: 'Bad', score: [{ code: 17 }] },
          },
        }),
      ]);

    await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('logs two warnings when different rows have the same unreadable body', async () => {
    const rawDocument = {
      id: CANONICAL,
      name: 'Shared unreadable body',
      schemeScoringFramework: { name: 'Bad', score: [{ code: 17 }] },
    };
    mockFindMany
      .mockResolvedValueOnce([schemeRow({ id: 'scheme-row-a', rawDocument })])
      .mockResolvedValueOnce([schemeRow({ id: 'scheme-row-b', rawDocument })]);

    await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    await findConformitySchemeByCanonicalId(CANONICAL, TENANT);

    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('keeps the graph and logs non-parse failures at error', async () => {
    mockFindMany.mockResolvedValue([
      schemeRow({ specVersion: '99.0.0', rawDocument: { id: CANONICAL, name: 'Coppermark' } }),
    ]);

    const result = await findConformitySchemeByCanonicalId(CANONICAL, TENANT);
    expect(result?.scoringEvidence).toBe('unparseable-raw-document');
    expect(result?.scheme.profiles).toHaveLength(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalId: CANONICAL,
        sourceUrl: 'https://coppermark.org/scheme.json',
        failurePointers: [],
      }),
      expect.any(String),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('resolveConformityReferences', () => {
  it('returns visible matches in scheme, profile and criterion tier order', async () => {
    const profileId = 'https://scheme.example/profile/1.0.0';
    const criterionId = 'https://scheme.example/criterion/1.0.0';
    mockFindMany.mockResolvedValueOnce([{ canonicalId: 'https://scheme.example', tenantId: SYSTEM_TENANT_ID }]);
    mockProfileFindMany.mockResolvedValueOnce([
      {
        canonicalId: profileId,
        tenantId: TENANT,
        scheme: { canonicalId: 'https://scheme.example', tenantId: TENANT },
      },
    ]);
    mockCriterionFindMany.mockResolvedValueOnce([
      {
        canonicalId: criterionId,
        tenantId: TENANT,
        profiles: [
          {
            profile: {
              canonicalId: profileId,
              tenantId: TENANT,
              scheme: { canonicalId: 'https://scheme.example', tenantId: TENANT },
            },
          },
        ],
      },
    ]);

    await expect(
      resolveConformityReferences(['https://scheme.example', profileId, criterionId], TENANT),
    ).resolves.toEqual(
      new Map([
        ['https://scheme.example', [{ tier: 'scheme', schemes: ['https://scheme.example'] }]],
        [profileId, [{ tier: 'profile', schemes: ['https://scheme.example'] }]],
        [criterionId, [{ tier: 'criterion', schemes: ['https://scheme.example'], profiles: [profileId] }]],
      ]),
    );
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          canonicalId: { in: ['https://scheme.example', profileId, criterionId] },
          tenantId: { in: [SYSTEM_TENANT_ID, TENANT] },
        },
        orderBy: { canonicalId: 'asc' },
      }),
    );
    expect(mockProfileFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { canonicalId: 'asc' } }));
    expect(mockCriterionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { canonicalId: 'asc' },
        where: expect.objectContaining({
          canonicalId: { in: ['https://scheme.example', profileId, criterionId] },
          tenantId: { in: [SYSTEM_TENANT_ID, TENANT] },
        }),
        select: expect.objectContaining({
          profiles: {
            where: { profile: { tenantId: { in: [SYSTEM_TENANT_ID, TENANT] } } },
            select: expect.any(Object),
          },
        }),
      }),
    );
  });

  it('uses system rows and their parents instead of shadowed tenant rows at each tier', async () => {
    const profileId = 'https://scheme.example/profile/1.0.0';
    const criterionId = 'https://scheme.example/criterion/1.0.0';
    mockFindMany.mockResolvedValueOnce([]);
    mockProfileFindMany.mockResolvedValueOnce([
      { canonicalId: profileId, tenantId: TENANT, scheme: { canonicalId: 'https://tenant.example', tenantId: TENANT } },
      {
        canonicalId: profileId,
        tenantId: SYSTEM_TENANT_ID,
        scheme: { canonicalId: 'https://system.example', tenantId: SYSTEM_TENANT_ID },
      },
    ]);
    mockCriterionFindMany.mockResolvedValueOnce([
      {
        canonicalId: criterionId,
        tenantId: TENANT,
        profiles: [
          {
            profile: {
              canonicalId: profileId,
              tenantId: TENANT,
              scheme: { canonicalId: 'https://tenant.example', tenantId: TENANT },
            },
          },
        ],
      },
      {
        canonicalId: criterionId,
        tenantId: SYSTEM_TENANT_ID,
        profiles: [
          {
            profile: {
              canonicalId: profileId,
              tenantId: SYSTEM_TENANT_ID,
              scheme: { canonicalId: 'https://system.example', tenantId: SYSTEM_TENANT_ID },
            },
          },
        ],
      },
    ]);

    await expect(resolveConformityReferences([profileId, criterionId], TENANT)).resolves.toEqual(
      new Map([
        [profileId, [{ tier: 'profile', schemes: ['https://system.example'] }]],
        [criterionId, [{ tier: 'criterion', schemes: ['https://system.example'], profiles: [profileId] }]],
      ]),
    );
  });

  it('does not return a wrong-tier match for a criterion with no visible profiles', async () => {
    const criterionId = 'https://scheme.example/orphan-criterion';
    mockFindMany.mockResolvedValueOnce([]);
    mockProfileFindMany.mockResolvedValueOnce([]);
    mockCriterionFindMany.mockResolvedValueOnce([{ canonicalId: criterionId, tenantId: TENANT, profiles: [] }]);

    const references = await resolveConformityReferences([criterionId], TENANT);
    expect(references).toEqual(new Map([[criterionId, []]]));
  });
});

describe('listConformitySchemes', () => {
  function summaryRow(overrides: Record<string, unknown> = {}) {
    return {
      canonicalId: CANONICAL,
      name: 'Coppermark',
      specVersion: '0.7.0',
      ownerCanonicalId: 'https://coppermark.org',
      ownerName: 'Coppermark Org',
      tenantId: SYSTEM_TENANT_ID,
      ...overrides,
    };
  }

  it('returns picker summaries sorted by name, with owner', async () => {
    mockFindMany.mockResolvedValue([
      summaryRow({ canonicalId: 'https://b.example', name: 'Bravo' }),
      summaryRow({ canonicalId: 'https://a.example', name: 'Alpha' }),
    ]);
    const result = await listConformitySchemes(TENANT);
    expect(result).toEqual([
      {
        id: 'https://a.example',
        name: 'Alpha',
        specVersion: '0.7.0',
        owner: { canonicalId: 'https://coppermark.org', name: 'Coppermark Org' },
      },
      {
        id: 'https://b.example',
        name: 'Bravo',
        specVersion: '0.7.0',
        owner: { canonicalId: 'https://coppermark.org', name: 'Coppermark Org' },
      },
    ]);
  });

  it('queries both the system-tenant and caller-tenant lanes', async () => {
    mockFindMany.mockResolvedValue([]);
    await listConformitySchemes(TENANT);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: [SYSTEM_TENANT_ID, TENANT] } } }),
    );
  });

  it('prefers the system-tenant row over a tenant import of the same URI', async () => {
    mockFindMany.mockResolvedValue([
      summaryRow({ tenantId: TENANT, name: 'Tenant Import' }),
      summaryRow({ tenantId: SYSTEM_TENANT_ID, name: 'System Canonical' }),
    ]);
    const result = await listConformitySchemes(TENANT);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('System Canonical');
  });

  it('omits owner when neither owner field is set', async () => {
    mockFindMany.mockResolvedValue([summaryRow({ ownerCanonicalId: null, ownerName: null })]);
    const [scheme] = await listConformitySchemes(TENANT);
    expect(scheme).not.toHaveProperty('owner');
  });
});

describe('listConformityProfiles', () => {
  const SCHEME = 'https://coppermark.org';
  function schemeWithProfiles(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: SYSTEM_TENANT_ID,
      profiles: [
        {
          canonicalId: 'https://coppermark.org/rra/v3.0',
          name: 'RRA v3.0',
          version: '3.0',
          status: 'active',
          validFrom: '2025-01-01',
        },
      ],
      ...overrides,
    };
  }

  it('returns profile summaries for the scheme and queries both lanes', async () => {
    mockFindMany.mockResolvedValue([schemeWithProfiles()]);
    const result = await listConformityProfiles(SCHEME, TENANT);
    expect(result).toEqual([
      {
        id: 'https://coppermark.org/rra/v3.0',
        name: 'RRA v3.0',
        version: '3.0',
        status: 'active',
        validFrom: '2025-01-01',
      },
    ]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { canonicalId: SCHEME, tenantId: { in: [SYSTEM_TENANT_ID, TENANT] } } }),
    );
  });

  it('prefers the system-tenant scheme row', async () => {
    mockFindMany.mockResolvedValue([
      schemeWithProfiles({
        tenantId: TENANT,
        profiles: [{ canonicalId: 'https://tenant.example/p', name: 'Tenant', version: '1', status: 'active' }],
      }),
      schemeWithProfiles({ tenantId: SYSTEM_TENANT_ID }),
    ]);
    const result = await listConformityProfiles(SCHEME, TENANT);
    expect(result.map((p) => p.name)).toEqual(['RRA v3.0']);
  });

  it('returns an empty list for an unknown scheme', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await listConformityProfiles(SCHEME, TENANT)).toEqual([]);
  });
});

describe('listConformityCriteria', () => {
  const PROFILE = 'https://coppermark.org/rra/v3.0';
  function profileWithCriteria(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: SYSTEM_TENANT_ID,
      criteria: [
        {
          criterion: {
            canonicalId: 'https://coppermark.org/rra/v3.0/criterion/26',
            name: 'Criterion 26',
            version: '3.0',
            status: 'active',
            topics: [{ canonicalId: 'https://vocabulary.example.com/conformity-topic/ghg' }],
            tags: ['environment'],
          },
        },
      ],
      ...overrides,
    };
  }

  it('returns criterion summaries with topics and tags and queries both lanes', async () => {
    mockProfileFindMany.mockResolvedValue([profileWithCriteria()]);
    const result = await listConformityCriteria(PROFILE, TENANT);
    expect(result).toEqual([
      {
        id: 'https://coppermark.org/rra/v3.0/criterion/26',
        name: 'Criterion 26',
        version: '3.0',
        status: 'active',
        topics: [{ canonicalId: 'https://vocabulary.example.com/conformity-topic/ghg' }],
        tags: ['environment'],
      },
    ]);
    expect(mockProfileFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { canonicalId: PROFILE, tenantId: { in: [SYSTEM_TENANT_ID, TENANT] } } }),
    );
  });

  it('filters out a missing criterion relation and tolerates a null topics column', async () => {
    mockProfileFindMany.mockResolvedValue([
      {
        tenantId: SYSTEM_TENANT_ID,
        criteria: [
          { criterion: null },
          { criterion: { canonicalId: 'c2', name: 'C2', version: '1', status: 'active', topics: null, tags: [] } },
        ],
      },
    ]);
    const result = await listConformityCriteria(PROFILE, TENANT);
    expect(result).toEqual([{ id: 'c2', name: 'C2', version: '1', status: 'active', topics: [], tags: [] }]);
  });

  it('returns an empty list for an unknown profile', async () => {
    mockProfileFindMany.mockResolvedValue([]);
    expect(await listConformityCriteria(PROFILE, TENANT)).toEqual([]);
  });
});
