const mockFindCriteriaByCanonicalIds = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  findCriteriaByCanonicalIds: (...args: unknown[]) => mockFindCriteriaByCanonicalIds(...args),
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
    mockFindCriteriaByCanonicalIds.mockResolvedValue([{ canonicalId: 'c1' }, { canonicalId: 'c2' }]);

    const result = await validateCvcCompliance(TENANT_ID, {
      scopeUrl: 'https://example.com/scope/1',
      criteriaUrls: ['c1', 'c2'],
    });

    expect(result.warnings).toEqual([]);
  });

  it('returns CVC_UNKNOWN_CRITERION for unrecognised criteria', async () => {
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
});
