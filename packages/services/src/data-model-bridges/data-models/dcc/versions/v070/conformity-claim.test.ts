import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConformityScheme,
  validateConformityClaim as ValidateConformityClaim,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { extractDccConformityClaim, extractDccConformityClaimWithProvenance } from './conformity-claim';
import { remapWarningPointers } from '../../../../../cvc/remap-warning-pointers';
import { makeBridge } from '../../../../make-bridge';
import { dccV070Spec } from './index';

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

describe('extractDccConformityClaimWithProvenance (v0.7.0)', () => {
  // Each assertion pairs a pointer the validator can emit with the subject
  // path the value was read from, which is the contract the credentials route
  // relies on to resolve a warning against the document its caller submitted.

  const subject = {
    referenceScheme: { id: 'https://example.com/s' },
    referenceProfile: { id: 'https://example.com/s/p/1.0.0' },
    conformityAssessment: [
      {
        conformityTopic: [{ id: 'https://example.com/t/a' }],
        assessmentCriteria: [
          { id: 'https://example.com/s/c/1/1.0.0', conformityTopic: [{}, { id: 'https://example.com/t/b' }] },
          { id: 'https://example.com/s/c/2/1.0.0', conformityTopic: { id: 'https://example.com/t/c' } },
        ],
      },
      {
        conformityTopic: [{ id: 'https://example.com/t/d' }],
        assessmentCriteria: [{ id: 'https://example.com/s/c/3/1.0.0' }],
      },
    ],
  };

  it('records the scheme and profile paths', () => {
    const { sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    expect(sourceMap['/scheme']).toBe('/referenceScheme/id');
    expect(sourceMap['/profile']).toBe('/referenceProfile/id');
  });

  it('records no profile path when the subject declares no profile', () => {
    // `/profile` is also the not-specified warning's pointer, and that warning
    // has no location in a document that omits the profile.
    const { sourceMap } = extractDccConformityClaimWithProvenance({
      referenceScheme: { id: 'https://example.com/s' },
    })!;

    expect(sourceMap).not.toHaveProperty('/profile');
  });

  it('maps a flattened criterion back to the assessment it came from', () => {
    const { claim, sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    // The third criterion is flattened onto the shared array from the second
    // assessment, which a prefix on the claim index could never recover.
    expect(claim.criteria[2].criterion).toBe('https://example.com/s/c/3/1.0.0');
    expect(sourceMap['/criteria/2/criterion']).toBe('/conformityAssessment/1/assessmentCriteria/0/id');
  });

  it('maps a criterion topic to its source index, skipping dropped entries', () => {
    const { claim, sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    // The id-less first entry is dropped, so claim index 0 is source index 1.
    expect(claim.criteria[0].conformityTopics).toEqual(['https://example.com/t/b']);
    expect(sourceMap['/criteria/0/conformityTopics/0']).toBe(
      '/conformityAssessment/0/assessmentCriteria/0/conformityTopic/1',
    );
  });

  it('maps a criterion topic authored as a bare object to the field itself', () => {
    const { sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    // A lone object is not an array, so there is no index to address.
    expect(sourceMap['/criteria/1/conformityTopics/0']).toBe(
      '/conformityAssessment/0/assessmentCriteria/1/conformityTopic',
    );
  });

  it('records the un-indexed topic pointer the omitted-topic warning uses', () => {
    const { sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    expect(sourceMap['/criteria/0/conformityTopics']).toBe(
      '/conformityAssessment/0/assessmentCriteria/0/conformityTopic',
    );
  });

  it('maps assessment topics to their own assessment', () => {
    const { sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    expect(sourceMap['/assessments/1/conformityTopics/0']).toBe('/conformityAssessment/1/conformityTopic/0');
  });

  it('is registered on the bridge the route resolves, not only exported', () => {
    // The route reaches this through getBridge -> makeBridge(dccV070Spec).
    // If the spec stopped registering the provenance extractor, every warning
    // pointer would be dropped in production and no other test would notice.
    const bridge = makeBridge(dccV070Spec);

    const extracted = bridge.extractConformityClaimWithProvenance(subject);

    expect(extracted).not.toBeNull();
    expect(Object.keys(extracted!.sourceMap).length).toBeGreaterThan(0);
    expect(extracted!.sourceMap['/scheme']).toBe('/referenceScheme/id');
  });

  it('records source paths that step over a skipped assessment and criterion', () => {
    // The claim-side index counts only what was kept, the source-side index
    // counts every entry the document has. Reusing one for the other is the
    // regression this pins, and it is invisible in the claim alone.
    const sparse = {
      referenceScheme: { id: 'https://example.com/s' },
      conformityAssessment: [null, { assessmentCriteria: [{ noId: true }, { id: 'https://example.com/s/c/9/1.0.0' }] }],
    };

    const { claim, sourceMap } = extractDccConformityClaimWithProvenance(sparse)!;

    expect(claim.criteria).toEqual([{ criterion: 'https://example.com/s/c/9/1.0.0' }]);
    expect(sourceMap['/criteria/0/criterion']).toBe('/conformityAssessment/1/assessmentCriteria/1/id');
    expect(sourceMap['/assessments/0/conformityTopics']).toBe('/conformityAssessment/1/conformityTopic');
  });

  it('returns null on the same terms as the plain extractor', () => {
    expect(extractDccConformityClaimWithProvenance({})).toBeNull();
  });

  it('records a path for every pointer the validator can emit against this claim', () => {
    // Guards the silent failure mode: a projected value with no recorded path
    // loses its pointer at the route, and nothing else would report that.
    const { claim, sourceMap } = extractDccConformityClaimWithProvenance(subject)!;

    const expected = ['/scheme', '/profile'];
    claim.criteria.forEach((criterion, index) => {
      expected.push(`/criteria/${index}/criterion`);
      criterion.conformityTopics?.forEach((_topic, position) => {
        expected.push(`/criteria/${index}/conformityTopics`, `/criteria/${index}/conformityTopics/${position}`);
      });
    });
    claim.assessments?.forEach((assessment, index) => {
      assessment.conformityTopics.forEach((_topic, position) => {
        expected.push(`/assessments/${index}/conformityTopics`, `/assessments/${index}/conformityTopics/${position}`);
      });
    });

    expect(Object.keys(sourceMap)).toEqual(expect.arrayContaining(expected));
  });

  describe('composed with the real validator and the real remap', () => {
    // The assertions above check the map against pointers written out by hand.
    // These drive the actual validator over the actual projection instead, so
    // a pointer shape the extractor fails to record is caught here rather than
    // silently dropped at the route: the remap fails closed, so an unmapped
    // pointer disappears with no error and the feature would look like it
    // worked while doing nothing.

    // Emitted where the warning's subject is absent from the document, so
    // there is deliberately no source path: a criterion the claim never
    // declared, and a profile it never specified.
    const UNMAPPABLE = ['/criteria', '/profile'];

    const SCHEME_URI = 'https://example.com/s';
    const PROFILE_URI = 'https://example.com/s/p/1.0.0';
    const DEFINED = 'https://example.com/t/defined';
    const WRONG = 'https://example.com/t/wrong';

    const publishedCriterion = (id: string, name: string) => ({
      canonicalId: id,
      name,
      version: '1.0.0',
      status: 'active',
      topics: [{ canonicalId: DEFINED }],
      tags: [],
    });

    const scheme: ConformityScheme = {
      canonicalId: SCHEME_URI,
      sourceUrl: SCHEME_URI,
      specVersion: '0.7.0',
      name: 'Example',
      profiles: [
        {
          canonicalId: PROFILE_URI,
          name: 'Example profile',
          version: '1.0.0',
          status: 'active',
          criteria: [
            publishedCriterion('https://example.com/s/c/1/1.0.0', 'Claimed criterion'),
            publishedCriterion('https://example.com/s/c/2/1.0.0', 'Criterion the claim omits'),
          ],
        },
      ],
    };

    // Engineered to trigger the criterion, topic and assessment warnings at
    // once: an unpublished criterion, a published one the claim omits, a
    // criterion topic wrong in both directions, and an assessment topic
    // outside its criteria's union. The assessment check is skipped where an
    // unresolved criterion sits in the same assessment, so the second
    // assessment carries only resolvable criteria. It repeats criterion 1,
    // which also puts the same URI at two claim positions, the case a
    // URI-based reverse lookup could not tell apart.
    const composedSubject = {
      referenceScheme: { id: SCHEME_URI },
      referenceProfile: { id: PROFILE_URI },
      conformityAssessment: [
        {
          conformityTopic: [{ id: DEFINED }],
          assessmentCriteria: [
            { id: 'https://example.com/s/c/1/1.0.0', conformityTopic: [{}, { id: WRONG }] },
            { id: 'https://example.com/s/c/unknown/1.0.0' },
          ],
        },
        {
          conformityTopic: [{ id: WRONG }],
          assessmentCriteria: [{ id: 'https://example.com/s/c/1/1.0.0' }],
        },
      ],
    };
    const document = { credentialSubject: composedSubject };

    it('emits the warnings this fixture is built to trigger', () => {
      const extracted = extractDccConformityClaimWithProvenance(composedSubject)!;
      const codes = validateConformityClaim(extracted.claim, scheme).map((w) => w.code);

      expect(codes).toEqual(
        expect.arrayContaining([
          'conformity-criterion.not-in-profile',
          'conformity-criterion.missing',
          'conformity-criterion.topic-mismatch',
          'conformity-assessment.topic-mismatch',
        ]),
      );
    });

    it('records a source path for every emitted pointer bar the two with no location', () => {
      const extracted = extractDccConformityClaimWithProvenance(composedSubject)!;
      const emitted = validateConformityClaim(extracted.claim, scheme)
        .map((w) => w.pointer)
        .filter((pointer): pointer is string => pointer !== undefined);

      expect(emitted.length).toBeGreaterThan(0);
      expect(emitted.filter((p) => !UNMAPPABLE.includes(p) && extracted.sourceMap[p] === undefined)).toEqual([]);
    });

    it('rewrites every recorded pointer onto a path that resolves in the credential', () => {
      const extracted = extractDccConformityClaimWithProvenance(composedSubject)!;
      const warnings = validateConformityClaim(extracted.claim, scheme);

      const remapped = remapWarningPointers(warnings, extracted.sourceMap, document, '/credentialSubject');

      // Pinned exactly rather than by prefix: a map entry that resolved to the
      // wrong existing node would satisfy a prefix check while still telling
      // the caller to look in the wrong place.
      const byCode = new Map(remapped.map((w) => [`${w.code}:${w.pointer ?? ''}`, w.pointer]));
      expect([...byCode.values()].filter((p) => p !== undefined).sort()).toEqual([
        '/credentialSubject/conformityAssessment/0/assessmentCriteria/0/conformityTopic',
        '/credentialSubject/conformityAssessment/0/assessmentCriteria/0/conformityTopic/1',
        '/credentialSubject/conformityAssessment/0/assessmentCriteria/1/id',
        '/credentialSubject/conformityAssessment/1/conformityTopic/0',
      ]);

      remapped.forEach((warning, index) => {
        const original = warnings[index].pointer;
        if (original === undefined || UNMAPPABLE.includes(original)) {
          expect(warning.pointer).toBeUndefined();
        }
      });
    });

    it('drops the pointer on a profile the credential never specified', () => {
      const subject = { referenceScheme: { id: SCHEME_URI } };
      const extracted = extractDccConformityClaimWithProvenance(subject)!;
      const notSpecified = validateConformityClaim(extracted.claim, scheme).find(
        (w) => w.code === 'conformity-profile.not-specified',
      );

      expect(notSpecified?.pointer).toBe('/profile');
      const [remapped] = remapWarningPointers(
        [notSpecified!],
        extracted.sourceMap,
        { credentialSubject: subject },
        '/credentialSubject',
      );
      expect(remapped).not.toHaveProperty('pointer');
    });

    it('rewrites the profile pointer when the scheme does not publish that profile', () => {
      // The other `/profile` case (none specified) has no source location and
      // is asserted above; this one does, so it must survive the remap.
      const subject = {
        referenceScheme: { id: SCHEME_URI },
        referenceProfile: { id: 'https://example.com/s/p/absent/1.0.0' },
        conformityAssessment: [{ assessmentCriteria: [{ id: 'https://example.com/s/c/1/1.0.0' }] }],
      };
      const extracted = extractDccConformityClaimWithProvenance(subject)!;
      const warnings = validateConformityClaim(extracted.claim, scheme);

      const remapped = remapWarningPointers(
        warnings,
        extracted.sourceMap,
        { credentialSubject: subject },
        '/credentialSubject',
      );

      const notFound = remapped.find((w) => w.code === 'conformity-profile.not-found');
      expect(notFound?.pointer).toBe('/credentialSubject/referenceProfile/id');
    });

    it('rewrites the scheme pointer when the catalogue does not know the scheme', () => {
      const extracted = extractDccConformityClaimWithProvenance(composedSubject)!;
      const warnings = validateConformityClaim(extracted.claim, null);

      const [remapped] = remapWarningPointers(warnings, extracted.sourceMap, document, '/credentialSubject');

      expect(warnings[0].code).toBe('conformity-scheme.not-found');
      expect(remapped.pointer).toBe('/credentialSubject/referenceScheme/id');
    });
  });
});
