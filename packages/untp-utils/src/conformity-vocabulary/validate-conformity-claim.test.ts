import { ConformityWarningCode } from './codes.js';
import type { ConformityClaim, ConformityScheme } from './types.js';
import { validateConformityClaim } from './validate-conformity-claim.js';

const SCHEME_URI = 'https://example.com/scheme';
const PROFILE_URI = 'https://example.com/scheme/full/1.0.0';
const CRITERION_A = 'https://example.com/criterion/a/1.0.0';
const CRITERION_B = 'https://example.com/criterion/b/1.0.0';
const TOPIC_A1 = 'https://vocabulary.example.com/conformity-topics/a-1';
const TOPIC_A2 = 'https://vocabulary.example.com/conformity-topics/a-2';

function scheme(): ConformityScheme {
  return {
    canonicalId: SCHEME_URI,
    sourceUrl: SCHEME_URI,
    specVersion: '0.7.0',
    name: 'Test Scheme',
    profiles: [
      {
        canonicalId: PROFILE_URI,
        name: 'Full',
        version: '1.0.0',
        status: 'active',
        criteria: [
          {
            canonicalId: CRITERION_A,
            name: 'A',
            version: '1.0.0',
            status: 'active',
            topics: [{ canonicalId: TOPIC_A1 }, { canonicalId: TOPIC_A2 }],
            tags: [],
          },
          {
            canonicalId: CRITERION_B,
            name: 'B',
            version: '1.0.0',
            status: 'active',
            topics: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

function scoringFramework(codes: string[]) {
  return { name: 'Test framework', scores: codes.map((code) => ({ code })) };
}

function scoredScheme(
  options: {
    schemeCodes?: string[];
    profileCodes?: string[];
    criterionCodes?: string[];
  } = {},
): ConformityScheme {
  const base = scheme();
  const profile = base.profiles[0];
  return {
    ...base,
    ...(options.schemeCodes && { scoringFramework: scoringFramework(options.schemeCodes) }),
    profiles: [
      {
        ...profile,
        ...(options.profileCodes && { criterionScoringFrameworks: [scoringFramework(options.profileCodes)] }),
        criteria: profile.criteria.map((criterion, index) =>
          index === 0 && options.criterionCodes
            ? { ...criterion, requiredPerformance: options.criterionCodes.map((code) => ({ score: { code } })) }
            : criterion,
        ),
      },
    ],
  };
}

describe('validateConformityClaim', () => {
  it('returns an empty array when the claim matches the scheme exactly', () => {
    const claim: ConformityClaim = {
      scheme: SCHEME_URI,
      profile: PROFILE_URI,
      criteria: [
        { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
        { criterion: CRITERION_B, conformityTopics: [] },
      ],
    };
    expect(validateConformityClaim(claim, scheme())).toEqual([]);
  });

  describe('assessment-topic-mismatch', () => {
    it("accepts an assessment declaring a subset of its criteria's published topics", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
        assessments: [{ criteria: [CRITERION_A, CRITERION_B], conformityTopics: [TOPIC_A1] }],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });

    it('warns when an assessment declares a topic none of its criteria define', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
        assessments: [
          { criteria: [CRITERION_A], conformityTopics: ['https://vocabulary.example.com/conformity-topics/other'] },
        ],
      };
      const warnings = validateConformityClaim(claim, scheme());
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(ConformityWarningCode.AssessmentTopicMismatch);
      expect(warnings[0].message).toContain(PROFILE_URI);
      expect(warnings[0].received).toBe('https://vocabulary.example.com/conformity-topics/other');
      expect(warnings[0].expected).toEqual([TOPIC_A1, TOPIC_A2]);
      expect(warnings[0].pointer).toBe('/assessments/0/conformityTopics/0');
    });

    it("builds the union from the profile's published topics, not the claim's declared ones", () => {
      // Criterion A's claim entry declares a topic the profile does not
      // publish for it; the assessment declares that same unpublished topic.
      // The assessment check must warn (the union comes from the profile),
      // even though the claim's own criterion declarations contain the topic.
      const unpublished = 'https://vocabulary.example.com/conformity-topics/unpublished';
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2, unpublished] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
        assessments: [{ criteria: [CRITERION_A], conformityTopics: [unpublished] }],
      };
      const assessmentWarnings = validateConformityClaim(claim, scheme()).filter(
        (w) => w.code === ConformityWarningCode.AssessmentTopicMismatch,
      );
      expect(assessmentWarnings).toHaveLength(1);
      expect(assessmentWarnings[0].received).toBe(unpublished);
      expect(assessmentWarnings[0].expected).toEqual([TOPIC_A1, TOPIC_A2]);
    });

    it('fires for every mismatching assessment with per-assessment pointers (no short-circuit)', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
        assessments: [
          { criteria: [CRITERION_A], conformityTopics: ['https://vocabulary.example.com/conformity-topics/x'] },
          { criteria: [CRITERION_B], conformityTopics: ['https://vocabulary.example.com/conformity-topics/y'] },
        ],
      };
      const warnings = validateConformityClaim(claim, scheme()).filter(
        (w) => w.code === ConformityWarningCode.AssessmentTopicMismatch,
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0].pointer).toBe('/assessments/0/conformityTopics/0');
      expect(warnings[1].pointer).toBe('/assessments/1/conformityTopics/0');
    });

    it('passes over an assessment that references no criteria (parent-level topic is its only classification)', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
        assessments: [{ criteria: [], conformityTopics: ['https://vocabulary.example.com/conformity-topics/other'] }],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });

    it('passes over an assessment when any referenced criterion does not resolve in the profile', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
          { criterion: 'https://example.com/criterion/unknown/1.0.0' },
        ],
        assessments: [
          {
            criteria: [CRITERION_A, 'https://example.com/criterion/unknown/1.0.0'],
            conformityTopics: ['https://vocabulary.example.com/conformity-topics/other'],
          },
        ],
      };
      const warnings = validateConformityClaim(claim, scheme());
      const codes = warnings.map((w) => w.code);
      expect(codes).toContain(ConformityWarningCode.CriterionNotInProfile);
      expect(codes).not.toContain(ConformityWarningCode.AssessmentTopicMismatch);
    });

    it('deduplicates a topic two referenced criteria both publish in the reported union', () => {
      // Two criteria publishing an overlapping topic must contribute it once to
      // the `expected` union, so the diagnostic is not polluted with duplicates.
      const SHARED = 'https://vocabulary.example.com/conformity-topics/shared';
      const ONLY_A = 'https://vocabulary.example.com/conformity-topics/only-a';
      const ONLY_C = 'https://vocabulary.example.com/conformity-topics/only-c';
      const CRITERION_C = 'https://example.com/criterion/c/1.0.0';
      const dedupScheme: ConformityScheme = {
        canonicalId: SCHEME_URI,
        sourceUrl: SCHEME_URI,
        specVersion: '0.7.0',
        name: 'Test Scheme',
        profiles: [
          {
            canonicalId: PROFILE_URI,
            name: 'Full',
            version: '1.0.0',
            status: 'active',
            criteria: [
              {
                canonicalId: CRITERION_A,
                name: 'A',
                version: '1.0.0',
                status: 'active',
                topics: [{ canonicalId: SHARED }, { canonicalId: ONLY_A }],
                tags: [],
              },
              {
                canonicalId: CRITERION_C,
                name: 'C',
                version: '1.0.0',
                status: 'active',
                topics: [{ canonicalId: SHARED }, { canonicalId: ONLY_C }],
                tags: [],
              },
            ],
          },
        ],
      };
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [SHARED, ONLY_A] },
          { criterion: CRITERION_C, conformityTopics: [SHARED, ONLY_C] },
        ],
        assessments: [
          {
            criteria: [CRITERION_A, CRITERION_C],
            conformityTopics: ['https://vocabulary.example.com/conformity-topics/outside'],
          },
        ],
      };
      const warnings = validateConformityClaim(claim, dedupScheme).filter(
        (w) => w.code === ConformityWarningCode.AssessmentTopicMismatch,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].expected).toEqual([SHARED, ONLY_A, ONLY_C]);
    });
  });

  describe('profile absent on the claim', () => {
    it('reports profile-not-specified and skips criterion checks when the scheme is known', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        criteria: [{ criterion: 'https://example.com/criterion/unknown/1.0.0', conformityTopics: [] }],
      };
      const warnings = validateConformityClaim(claim, scheme());
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(ConformityWarningCode.ProfileNotSpecified);
      expect(warnings[0].pointer).toBe('/profile');
    });

    it('still reports scheme-not-found when the scheme is unknown', () => {
      const claim: ConformityClaim = { scheme: 'https://example.com/other-scheme', criteria: [] };
      const warnings = validateConformityClaim(claim, scheme());
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(ConformityWarningCode.SchemeNotFound);
    });
  });

  describe('score membership', () => {
    it('warns when the profile score is not in the scheme framework', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        profileScore: { code: 'PROFILE-UNKNOWN' },
        criteria: [],
      };
      const [warning] = validateConformityClaim(claim, scoredScheme({ schemeCodes: ['A', 'B'] }));
      expect(warning).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.AttestationScoreNotInFramework,
          received: 'PROFILE-UNKNOWN',
          expected: ['A', 'B'],
          pointer: '/profileScore/code',
        }),
      );
    });

    it('accepts a profile score code published by the scheme framework', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        profileScore: { code: 'A' },
        criteria: [],
      };
      const warnings = validateConformityClaim(claim, scoredScheme({ schemeCodes: ['A'] }));
      expect(warnings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: ConformityWarningCode.AttestationScoreNotInFramework,
          }),
        ]),
      );
    });

    it('warns on a performance score outside the ordered union of published frameworks', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A }],
        assessments: [
          {
            criteria: [CRITERION_A],
            conformityTopics: [],
            assessedScores: [{ code: 'X' }, { code: 'UNKNOWN' }],
          },
        ],
      };
      const warnings = validateConformityClaim(
        claim,
        scoredScheme({ schemeCodes: ['A', 'B'], profileCodes: ['X', 'Y'], criterionCodes: ['R'] }),
      ).filter((warning) => warning.code === ConformityWarningCode.AssessmentScoreNotInFramework);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toEqual(
        expect.objectContaining({
          received: 'UNKNOWN',
          expected: ['A', 'B', 'X', 'Y', 'R'],
          message:
            'Assessment score code is not published by the scheme, profile or referenced-criterion frameworks that apply to profile https://example.com/scheme/full/1.0.0.',
          pointer: '/assessments/0/assessedScores/1/code',
        }),
      );
    });

    it('accepts a performance code from any applicable framework, including the referenced criterion', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A }],
        assessments: [{ criteria: [CRITERION_A], conformityTopics: [], assessedScores: [{ code: 'R' }] }],
      };
      expect(
        validateConformityClaim(
          claim,
          scoredScheme({ schemeCodes: ['A'], profileCodes: ['B'], criterionCodes: ['R'] }),
        ).filter((warning) => warning.code === ConformityWarningCode.AssessmentScoreNotInFramework),
      ).toEqual([]);
    });

    it('does not use an unreferenced criterion framework for an assessment score', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_B }],
        assessments: [{ criteria: [CRITERION_B], conformityTopics: [], assessedScores: [{ code: 'R' }] }],
      };
      const warnings = validateConformityClaim(
        claim,
        scoredScheme({ schemeCodes: ['Q'], criterionCodes: ['R'] }),
      ).filter((warning) => warning.code === ConformityWarningCode.AssessmentScoreNotInFramework);
      expect(warnings).toEqual([
        expect.objectContaining({
          received: 'R',
          expected: ['Q'],
          pointer: '/assessments/0/assessedScores/0/code',
        }),
      ]);
    });

    it('checks the profile score without a profile and says performance scores were not checked', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profileScore: { code: 'UNKNOWN' },
        criteria: [],
        assessments: [{ criteria: [], conformityTopics: [], assessedScores: [{ code: 'UNKNOWN' }] }],
      };
      const warnings = validateConformityClaim(claim, scoredScheme({ schemeCodes: ['A'], profileCodes: ['B'] }));
      expect(warnings.map((warning) => warning.code)).toEqual([
        ConformityWarningCode.AttestationScoreNotInFramework,
        ConformityWarningCode.ProfileNotSpecified,
      ]);
      expect(warnings[1].message).toContain('performance scores were not checked');
      expect(warnings.some((warning) => warning.code === ConformityWarningCode.AssessmentScoreNotInFramework)).toBe(
        false,
      );
    });

    it('skips score checks when all published lists are empty', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        profileScore: { code: 'A' },
        criteria: [{ criterion: CRITERION_A }],
        assessments: [{ criteria: [CRITERION_A], conformityTopics: [], assessedScores: [{ code: 'A' }] }],
      };
      const warnings = validateConformityClaim(
        claim,
        scoredScheme({ schemeCodes: [], profileCodes: [], criterionCodes: [] }),
      );
      expect(warnings.some((warning) => warning.code.endsWith('score-not-in-framework'))).toBe(false);
    });

    it('suppresses an assessment score warning when any referenced criterion is unresolved', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A }, { criterion: 'https://example.com/criterion/unknown/1.0.0' }],
        assessments: [
          {
            criteria: [CRITERION_A, 'https://example.com/criterion/unknown/1.0.0'],
            conformityTopics: [],
            assessedScores: [{ code: 'UNKNOWN' }],
          },
        ],
      };
      const warnings = validateConformityClaim(claim, scoredScheme({ schemeCodes: ['A'] }));
      expect(warnings.map((warning) => warning.code)).toContain(ConformityWarningCode.CriterionNotInProfile);
      expect(warnings.map((warning) => warning.code)).not.toContain(
        ConformityWarningCode.AssessmentScoreNotInFramework,
      );
    });

    it('checks an assessment with no criteria against the scheme and profile frameworks', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [],
        assessments: [{ criteria: [], conformityTopics: [], assessedScores: [{ code: 'Q' }] }],
      };
      const warning = validateConformityClaim(
        claim,
        scoredScheme({ schemeCodes: ['A', 'B'], profileCodes: ['X'] }),
      ).find((candidate) => candidate.code === ConformityWarningCode.AssessmentScoreNotInFramework);
      expect(warning).toEqual(
        expect.objectContaining({
          received: 'Q',
          expected: ['A', 'B', 'X'],
          pointer: '/assessments/0/assessedScores/0/code',
        }),
      );
    });

    it('compares score codes exactly, preserving empty and whitespace codes', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        profileScore: { code: '  AA  ' },
        criteria: [],
      };
      const scored = scoredScheme({ schemeCodes: ['', '  AA  '] });
      expect(
        validateConformityClaim(claim, scored).some(
          (warning) => warning.code === ConformityWarningCode.AttestationScoreNotInFramework,
        ),
      ).toBe(false);
      const mismatch = validateConformityClaim({ ...claim, profileScore: { code: 'AA' } }, scored).find(
        (warning) => warning.code === ConformityWarningCode.AttestationScoreNotInFramework,
      );
      expect(mismatch).toEqual(expect.objectContaining({ received: 'AA', expected: ['', '  AA  '] }));
    });

    it('checks a profile score only against the scheme framework', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        profileScore: { code: 'X' },
        criteria: [],
      };
      const [warning] = validateConformityClaim(
        claim,
        scoredScheme({ schemeCodes: ['A', 'B'], profileCodes: ['X', 'Y'] }),
      );
      expect(warning).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.AttestationScoreNotInFramework,
          received: 'X',
          expected: ['A', 'B'],
          pointer: '/profileScore/code',
        }),
      );
    });
  });

  describe('catalogue tier diagnosis', () => {
    it('reports a profile id used as a scheme id with the owning scheme', () => {
      const claim: ConformityClaim = { scheme: 'https://scheme.example/profile/1.0.0', criteria: [] };
      const warnings = validateConformityClaim(claim, null, {
        scheme: [{ tier: 'profile', schemes: [SCHEME_URI] }],
      });
      expect(warnings).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.SchemeWrongTier,
          received: claim.scheme,
          expected: [SCHEME_URI],
          pointer: '/scheme',
          message: `The referenced id is a profile, not a scheme; it belongs to scheme ${SCHEME_URI}.`,
        }),
      ]);
    });

    it('keeps scheme-not-found when the resolver also found the expected tier', () => {
      const claim: ConformityClaim = { scheme: SCHEME_URI, profile: PROFILE_URI, criteria: [] };
      const warnings = validateConformityClaim(claim, null, {
        scheme: [
          { tier: 'scheme', schemes: [SCHEME_URI] },
          { tier: 'profile', schemes: [SCHEME_URI] },
        ],
      });
      expect(warnings[0].code).toBe(ConformityWarningCode.SchemeNotFound);
    });

    it('reports scheme and criterion ids used as a profile id at the wrong tier', () => {
      const expectedProfiles = [PROFILE_URI];
      const schemeWarning = validateConformityClaim(
        { scheme: SCHEME_URI, profile: SCHEME_URI, criteria: [] },
        scheme(),
        { profile: [{ tier: 'scheme', schemes: [SCHEME_URI] }] },
      )[0];
      const criterionWarning = validateConformityClaim(
        { scheme: SCHEME_URI, profile: CRITERION_A, criteria: [] },
        scheme(),
        { profile: [{ tier: 'criterion', schemes: [SCHEME_URI], profiles: [PROFILE_URI] }] },
      )[0];
      expect(schemeWarning).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.ProfileWrongTier,
          received: SCHEME_URI,
          expected: expectedProfiles,
          message: expect.stringContaining('scheme'),
        }),
      );
      expect(criterionWarning).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.ProfileWrongTier,
          received: CRITERION_A,
          expected: expectedProfiles,
          message: expect.stringContaining('criterion'),
        }),
      );
    });

    it('keeps a profile-not-found warning and names another scheme for a mixed match', () => {
      const warnings = validateConformityClaim(
        { scheme: SCHEME_URI, profile: 'https://other.example/profile/1.0.0', criteria: [] },
        scheme(),
        {
          profile: [
            { tier: 'scheme', schemes: ['https://other.example'] },
            { tier: 'profile', schemes: ['https://other.example'] },
          ],
        },
      );
      expect(warnings[0]).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.ProfileNotFound,
          message: expect.stringContaining('https://other.example'),
        }),
      );
    });

    it('does not diagnose an orphan criterion as a wrong-tier scheme', () => {
      const warnings = validateConformityClaim({ scheme: 'https://example.com/orphan-criterion', criteria: [] }, null, {
        scheme: [{ tier: 'criterion', schemes: [], profiles: [PROFILE_URI] }],
      });
      expect(warnings[0]).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.SchemeNotFound,
          received: 'https://example.com/orphan-criterion',
        }),
      );
    });

    it('does not diagnose an orphan criterion as a wrong-tier profile', () => {
      const warnings = validateConformityClaim(
        { scheme: SCHEME_URI, profile: 'https://example.com/orphan-criterion', criteria: [] },
        scheme(),
        { profile: [{ tier: 'criterion', schemes: [], profiles: [PROFILE_URI] }] },
      );
      expect(warnings[0]).toEqual(
        expect.objectContaining({
          code: ConformityWarningCode.ProfileNotFound,
          received: 'https://example.com/orphan-criterion',
          expected: [PROFILE_URI],
        }),
      );
    });

    it('uses the complete wrong-tier messages for scheme and criterion profile references', () => {
      const schemeWarning = validateConformityClaim(
        { scheme: SCHEME_URI, profile: SCHEME_URI, criteria: [] },
        scheme(),
        { profile: [{ tier: 'scheme', schemes: [SCHEME_URI] }] },
      )[0];
      const criterionWarning = validateConformityClaim(
        { scheme: SCHEME_URI, profile: CRITERION_A, criteria: [] },
        scheme(),
        { profile: [{ tier: 'criterion', schemes: [SCHEME_URI], profiles: [PROFILE_URI] }] },
      )[0];
      expect(schemeWarning.message).toBe('The referenced id is a scheme, not a profile in the selected scheme.');
      expect(criterionWarning.message).toBe(
        `The referenced id is a criterion of profile ${PROFILE_URI} in scheme ${SCHEME_URI}, not a profile in the selected scheme.`,
      );
    });

    it('does not diagnose an empty scheme match as a wrong tier', () => {
      const warnings = validateConformityClaim({ scheme: SCHEME_URI, criteria: [] }, null, { scheme: [] });
      expect(warnings[0].code).toBe(ConformityWarningCode.SchemeNotFound);
    });
  });

  describe('scheme-not-found', () => {
    it('fires when the scheme is null', () => {
      const claim: ConformityClaim = { scheme: SCHEME_URI, profile: PROFILE_URI, criteria: [] };
      expect(validateConformityClaim(claim, null)).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.SchemeNotFound,
          received: SCHEME_URI,
          pointer: '/scheme',
        }),
      ]);
    });

    it("fires when the scheme's canonicalId doesn't match the claim", () => {
      const wrongScheme: ConformityScheme = { ...scheme(), canonicalId: 'https://other.example/scheme' };
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] }],
      };
      const warnings = validateConformityClaim(claim, wrongScheme);
      expect(warnings.map((w) => w.code)).toEqual([ConformityWarningCode.SchemeNotFound]);
    });

    it('short-circuits: no profile or criterion checks run', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: 'https://example.com/scheme/does-not-exist/9.9.9',
        criteria: [{ criterion: 'https://example.com/criterion/does-not-exist/9.9.9', conformityTopics: [] }],
      };
      const warnings = validateConformityClaim(claim, null);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe(ConformityWarningCode.SchemeNotFound);
    });
  });

  describe('profile-not-found', () => {
    it("fires when the claim's profile URI is not among the scheme's profiles", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: 'https://example.com/scheme/other/2.0.0',
        criteria: [{ criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] }],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.ProfileNotFound,
          received: 'https://example.com/scheme/other/2.0.0',
          expected: [PROFILE_URI],
          pointer: '/profile',
        }),
      ]);
    });

    it('short-circuits: criterion checks do not run', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: 'https://example.com/scheme/other/2.0.0',
        criteria: [
          { criterion: 'https://example.com/criterion/unknown/1.0.0', conformityTopics: [] },
          { criterion: CRITERION_A, conformityTopics: ['https://vocabulary.example.com/topics/unknown'] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toHaveLength(1);
    });
  });

  describe('criterion-not-in-profile', () => {
    it("fires when a claim's criterion URI is not in the profile's published criteria", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
          { criterion: 'https://example.com/criterion/unknown/1.0.0', conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionNotInProfile,
          message: expect.stringContaining(PROFILE_URI),
          received: 'https://example.com/criterion/unknown/1.0.0',
          expected: [CRITERION_A, CRITERION_B],
          pointer: '/criteria/2/criterion',
        }),
      ]);
    });

    it('does not run topic checks for a criterion that is not in the profile', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
          {
            criterion: 'https://example.com/criterion/unknown/1.0.0',
            conformityTopics: ['https://vocabulary.example.com/topics/unknown'],
          },
        ],
      };
      const codes = validateConformityClaim(claim, scheme()).map((w) => w.code);
      expect(codes).toContain(ConformityWarningCode.CriterionNotInProfile);
      expect(codes).not.toContain(ConformityWarningCode.CriterionTopicMismatch);
    });
  });

  describe('criterion-missing', () => {
    it('fires when the profile publishes a criterion the claim does not address', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] }],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionMissing,
          message: expect.stringContaining(PROFILE_URI),
          expected: CRITERION_B,
          pointer: '/criteria',
        }),
      ]);
    });

    it('fires for every missing criterion (no short-circuit)', () => {
      const claim: ConformityClaim = { scheme: SCHEME_URI, profile: PROFILE_URI, criteria: [] };
      const missingExpected = validateConformityClaim(claim, scheme())
        .filter((w) => w.code === ConformityWarningCode.CriterionMissing)
        .map((w) => w.expected);
      expect(missingExpected).toEqual([CRITERION_A, CRITERION_B]);
    });
  });

  describe('criterion-topic-mismatch', () => {
    it('fires when the claim omits a topic the profile publishes for the criterion', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionTopicMismatch,
          message: expect.stringContaining(PROFILE_URI),
          expected: TOPIC_A2,
          pointer: '/criteria/0/conformityTopics',
        }),
      ]);
    });

    it('fires for every published topic when the claim declares none', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      const mismatchExpected = validateConformityClaim(claim, scheme())
        .filter((w) => w.code === ConformityWarningCode.CriterionTopicMismatch)
        .map((w) => w.expected);
      expect(mismatchExpected).toEqual([TOPIC_A1, TOPIC_A2]);
    });

    it('fires when the claim declares a topic the profile does not publish', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          {
            criterion: CRITERION_A,
            conformityTopics: [TOPIC_A1, TOPIC_A2, 'https://vocabulary.example.com/topics/wrong'],
          },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionTopicMismatch,
          message: expect.stringContaining(PROFILE_URI),
          received: 'https://vocabulary.example.com/topics/wrong',
          expected: [TOPIC_A1, TOPIC_A2],
          pointer: '/criteria/0/conformityTopics/2',
        }),
      ]);
    });

    it('does not fire when the declared topics exactly match the published topics', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, TOPIC_A2] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });

    it('matches the topic set regardless of order', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A2, TOPIC_A1] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });

    it('flags both an omitted and an unexpected topic on the same criterion', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: [TOPIC_A1, 'https://vocabulary.example.com/topics/wrong'] },
          { criterion: CRITERION_B, conformityTopics: [] },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionTopicMismatch,
          expected: TOPIC_A2,
          pointer: '/criteria/0/conformityTopics',
        }),
        expect.objectContaining({
          code: ConformityWarningCode.CriterionTopicMismatch,
          received: 'https://vocabulary.example.com/topics/wrong',
          pointer: '/criteria/0/conformityTopics/1',
        }),
      ]);
    });

    it('does not run when the claim carries no topic list (version that does not model topics)', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A }, { criterion: CRITERION_B }],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });

    it('treats a runtime null topic list like an absent one and runs no topic check', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopics: null as unknown as string[] },
          { criterion: CRITERION_B },
        ],
      };
      expect(validateConformityClaim(claim, scheme())).toEqual([]);
    });
  });
});
