import type { CredentialPayload, ConformityClaimWithProvenance } from '@uncefact/untp-ri-services';
import type { ConformityScheme } from '@uncefact/untp-utils/conformity-vocabulary';
import { validateConformityClaimAtIssuance } from './validate-conformity-claim-at-issuance';

jest.mock('@/lib/prisma/repositories', () => ({
  findConformitySchemeByCanonicalId: (...args: unknown[]) => mockFindConformityScheme(...args),
  resolveConformityReferences: (...args: unknown[]) => mockResolveConformityReferences(...args),
}));

const mockFindConformityScheme = jest.fn();
const mockResolveConformityReferences = jest.fn();

const SCHEME = 'https://scheme.example/assurance';
const PROFILE = `${SCHEME}/profile/1.0.0`;
const CRITERION = `${SCHEME}/criterion/1.0.0`;

function scheme(
  profiles: ConformityScheme['profiles'] = [
    { canonicalId: PROFILE, name: 'Profile', version: '1.0.0', status: 'active', criteria: [] },
  ],
): ConformityScheme {
  return {
    canonicalId: SCHEME,
    sourceUrl: `${SCHEME}.json`,
    specVersion: '0.7.0',
    name: 'Assurance',
    profiles,
  };
}

function extracted(overrides: Partial<ConformityClaimWithProvenance['claim']> = {}): ConformityClaimWithProvenance {
  return {
    claim: { scheme: SCHEME, profile: PROFILE, criteria: [], ...overrides },
    sourceMap: {
      '/scheme': '/referenceScheme/id',
      '/profile': '/referenceProfile/id',
      '/profileScore/code': '/profileScore/code',
    },
  };
}

