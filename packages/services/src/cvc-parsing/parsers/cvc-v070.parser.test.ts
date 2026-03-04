import { CvcV070Parser } from './cvc-v070.parser';

const parser = new CvcV070Parser();

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCE_URL = 'https://example.com/cvc/sample-catalogue';

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CvcV070Parser', () => {
  it('parses a full JSON-LD document into the correct shape', () => {
    const result = parser.parse(MOCK_JSON_LD, SOURCE_URL);

    expect(result).toEqual({
      canonicalId: 'https://example.com/cvc/sample-catalogue',
      name: 'example.com',
      sourceUrl: SOURCE_URL,
      schemes: [
        {
          canonicalId: 'https://example.com/cvc/sample-scheme',
          name: 'Sample Sustainability Scheme',
          slug: 'sample-scheme',
          description: 'A conformity assessment scheme.',
          profiles: [
            {
              canonicalId: 'https://example.com/cvc/sample-scheme/full-assessment/1.0.0',
              name: 'Full Sustainability Assessment',
              slug: 'full-assessment',
              version: '1.0.0',
              status: 'active',
              description: 'Full assessment profile.',
              criteria: [
                {
                  canonicalId: 'https://example.com/cvc/criteria/emissions/1.1.0',
                  name: 'Greenhouse Gas Emissions',
                  version: '1.1.0',
                  status: 'current',
                  description: 'Assessment of greenhouse gas emission levels.',
                  conformityTopic: 'environment.emissions',
                  passThreshold: { minScore: 80 },
                  documentation: 'https://docs.example.com/emissions',
                },
                {
                  canonicalId: 'https://example.com/cvc/criteria/waste/1.0.0',
                  name: 'Waste Management',
                  version: '1.0.0',
                  status: 'current',
                  description: 'Assessment of waste reduction practices.',
                  conformityTopic: 'environment.waste',
                  passThreshold: { minScore: 90 },
                  documentation: 'https://docs.example.com/waste',
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('derives name from URL hostname when root has no name field', () => {
    const result = parser.parse(MOCK_JSON_LD, SOURCE_URL);

    expect(result.name).toBe('example.com');
  });

  it('uses root name when present', () => {
    const dataWithName = { ...MOCK_JSON_LD, name: 'My CVC Catalogue' };
    const result = parser.parse(dataWithName, SOURCE_URL);

    expect(result.name).toBe('My CVC Catalogue');
  });

  it('extracts scheme slugs from URLs', () => {
    const result = parser.parse(MOCK_JSON_LD, SOURCE_URL);

    expect(result.schemes[0].slug).toBe('sample-scheme');
  });

  it('extracts profile slugs using second-to-last segment when last is a version', () => {
    const result = parser.parse(MOCK_JSON_LD, SOURCE_URL);

    expect(result.schemes[0].profiles[0].slug).toBe('full-assessment');
  });

  it('uses last segment for profile slug when last is not a version', () => {
    const profileNoVersion = {
      ...MOCK_PROFILE,
      id: 'https://example.com/cvc/sample-scheme/simple-check',
      version: '1.0.0',
    };
    const schemeWithSimpleProfile = {
      ...MOCK_SCHEME,
      includedProfile: [profileNoVersion],
    };
    const data = { ...MOCK_JSON_LD, conformityScheme: [schemeWithSimpleProfile] };

    const result = parser.parse(data, SOURCE_URL);

    expect(result.schemes[0].profiles[0].slug).toBe('simple-check');
  });

  it('extracts criteria fields correctly (conformityTopic, passThreshold, documentation)', () => {
    const result = parser.parse(MOCK_JSON_LD, SOURCE_URL);
    const criterion = result.schemes[0].profiles[0].criteria[0];

    expect(criterion.conformityTopic).toBe('environment.emissions');
    expect(criterion.passThreshold).toEqual({ minScore: 80 });
    expect(criterion.documentation).toBe('https://docs.example.com/emissions');
  });

  it('throws when root id is missing', () => {
    const dataNoId = { ...MOCK_JSON_LD, id: undefined };

    expect(() => parser.parse(dataNoId, SOURCE_URL)).toThrow('CVC JSON-LD missing root id');
  });

  it('throws when conformityScheme is missing', () => {
    const dataNoSchemes = { ...MOCK_JSON_LD, conformityScheme: undefined };

    expect(() => parser.parse(dataNoSchemes, SOURCE_URL)).toThrow('CVC JSON-LD missing conformityScheme array');
  });

  it('handles empty criteria arrays gracefully', () => {
    const profileNoCriteria = { ...MOCK_PROFILE, criterion: [] };
    const schemeNoCriteria = { ...MOCK_SCHEME, includedProfile: [profileNoCriteria] };
    const data = { ...MOCK_JSON_LD, conformityScheme: [schemeNoCriteria] };

    const result = parser.parse(data, SOURCE_URL);

    expect(result.schemes[0].profiles[0].criteria).toEqual([]);
  });

  it('handles missing criterion array (undefined) gracefully', () => {
    const profileUndefinedCriteria = { ...MOCK_PROFILE, criterion: undefined };
    const schemeUndefinedCriteria = { ...MOCK_SCHEME, includedProfile: [profileUndefinedCriteria] };
    const data = { ...MOCK_JSON_LD, conformityScheme: [schemeUndefinedCriteria] };

    const result = parser.parse(data, SOURCE_URL);

    expect(result.schemes[0].profiles[0].criteria).toEqual([]);
  });

  it('throws when data is not an object', () => {
    expect(() => parser.parse(null, SOURCE_URL)).toThrow('CVC JSON-LD data must be a non-null object');
  });
});
