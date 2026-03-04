const mockImportCatalogue = jest.fn();
const mockParserParse = jest.fn();
const mockGetCvcParser = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  importCatalogue: (...args: unknown[]) => mockImportCatalogue(...args),
}));

jest.mock('@uncefact/untp-ri-services', () => ({
  getCvcParser: (...args: unknown[]) => mockGetCvcParser(...args),
  SUPPORTED_CVC_VERSIONS: ['0.7.0'],
}));

import { ValidationError } from '@/lib/api/validation';
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

const MOCK_PARSED_CATALOGUE = {
  canonicalId: 'https://example.com/cvc/sample-catalogue',
  name: 'Sample Sustainability Scheme',
  sourceUrl: SOURCE_URL,
  schemes: [
    {
      canonicalId: 'https://example.com/cvc/sample-scheme',
      name: 'Sample Sustainability Scheme',
      slug: 'sample-sustainability-scheme',
      profiles: [
        {
          canonicalId: 'https://example.com/cvc/sample-scheme/full-assessment/1.0.0',
          name: 'Full Sustainability Assessment',
          slug: 'full-sustainability-assessment',
          version: '1.0.0',
          status: 'active',
          criteria: [
            {
              canonicalId: 'https://example.com/cvc/criteria/emissions/1.1.0',
              name: 'Greenhouse Gas Emissions',
              version: '1.1.0',
              status: 'current',
            },
            {
              canonicalId: 'https://example.com/cvc/criteria/waste/1.0.0',
              name: 'Waste Management',
              version: '1.0.0',
              status: 'current',
            },
          ],
        },
      ],
    },
  ],
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
    mockGetCvcParser.mockReturnValue({ parse: mockParserParse });
    mockParserParse.mockReturnValue(MOCK_PARSED_CATALOGUE);
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

    expect(mockFetch).toHaveBeenCalledWith(
      SOURCE_URL,
      expect.objectContaining({
        headers: { Accept: 'application/ld+json' },
      }),
    );
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
    mockGetCvcParser.mockReturnValue(null);

    await expect(importCvc(TENANT_ID, SOURCE_URL, '99.0.0')).rejects.toThrow(/Unsupported CVC version: 99\.0\.0/);
  });

  it('throws ValidationError when fetch returns a non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const err = await importCvc(TENANT_ID, SOURCE_URL, VERSION).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/responded with status 404 Not Found/);
  });

  it('throws ValidationError wrapping network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const err = await importCvc(TENANT_ID, SOURCE_URL, VERSION).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/Unable to reach the CVC catalogue at/);
    expect(err.message).toMatch(SOURCE_URL);
  });

  it('throws ValidationError when the response body is not valid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });

    const err = await importCvc(TENANT_ID, SOURCE_URL, VERSION).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/did not return valid JSON/);
    expect(err.message).toMatch(SOURCE_URL);
  });

  it('throws ValidationError when parser.parse throws', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_JSON_LD,
    });
    mockParserParse.mockImplementation(() => {
      throw new Error('Invalid catalogue structure');
    });

    const err = await importCvc(TENANT_ID, SOURCE_URL, VERSION).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/Failed to parse CVC catalogue from/);
    expect(err.message).toMatch(/Invalid catalogue structure/);
  });
});

// ── importCvcFromData ────────────────────────────────────────────────────────

describe('importCvcFromData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCvcParser.mockReturnValue({ parse: mockParserParse });
    mockParserParse.mockReturnValue(MOCK_PARSED_CATALOGUE);
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
    mockGetCvcParser.mockReturnValue(null);

    await expect(importCvcFromData(TENANT_ID, MOCK_JSON_LD, SOURCE_URL, '99.0.0')).rejects.toThrow(
      /Unsupported CVC version: 99\.0\.0/,
    );
  });

  it('throws ValidationError when parser.parse throws', async () => {
    mockParserParse.mockImplementation(() => {
      throw new Error('Malformed data');
    });

    const err = await importCvcFromData(TENANT_ID, MOCK_JSON_LD, SOURCE_URL, VERSION).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/Failed to parse CVC catalogue from/);
    expect(err.message).toMatch(/Malformed data/);
  });
});
