const mockImportCatalogue = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  importCatalogue: (...args: unknown[]) => mockImportCatalogue(...args),
}));

import { importCvc, importCvcFromData } from './cvc-import.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const SOURCE_URL = 'https://example.com/cvc/sample-catalogue';
const VERSION = '0.7.0';

const MOCK_CRITERION_A = {
  type: ['Criterion'],
  id: 'https://example.com/cvc/criteria/emissions/1.1.0',
  name: 'Greenhouse Gas Emissions',
  description: 'Assessment of greenhouse gas emission levels.',
  version: '1.1.0',
  status: 'current',
  conformityTopic: 'environment.emissions',
  passThreshold: { minScore: 80 },
  documentation: 'https://docs.example.com/emissions',
};

const MOCK_CRITERION_B = {
  type: ['Criterion'],
  id: 'https://example.com/cvc/criteria/waste/1.0.0',
  name: 'Waste Management',
  description: 'Assessment of waste reduction practices.',
  version: '1.0.0',
  status: 'current',
  conformityTopic: 'environment.waste',
  passThreshold: { minScore: 90 },
  documentation: 'https://docs.example.com/waste',
};

const MOCK_PROFILE = {
  type: ['ConformityProfile'],
  id: 'https://example.com/cvc/sample-scheme/full-assessment/1.0.0',
  name: 'Full Sustainability Assessment',
  version: '1.0.0',
  status: 'active',
  description: 'Full assessment profile.',
  criterion: [MOCK_CRITERION_A, MOCK_CRITERION_B],
};

const MOCK_SCHEME = {
  type: ['ConformityScheme'],
  id: 'https://example.com/cvc/sample-scheme',
  name: 'Sample Sustainability Scheme',
  description: 'A conformity assessment scheme.',
  includedProfile: [MOCK_PROFILE],
};

const MOCK_JSON_LD = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['ConformityVocabularyCatalog'],
  id: 'https://example.com/cvc/sample-catalogue',
  conformityScheme: [MOCK_SCHEME],
};

const MOCK_CATALOGUE_RESULT = {
  catalogue: { id: 'cat-1' },
  summary: { schemes: 1, profiles: 1, criteria: 2 },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('importCvc', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // @ts-expect-error -- restoring global fetch
    delete global.fetch;
  });

  it('fetches the URL with the correct Accept header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_JSON_LD,
    });
    mockImportCatalogue.mockResolvedValue(MOCK_CATALOGUE_RESULT);

    await importCvc(TENANT_ID, SOURCE_URL, VERSION);

    expect(mockFetch).toHaveBeenCalledWith(SOURCE_URL, {
      headers: { Accept: 'application/ld+json' },
    });
  });

  it('parses the response and calls importCatalogue with tenantId and specVersion', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_JSON_LD,
    });
    mockImportCatalogue.mockResolvedValue(MOCK_CATALOGUE_RESULT);

    const result = await importCvc(TENANT_ID, SOURCE_URL, VERSION);

    expect(mockImportCatalogue).toHaveBeenCalledTimes(1);
    const arg = mockImportCatalogue.mock.calls[0][0];
    expect(arg.tenantId).toBe(TENANT_ID);
    expect(arg.specVersion).toBe(VERSION);
    expect(arg.canonicalId).toBe('https://example.com/cvc/sample-catalogue');
    expect(arg.sourceUrl).toBe(SOURCE_URL);
    expect(arg.schemes).toHaveLength(1);
    expect(result).toEqual(MOCK_CATALOGUE_RESULT);
  });

  it('throws ValidationError for unsupported CVC version', async () => {
    await expect(importCvc(TENANT_ID, SOURCE_URL, '99.0.0')).rejects.toThrow(/Unsupported CVC version: 99\.0\.0/);
  });

  it('throws when fetch returns a non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(importCvc(TENANT_ID, SOURCE_URL, VERSION)).rejects.toThrow(/Failed to fetch CVC data.*404 Not Found/);
  });

  it('propagates fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await expect(importCvc(TENANT_ID, SOURCE_URL, VERSION)).rejects.toThrow('Network failure');
  });
});

// ── importCvcFromData ────────────────────────────────────────────────────────

describe('importCvcFromData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses data and calls importCatalogue with tenantId and specVersion', async () => {
    mockImportCatalogue.mockResolvedValue(MOCK_CATALOGUE_RESULT);

    const result = await importCvcFromData(TENANT_ID, MOCK_JSON_LD, SOURCE_URL, VERSION);

    expect(mockImportCatalogue).toHaveBeenCalledTimes(1);
    const arg = mockImportCatalogue.mock.calls[0][0];
    expect(arg.tenantId).toBe(TENANT_ID);
    expect(arg.specVersion).toBe(VERSION);
    expect(arg.canonicalId).toBe('https://example.com/cvc/sample-catalogue');
    expect(arg.sourceUrl).toBe(SOURCE_URL);
    expect(arg.schemes).toHaveLength(1);
    expect(result).toEqual(MOCK_CATALOGUE_RESULT);
  });

  it('throws ValidationError for unsupported CVC version', async () => {
    await expect(importCvcFromData(TENANT_ID, MOCK_JSON_LD, SOURCE_URL, '99.0.0')).rejects.toThrow(
      /Unsupported CVC version: 99\.0\.0/,
    );
  });
});
