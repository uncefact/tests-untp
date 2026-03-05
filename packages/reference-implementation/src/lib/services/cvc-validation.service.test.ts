const mockFindCriteriaByCanonicalIds = jest.fn();
const mockFindProfileWithCriteriaByCanonicalId = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  findCriteriaByCanonicalIds: (...args: unknown[]) => mockFindCriteriaByCanonicalIds(...args),
  findProfileWithCriteriaByCanonicalId: (...args: unknown[]) => mockFindProfileWithCriteriaByCanonicalId(...args),
}));

import { validateCvcCompliance } from './cvc-validation.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'org-1';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('validateCvcCompliance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns CVC_NO_SCOPE when scopeUrl is undefined', async () => {
    const result = await validateCvcCompliance(TENANT_ID, {
      criteriaUrls: ['https://example.com/criterion/1'],
    });

    expect(result.warnings).toEqual([
      { code: 'CVC_NO_SCOPE', message: 'No conformity scope found in credential payload' },
    ]);
    expect(mockFindCriteriaByCanonicalIds).not.toHaveBeenCalled();
  });

  it('returns CVC_NO_CRITERIA when criteriaUrls is empty', async () => {
    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: [],
    });

    expect(result.warnings).toEqual([
      { code: 'CVC_NO_CRITERIA', message: 'No conformity criteria found in credential payload' },
    ]);
    expect(mockFindCriteriaByCanonicalIds).not.toHaveBeenCalled();
  });

  it('returns empty warnings when all criteria are found', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      criteria: [{ criterion: { canonicalId: 'c1' } }, { criterion: { canonicalId: 'c2' } }],
    });
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'c1' }, { canonicalId: 'c2' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['c1', 'c2'],
    });

    expect(result.warnings).toEqual([]);
  });

  it('returns CVC_UNKNOWN_CRITERION for unrecognised criteria', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      criteria: [{ criterion: { canonicalId: 'c1' } }],
    });
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'c1' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['c1', 'c2', 'c3'],
    });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toEqual([
      { code: 'CVC_UNKNOWN_CRITERION', message: 'Criterion not found in any imported CVC catalogue', detail: 'c2' },
      { code: 'CVC_UNKNOWN_CRITERION', message: 'Criterion not found in any imported CVC catalogue', detail: 'c3' },
    ]);
  });

  it('calls findCriteriaByCanonicalIds with correct tenantId and URLs', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      criteria: [{ criterion: { canonicalId: 'c1' } }, { criterion: { canonicalId: 'c2' } }],
    });
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'c1' }, { canonicalId: 'c2' }]);

    await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['c1', 'c2'],
    });

    expect(mockFindCriteriaByCanonicalIds).toHaveBeenCalledWith('org-1', ['c1', 'c2']);
  });

  it('short-circuits before checking criteria when scopeUrl is missing', async () => {
    const result = await validateCvcCompliance(TENANT_ID, {
      criteriaUrls: ['c1'],
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('CVC_NO_SCOPE');
    expect(mockFindCriteriaByCanonicalIds).not.toHaveBeenCalled();
  });

  // ── Profile-aware validation ──────────────────────────────────────────────

  it('warns CVC_SCOPE_NOT_FOUND when scope URL does not match any imported profile', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue(null);
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'c1' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/unknown',
      criteriaUrls: ['c1', 'c2'],
    });

    expect(mockFindProfileWithCriteriaByCanonicalId).toHaveBeenCalledWith(
      TENANT_ID,
      'https://example.com/scope/unknown',
    );
    expect(result.warnings).toContainEqual({
      code: 'CVC_SCOPE_NOT_FOUND',
      message: 'Conformity scope does not match any imported profile',
      detail: 'https://example.com/scope/unknown',
    });
    // Should still produce unknown criterion warnings
    expect(result.warnings).toContainEqual({
      code: 'CVC_UNKNOWN_CRITERION',
      message: 'Criterion not found in any imported CVC catalogue',
      detail: 'c2',
    });
  });

  it('warns CVC_MISSING_CRITERION when profile requires criteria not present in credential', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      canonicalId: 'https://example.com/scope/1',
      criteria: [
        { criterion: { canonicalId: 'cA' } },
        { criterion: { canonicalId: 'cB' } },
        { criterion: { canonicalId: 'cC' } },
      ],
    });
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'cA' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['cA'],
    });

    expect(result.warnings).toContainEqual({
      code: 'CVC_MISSING_CRITERION',
      message: 'Criterion required by profile but not present in credential',
      detail: 'cB',
    });
    expect(result.warnings).toContainEqual({
      code: 'CVC_MISSING_CRITERION',
      message: 'Criterion required by profile but not present in credential',
      detail: 'cC',
    });
    // cA is present, so no missing warning for it
    expect(result.warnings.filter((w) => w.code === 'CVC_MISSING_CRITERION')).toHaveLength(2);
  });

  it('produces no missing criterion warnings when all profile criteria are present', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      canonicalId: 'https://example.com/scope/1',
      criteria: [{ criterion: { canonicalId: 'cA' } }, { criterion: { canonicalId: 'cB' } }],
    });
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'cA' }, { canonicalId: 'cB' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['cA', 'cB'],
    });

    expect(result.warnings.filter((w) => w.code === 'CVC_MISSING_CRITERION')).toHaveLength(0);
    expect(result.warnings.filter((w) => w.code === 'CVC_SCOPE_NOT_FOUND')).toHaveLength(0);
  });

  it('combines missing and unknown criterion warnings', async () => {
    mockFindProfileWithCriteriaByCanonicalId.mockResolvedValue({
      id: 'profile-1',
      canonicalId: 'https://example.com/scope/1',
      criteria: [{ criterion: { canonicalId: 'cA' } }, { criterion: { canonicalId: 'cB' } }],
    });
    // cA is known, cX is not known in any catalogue
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'cA' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['cA', 'cX'],
    });

    // cB required by profile but missing from credential
    expect(result.warnings).toContainEqual({
      code: 'CVC_MISSING_CRITERION',
      message: 'Criterion required by profile but not present in credential',
      detail: 'cB',
    });
    // cX present in credential but not in any catalogue
    expect(result.warnings).toContainEqual({
      code: 'CVC_UNKNOWN_CRITERION',
      message: 'Criterion not found in any imported CVC catalogue',
      detail: 'cX',
    });
  });
});
