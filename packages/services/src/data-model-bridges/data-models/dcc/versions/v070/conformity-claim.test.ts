import { extractDccConformityClaim } from './conformity-claim';

describe('extractDccConformityClaim (v0.7.0)', () => {
  it('extracts scheme, profile, and criteria with topics', () => {
    const subject = {
      referenceScheme: { id: 'https://coppermark.org' },
      referenceProfile: { id: 'https://coppermark.org/rra/v3.0' },
      conformityAssessment: [
        {
          assessmentCriteria: [
            {
              id: 'https://coppermark.org/rra/v3.0/criterion/26',
              conformityTopic: [{ id: 'https://vocabulary.uncefact.org/conformity-topic/greenhouse-gas-emissions' }],
            },
          ],
        },
        {
          assessmentCriteria: [{ id: 'https://coppermark.org/rra/v3.0/criterion/27' }],
        },
      ],
    };

    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://coppermark.org',
      profile: 'https://coppermark.org/rra/v3.0',
      criteria: [
        {
          criterion: 'https://coppermark.org/rra/v3.0/criterion/26',
          conformityTopic: 'https://vocabulary.uncefact.org/conformity-topic/greenhouse-gas-emissions',
        },
        { criterion: 'https://coppermark.org/rra/v3.0/criterion/27' },
      ],
    });
  });

  it('returns an empty criteria array when no assessments are present', () => {
    const subject = {
      referenceScheme: { id: 'https://coppermark.org' },
      referenceProfile: { id: 'https://coppermark.org/rra/v3.0' },
    };
    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://coppermark.org',
      profile: 'https://coppermark.org/rra/v3.0',
      criteria: [],
    });
  });

  it('skips assessment criteria without an id', () => {
    const subject = {
      referenceScheme: { id: 'https://s.example' },
      referenceProfile: { id: 'https://s.example/p/1.0.0' },
      conformityAssessment: [{ assessmentCriteria: [{ name: 'no id here' }, { id: 'https://s.example/c/1.0.0' }] }],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([{ criterion: 'https://s.example/c/1.0.0' }]);
  });

  it('omits conformityTopic when the topic array is empty or the entry has no id', () => {
    const subject = {
      referenceScheme: { id: 'https://s.example' },
      referenceProfile: { id: 'https://s.example/p/1.0.0' },
      conformityAssessment: [
        {
          assessmentCriteria: [
            { id: 'https://s.example/c/1.0.0', conformityTopic: [] },
            { id: 'https://s.example/c/2.0.0', conformityTopic: [{}] },
          ],
        },
      ],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([
      { criterion: 'https://s.example/c/1.0.0' },
      { criterion: 'https://s.example/c/2.0.0' },
    ]);
  });

  it('skips null assessment and null criterion entries from a malformed payload', () => {
    const subject = {
      referenceScheme: { id: 'https://s.example' },
      referenceProfile: { id: 'https://s.example/p/1.0.0' },
      conformityAssessment: [null, { assessmentCriteria: [null, { id: 'https://s.example/c/1.0.0' }] }],
    } as unknown as Record<string, unknown>;
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([{ criterion: 'https://s.example/c/1.0.0' }]);
  });

  it('returns null when the scheme reference is missing', () => {
    expect(extractDccConformityClaim({ referenceProfile: { id: 'https://s.example/p/1.0.0' } })).toBeNull();
  });

  it('returns null when the profile reference is missing', () => {
    expect(extractDccConformityClaim({ referenceScheme: { id: 'https://s.example' } })).toBeNull();
  });

  it('returns null for an empty subject', () => {
    expect(extractDccConformityClaim({})).toBeNull();
  });
});