function payload(): CredentialPayload {
  return {
    credentialSubject: { referenceScheme: { id: SCHEME }, referenceProfile: { id: PROFILE } },
  } as CredentialPayload;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateConformityClaimAtIssuance', () => {
  it('keeps graph warnings and adds the unavailable score advisory for unparseable evidence', async () => {
    mockFindConformityScheme.mockResolvedValue({
      scheme: scheme([
        {
          canonicalId: PROFILE,
          name: 'Profile',
          version: '1.0.0',
          status: 'active',
          criteria: [
            { canonicalId: CRITERION, name: 'Criterion', version: '1.0.0', status: 'active', topics: [], tags: [] },
          ],
        },
      ]),
      scoringEvidence: 'unparseable-raw-document',
    });

    const warnings = await validateConformityClaimAtIssuance(
      extracted({ profileScore: { code: 'UNKNOWN' } }),
      payload(),
      'tenant-1',
    );

    expect(warnings.map((warning) => warning.code)).toEqual([
      'conformity-criterion.missing',
      'conformity-claim.score-checks-unavailable',
    ]);
    expect(warnings[1]).toEqual({
      code: 'conformity-claim.score-checks-unavailable',
      message:
        "Score codes were not checked because the scheme's stored document is unavailable; the applicable scheme, profile, criterion and topic checks still ran.",
      remediation:
        'Ask your operator to refresh the scheme in the catalogue, then issue again if you need the score codes checked.',
    });
  });

  it('adds the same score advisory for missing evidence while retaining the graph verdict', async () => {
    mockFindConformityScheme.mockResolvedValue({ scheme: scheme(), scoringEvidence: 'missing-raw-document' });

    const warnings = await validateConformityClaimAtIssuance(
      extracted({ profileScore: { code: 'UNKNOWN' } }),
      payload(),
      'tenant-1',
    );

    expect(warnings.some((warning) => warning.code === 'conformity-claim.score-checks-unavailable')).toBe(true);
    expect(warnings.some((warning) => warning.code === 'conformity-claim.validation-error')).toBe(false);
  });

  it('keeps the no-profile warning alongside the unavailable score advisory', async () => {
    mockFindConformityScheme.mockResolvedValue({ scheme: scheme(), scoringEvidence: 'missing-raw-document' });

    const warnings = await validateConformityClaimAtIssuance(
      extracted({ profile: undefined, profileScore: { code: 'UNKNOWN' } }),
      payload(),
      'tenant-1',
    );

    expect(warnings.map((warning) => warning.code)).toEqual([
      'conformity-profile.not-specified',
      'conformity-claim.score-checks-unavailable',
    ]);
    expect(warnings[1]).toEqual(
      expect.objectContaining({
        message:
          "Score codes were not checked because the scheme's stored document is unavailable; the applicable scheme, profile, criterion and topic checks still ran.",
      }),
    );
  });

  it('validates the reloaded graph and keeps the inconsistent-read advisory for a profile contradiction', async () => {
    mockFindConformityScheme
      .mockResolvedValueOnce({ scheme: scheme([]), scoringEvidence: 'available' })
      .mockResolvedValueOnce({ scheme: scheme([]), scoringEvidence: 'available' });
    mockResolveConformityReferences.mockResolvedValue(new Map([[PROFILE, [{ tier: 'profile', schemes: [SCHEME] }]]]));

    const warnings = await validateConformityClaimAtIssuance(extracted(), payload(), 'tenant-1');

    expect(warnings.map((warning) => warning.code)).toEqual([
      'conformity-profile.not-found',
      'conformity-claim.validation-error',
    ]);
    expect(warnings[0].expected).toEqual([]);
    expect(warnings[1].message).toBe(
      'Conformity claim validation could not be completed because the catalogue changed while the claim was checked; the credential was issued, and a later check against the catalogue gives a current verdict.',
    );
    expect(mockResolveConformityReferences).toHaveBeenCalledWith([PROFILE], 'tenant-1');
  });

  it('keeps only the inconsistent-read advisory when a scheme reload has no graph', async () => {
    mockFindConformityScheme.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockResolveConformityReferences.mockResolvedValue(new Map([[SCHEME, [{ tier: 'scheme', schemes: [SCHEME] }]]]));

    const warnings = await validateConformityClaimAtIssuance(extracted(), payload(), 'tenant-1');

    expect(warnings).toEqual([
      {
        code: 'conformity-claim.validation-error',
        message:
          'Conformity claim validation could not be completed because the catalogue changed while the claim was checked; the credential was issued, and a later check against the catalogue gives a current verdict.',
      },
    ]);
  });

  it('resolves the profile after a successful scheme reload and diagnoses a wrong-tier profile id', async () => {
    mockFindConformityScheme
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ scheme: scheme([]), scoringEvidence: 'available' });
    mockResolveConformityReferences
      .mockResolvedValueOnce(new Map([[SCHEME, [{ tier: 'scheme', schemes: [SCHEME] }]]]))
      .mockResolvedValueOnce(new Map([[PROFILE, [{ tier: 'scheme', schemes: [SCHEME] }]]]));

    const warnings = await validateConformityClaimAtIssuance(extracted(), payload(), 'tenant-1');

    expect(warnings[0]).toEqual(
      expect.objectContaining({
        code: 'conformity-profile.wrong-tier',
        received: PROFILE,
        pointer: '/credentialSubject/referenceProfile/id',
      }),
    );
    expect(mockResolveConformityReferences).toHaveBeenNthCalledWith(2, [PROFILE], 'tenant-1');
  });

  it('skips score projection and emits no unavailable advisory when the claim carries no score', async () => {
    mockFindConformityScheme.mockResolvedValue({ scheme: scheme(), scoringEvidence: 'not-requested' });

    const warnings = await validateConformityClaimAtIssuance(extracted(), payload(), 'tenant-1');

    expect(warnings).toEqual([]);
    expect(mockFindConformityScheme).toHaveBeenCalledWith(SCHEME, 'tenant-1', { projectScores: false });
  });

  it('does not emit a score advisory for missing evidence when the claim carries no score', async () => {
    mockFindConformityScheme.mockResolvedValue({ scheme: scheme(), scoringEvidence: 'missing-raw-document' });

    const warnings = await validateConformityClaimAtIssuance(extracted(), payload(), 'tenant-1');

    expect(warnings).toEqual([]);
    expect(warnings.some((warning) => warning.code === 'conformity-claim.score-checks-unavailable')).toBe(false);
  });
});
