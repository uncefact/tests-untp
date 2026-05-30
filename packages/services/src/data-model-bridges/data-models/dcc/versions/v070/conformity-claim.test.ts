import { extractDccConformityClaim } from './conformity-claim';

describe('extractDccConformityClaim (v0.7.0)', () => {
  it('extracts scheme, profile, and criteria with all of their topics', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      referenceProfile: { id: 'https://example.com/scheme/rra/v3.0' },
      conformityAssessment: [
        {
          assessmentCriteria: [
            {
              id: 'https://example.com/scheme/rra/v3.0/criterion/26',
              conformityTopic: [
                { id: 'https://vocabulary.example.com/conformity-topic/greenhouse-gas-emissions' },
                { id: 'https://vocabulary.example.com/conformity-topic/renewable-energy-use' },
              ],
            },
          ],
        },
        {
          assessmentCriteria: [{ id: 'https://example.com/scheme/rra/v3.0/criterion/27' }],
        },
      ],
    };

    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://example.com/scheme',
      profile: 'https://example.com/scheme/rra/v3.0',
      criteria: [
        {
          criterion: 'https://example.com/scheme/rra/v3.0/criterion/26',
          conformityTopics: [
            'https://vocabulary.example.com/conformity-topic/greenhouse-gas-emissions',
            'https://vocabulary.example.com/conformity-topic/renewable-energy-use',
          ],
        },
        { criterion: 'https://example.com/scheme/rra/v3.0/criterion/27', conformityTopics: [] },
      ],
    });
  });

  it('returns an empty criteria array when no assessments are present', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      referenceProfile: { id: 'https://example.com/scheme/rra/v3.0' },
    };
    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://example.com/scheme',
      profile: 'https://example.com/scheme/rra/v3.0',
      criteria: [],
    });
  });

  it('skips assessment criteria without an id', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      referenceProfile: { id: 'https://example.com/s/p/1.0.0' },
      conformityAssessment: [{ assessmentCriteria: [{ name: 'no id here' }, { id: 'https://example.com/s/c/1.0.0' }] }],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([
      { criterion: 'https://example.com/s/c/1.0.0', conformityTopics: [] },
    ]);
  });

  it('collects topic ids and skips topic entries without an id', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      referenceProfile: { id: 'https://example.com/s/p/1.0.0' },
      conformityAssessment: [
        {
          assessmentCriteria: [
            { id: 'https://example.com/s/c/1.0.0', conformityTopic: [] },
            {
              id: 'https://example.com/s/c/2.0.0',
              conformityTopic: [{}, { id: 'https://vocabulary.example.com/t/1.0.0' }],
            },
          ],
        },
      ],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([
      { criterion: 'https://example.com/s/c/1.0.0', conformityTopics: [] },
      { criterion: 'https://example.com/s/c/2.0.0', conformityTopics: ['https://vocabulary.example.com/t/1.0.0'] },
    ]);
  });

  it('skips null assessment and null criterion entries from a malformed payload', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      referenceProfile: { id: 'https://example.com/s/p/1.0.0' },
      conformityAssessment: [null, { assessmentCriteria: [null, { id: 'https://example.com/s/c/1.0.0' }] }],
    } as unknown as Record<string, unknown>;
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([
      { criterion: 'https://example.com/s/c/1.0.0', conformityTopics: [] },
    ]);
  });

  it('returns null when the scheme reference is missing', () => {
    expect(extractDccConformityClaim({ referenceProfile: { id: 'https://example.com/s/p/1.0.0' } })).toBeNull();
  });

  it('returns null when the profile reference is missing', () => {
    expect(extractDccConformityClaim({ referenceScheme: { id: 'https://example.com/s' } })).toBeNull();
  });

  it('returns null for an empty subject', () => {
    expect(extractDccConformityClaim({})).toBeNull();
  });
});
