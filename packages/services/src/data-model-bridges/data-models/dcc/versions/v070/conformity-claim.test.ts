import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConformityScheme,
  validateConformityClaim as ValidateConformityClaim,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { extractDccConformityClaim } from './conformity-claim';

// Loaded from the untp-utils source at runtime rather than imported from the
// package entry: this package's Jest cannot parse untp-utils' ESM build
// (other suites mock the module wholesale), a static source import would
// drag foreign files into this package's tsc build, and the end-to-end test
// below exists precisely to run the real validator against the real
// extractor output. jest.requireActual keeps the path invisible to tsc while
// ts-jest compiles the source for the test run.
const { validateConformityClaim } = jest.requireActual(
  '../../../../../../../untp-utils/src/conformity-vocabulary/validate-conformity-claim.ts',
) as { validateConformityClaim: typeof ValidateConformityClaim };

// Published UNTP v0.7.0 sample instance, fetched verbatim from
// https://untp.unece.org/artefacts/samples/v0.7.0/dcc/ConformityCredential_instance.json
// so the extractor is anchored to an artefact the spec owners authored rather
// than to expectations mirrored from the implementation.
const officialSample = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'ConformityCredential_instance.json'), 'utf-8'),
) as { credentialSubject: Record<string, unknown> };

const GHG = 'https://vocabulary.uncefact.org/conformity-topic/greenhouse-gas-emissions';
const RENEWABLE = 'https://vocabulary.uncefact.org/conformity-topic/renewable-energy-use';
const FORCED_LABOUR = 'https://vocabulary.uncefact.org/conformity-topic/forced-labor-elimination';
const WATER = 'https://vocabulary.uncefact.org/conformity-topic/water-conservation';

describe('extractDccConformityClaim (v0.7.0)', () => {
  it('extracts the published sample instance with declarations kept at their own levels', () => {
    const claim = extractDccConformityClaim(officialSample.credentialSubject);

    expect(claim).toEqual({
      scheme: 'https://coppermark.org',
      profile: 'https://coppermark.org/rra/v3.0',
      criteria: [
        { criterion: 'https://coppermark.org/rra/v3.0/criterion/26', conformityTopics: [GHG] },
        { criterion: 'https://coppermark.org/rra/v3.0/criterion/27', conformityTopics: [RENEWABLE] },
        { criterion: 'https://coppermark.org/rra/v3.0/criterion/12', conformityTopics: [FORCED_LABOUR] },
        { criterion: 'https://coppermark.org/rra/v3.0/criterion/28', conformityTopics: [WATER] },
      ],
      assessments: [
        {
          // The assessment declares only the greenhouse-gas topic while
          // bundling a renewable-energy criterion; the extractor reports the
          // declaration verbatim rather than reconciling the two levels.
          criteria: ['https://coppermark.org/rra/v3.0/criterion/26', 'https://coppermark.org/rra/v3.0/criterion/27'],
          conformityTopics: [GHG],
        },
        { criteria: ['https://coppermark.org/rra/v3.0/criterion/12'], conformityTopics: [FORCED_LABOUR] },
        { criteria: ['https://coppermark.org/rra/v3.0/criterion/28'], conformityTopics: [WATER] },
      ],
    });
  });

  it('validates the published sample instance clean end to end against its scheme', () => {
    // Extraction and validation composed over the spec owners' sample must
    // produce zero warnings against a scheme projection publishing the profile
    // the sample references. This pins the happy path; the assessment
    // projection is asserted populated below so a regressed extractor that
    // stopped emitting assessments fails here rather than passing on an empty
    // result. The split-regression negative (the assessment check never
    // running) is pinned separately by the composition-negative test below.
    const criterion = (id: string, name: string, topic: string) => ({
      canonicalId: `https://coppermark.org/rra/v3.0/criterion/${id}`,
      name,
      version: '3.0',
      status: 'active',
      topics: [{ canonicalId: topic }],
      tags: [],
    });
    const coppermark: ConformityScheme = {
      canonicalId: 'https://coppermark.org',
      sourceUrl: 'https://coppermark.org',
      specVersion: '0.7.0',
      name: 'Coppermark',
      profiles: [
        {
          canonicalId: 'https://coppermark.org/rra/v3.0',
          name: 'Coppermark Responsible Risk Assessment (RRA) v3.0',
          version: '3.0',
          status: 'active',
          criteria: [
            criterion('26', 'GHG Emissions', GHG),
            criterion('27', 'Energy Use and Efficiency', RENEWABLE),
            criterion('12', 'Forced Labour', FORCED_LABOUR),
            criterion('28', 'Water Stewardship', WATER),
          ],
        },
      ],
    };

    const claim = extractDccConformityClaim(officialSample.credentialSubject);
    expect(claim).not.toBeNull();
    expect(claim!.assessments).toHaveLength(3);
    expect(validateConformityClaim(claim!, coppermark)).toEqual([]);
  });

  it('emits an inert entry for an empty assessment so positions track the source order', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      conformityAssessment: [{}, { assessmentCriteria: [{ id: 'https://example.com/s/c/1.0.0' }] }],
    };
    const claim = extractDccConformityClaim(subject);
    expect(claim?.criteria).toEqual([{ criterion: 'https://example.com/s/c/1.0.0' }]);
    expect(claim?.assessments).toEqual([
      { criteria: [], conformityTopics: [] },
      { criteria: ['https://example.com/s/c/1.0.0'], conformityTopics: [] },
    ]);
  });

  it('extracts a JSON null conformityTopic as absent', () => {
    // JSON-LD 1.1 drops null-valued entries at expansion, so a null
    // declaration means "no classification" and takes the same lenient path
    // as an omitted field (ADR-038), unlike a malformed non-null shape.
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      conformityAssessment: [{ assessmentCriteria: [{ id: 'https://example.com/s/c/1.0.0', conformityTopic: null }] }],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([{ criterion: 'https://example.com/s/c/1.0.0' }]);
  });

  it('emits every assessment criterion into the top-level criteria list (dual-emit invariant)', () => {
    // The validator's assessment guard assumes unresolved criterion URIs were
    // already surfaced from claim.criteria, so every assessments[].criteria
    // entry must also exist there (see ConformityClaimAssessment.criteria).
    const claim = extractDccConformityClaim(officialSample.credentialSubject);
    const criterionIds = new Set(claim?.criteria.map((c) => c.criterion));
    for (const assessment of claim?.assessments ?? []) {
      for (const id of assessment.criteria) {
        expect(criterionIds).toContain(id);
      }
    }
    expect(claim?.assessments?.length).toBeGreaterThan(0);
  });

  it('surfaces an assessment-level topic mismatch through extraction and validation composed', () => {
    // Composition negative: criterion topics absent (schema-authored shape),
    // assessment declares a topic its criterion does not publish. The clean
    // sample composition test alone would still pass if the assessment check
    // never ran, so this pins the negative through both layers.
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      referenceProfile: { id: 'https://example.com/scheme/p/1.0.0' },
      conformityAssessment: [
        {
          conformityTopic: [{ id: 'https://vocabulary.example.com/t/wrong' }],
          assessmentCriteria: [{ id: 'https://example.com/scheme/c/1.0.0' }],
        },
      ],
    };
    const scheme: ConformityScheme = {
      canonicalId: 'https://example.com/scheme',
      sourceUrl: 'https://example.com/scheme',
      specVersion: '0.7.0',
      name: 'Scheme',
      profiles: [
        {
          canonicalId: 'https://example.com/scheme/p/1.0.0',
          name: 'Profile',
          version: '1.0.0',
          status: 'active',
          criteria: [
            {
              canonicalId: 'https://example.com/scheme/c/1.0.0',
              name: 'Criterion',
              version: '1.0.0',
              status: 'active',
              topics: [{ canonicalId: 'https://vocabulary.example.com/t/right' }],
              tags: [],
            },
          ],
        },
      ],
    };

    const claim = extractDccConformityClaim(subject);
    const warnings = validateConformityClaim(claim!, scheme);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('conformity-assessment.topic-mismatch');
    expect(warnings[0].received).toBe('https://vocabulary.example.com/t/wrong');
    expect(warnings[0].pointer).toBe('/assessments/0/conformityTopics/0');
  });

  it('treats an empty-string referenceProfile id as absent', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      referenceProfile: { id: '' },
    };
    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://example.com/s',
      criteria: [],
    });
  });

  it('leaves criterion topics absent when only the assessment declares topics', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      referenceProfile: { id: 'https://example.com/scheme/rra/v3.0' },
      conformityAssessment: [
        {
          conformityTopic: [{ id: GHG }],
          assessmentCriteria: [
            { id: 'https://example.com/scheme/rra/v3.0/criterion/26' },
            { id: 'https://example.com/scheme/rra/v3.0/criterion/27' },
          ],
        },
      ],
    };

    const claim = extractDccConformityClaim(subject);
    expect(claim?.criteria).toEqual([
      { criterion: 'https://example.com/scheme/rra/v3.0/criterion/26' },
      { criterion: 'https://example.com/scheme/rra/v3.0/criterion/27' },
    ]);
    expect(claim?.criteria.every((c) => !('conformityTopics' in c))).toBe(true);
    expect(claim?.assessments).toEqual([
      {
        criteria: [
          'https://example.com/scheme/rra/v3.0/criterion/26',
          'https://example.com/scheme/rra/v3.0/criterion/27',
        ],
        conformityTopics: [GHG],
      },
    ]);
  });

  it('extracts a claim without a profile when referenceProfile is absent', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      conformityAssessment: [{ assessmentCriteria: [{ id: 'https://example.com/s/c/1.0.0' }] }],
    };

    expect(extractDccConformityClaim(subject)).toEqual({
      scheme: 'https://example.com/s',
      criteria: [{ criterion: 'https://example.com/s/c/1.0.0' }],
      assessments: [{ criteria: ['https://example.com/s/c/1.0.0'], conformityTopics: [] }],
    });
  });

  it('emits conformity-profile.not-specified through extraction and validation composed', () => {
    // Symmetric with the assessment-topic-mismatch composition negative: the
    // profile-absent advisory must fire through both layers, not just leave the
    // extractor result profile-less. The scheme resolves; the claim names no
    // profile, so criterion and topic checks are deliberately not performed.
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      conformityAssessment: [{ assessmentCriteria: [{ id: 'https://example.com/scheme/c/1.0.0' }] }],
    };
    const scheme: ConformityScheme = {
      canonicalId: 'https://example.com/scheme',
      sourceUrl: 'https://example.com/scheme',
      specVersion: '0.7.0',
      name: 'Scheme',
      profiles: [],
    };
    const claim = extractDccConformityClaim(subject);
    const warnings = validateConformityClaim(claim!, scheme);
    expect(warnings.map((w) => w.code)).toEqual(['conformity-profile.not-specified']);
  });

  it('captures a criterion topic authored as a single bare object rather than an array', () => {
    // The published schema puts no shape constraint on the criterion-level
    // conformityTopic, and the spec classifies a criterion by "a" topic
    // (singular), so a lone topic authored as a bare object is a conformant
    // declaration and must be captured, not dropped to an empty list (which
    // would trip a false-positive omission warning against a profile that
    // publishes that topic).
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      referenceProfile: { id: 'https://example.com/s/p/1.0.0' },
      conformityAssessment: [
        {
          assessmentCriteria: [
            { id: 'https://example.com/s/c/1.0.0', conformityTopic: { id: 'https://vocabulary.example.com/t/1.0.0' } },
          ],
        },
      ],
    };
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([
      { criterion: 'https://example.com/s/c/1.0.0', conformityTopics: ['https://vocabulary.example.com/t/1.0.0'] },
    ]);
  });

  it('extracts a malformed non-array conformityTopic as an empty declaration without throwing', () => {
    const subject = {
      referenceScheme: { id: 'https://example.com/s' },
      conformityAssessment: [
        {
          conformityTopic: 'environment.emissions',
          assessmentCriteria: [{ id: 'https://example.com/s/c/1.0.0', conformityTopic: 'environment.emissions' }],
        },
      ],
    };

    // A present but malformed declaration extracts as declared-empty (the
    // topic check runs) rather than absent (the check would be skipped), so
    // malformed input stays distinguishable from a data model that never
    // classifies criteria.
    const claim = extractDccConformityClaim(subject);
    expect(claim?.criteria).toEqual([{ criterion: 'https://example.com/s/c/1.0.0', conformityTopics: [] }]);
    expect(claim?.assessments).toEqual([{ criteria: ['https://example.com/s/c/1.0.0'], conformityTopics: [] }]);
  });

  it('surfaces no assessment warning for a malformed assessment-level topic (documented lenient gap)', () => {
    // A malformed (non-array, non-topic) assessment-level conformityTopic
    // extracts to an empty list, and the one-directional assessment check never
    // fires on an empty declaration, so a malformed assessment topic is
    // silently indistinguishable from a clean omission, unlike the criterion
    // level. Pinned so this ADR-038 tradeoff is visible and any change to it is
    // deliberate rather than incidental.
    const subject = {
      referenceScheme: { id: 'https://example.com/scheme' },
      referenceProfile: { id: 'https://example.com/scheme/p/1.0.0' },
      conformityAssessment: [
        {
          conformityTopic: 'not-an-array',
          assessmentCriteria: [{ id: 'https://example.com/scheme/c/1.0.0' }],
        },
      ],
    };
    const scheme: ConformityScheme = {
      canonicalId: 'https://example.com/scheme',
      sourceUrl: 'https://example.com/scheme',
      specVersion: '0.7.0',
      name: 'Scheme',
      profiles: [
        {
          canonicalId: 'https://example.com/scheme/p/1.0.0',
          name: 'Profile',
          version: '1.0.0',
          status: 'active',
          criteria: [
            {
              canonicalId: 'https://example.com/scheme/c/1.0.0',
              name: 'Criterion',
              version: '1.0.0',
              status: 'active',
              topics: [{ canonicalId: 'https://vocabulary.example.com/t/right' }],
              tags: [],
            },
          ],
        },
      ],
    };
    const claim = extractDccConformityClaim(subject);
    const warnings = validateConformityClaim(claim!, scheme);
    expect(warnings.some((w) => w.code === 'conformity-assessment.topic-mismatch')).toBe(false);
  });

  it('omits assessments when no assessment carries criteria or topics', () => {
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
    const claim = extractDccConformityClaim(subject);
    expect(claim?.criteria).toEqual([{ criterion: 'https://example.com/s/c/1.0.0' }]);
    expect(claim?.assessments).toEqual([{ criteria: ['https://example.com/s/c/1.0.0'], conformityTopics: [] }]);
  });

  it('collects declared topic ids and skips topic entries without an id', () => {
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
    expect(extractDccConformityClaim(subject)?.criteria).toEqual([{ criterion: 'https://example.com/s/c/1.0.0' }]);
  });

  it('returns null when the scheme reference is missing', () => {
    expect(extractDccConformityClaim({ referenceProfile: { id: 'https://example.com/s/p/1.0.0' } })).toBeNull();
  });

  it('returns null for an empty subject', () => {
    expect(extractDccConformityClaim({})).toBeNull();
  });
});
