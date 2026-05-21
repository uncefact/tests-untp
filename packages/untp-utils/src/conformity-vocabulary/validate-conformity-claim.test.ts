import { ConformityWarningCode } from './codes.js';
import type { ConformityClaim, ConformityScheme } from './types.js';
import { validateConformityClaim } from './validate-conformity-claim.js';

const SCHEME_URI = 'https://example.com/scheme';
const PROFILE_URI = 'https://example.com/scheme/full/1.0.0';
const CRITERION_A = 'https://example.com/criterion/a/1.0.0';
const CRITERION_B = 'https://example.com/criterion/b/1.0.0';
const TOPIC_A1 = 'https://vocabulary.uncefact.org/conformity-topics/a-1';
const TOPIC_A2 = 'https://vocabulary.uncefact.org/conformity-topics/a-2';

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

describe('validateConformityClaim', () => {
  it('returns no errors and no warnings when the claim matches the scheme exactly', () => {
    const claim: ConformityClaim = {
      scheme: SCHEME_URI,
      profile: PROFILE_URI,
      criteria: [{ criterion: CRITERION_A, conformityTopic: TOPIC_A1 }, { criterion: CRITERION_B }],
    };
    const outcome = validateConformityClaim(claim, scheme());
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });

  describe('scheme-not-found', () => {
    it('fires when the scheme is null', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [],
      };
      const outcome = validateConformityClaim(claim, null);
      expect(outcome.warnings).toEqual([
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
        criteria: [{ criterion: CRITERION_A }],
      };
      const outcome = validateConformityClaim(claim, wrongScheme);
      expect(outcome.warnings.map((w) => w.code)).toEqual([ConformityWarningCode.SchemeNotFound]);
    });

    it('short-circuits: no profile or criterion checks run', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: 'https://example.com/scheme/does-not-exist/9.9.9',
        criteria: [{ criterion: 'https://example.com/criterion/does-not-exist/9.9.9' }],
      };
      const outcome = validateConformityClaim(claim, null);
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings[0].code).toBe(ConformityWarningCode.SchemeNotFound);
    });
  });

  describe('profile-not-found', () => {
    it("fires when the claim's profile URI is not among the scheme's profiles", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: 'https://example.com/scheme/other/2.0.0',
        criteria: [{ criterion: CRITERION_A }],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([
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
          { criterion: 'https://example.com/criterion/unknown/1.0.0' },
          { criterion: CRITERION_A, conformityTopic: 'https://example.com/topics/unknown' },
        ],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toHaveLength(1);
    });
  });

  describe('criterion-not-in-profile', () => {
    it("fires when a claim's criterion URI is not in the profile's published criteria", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A },
          { criterion: CRITERION_B },
          { criterion: 'https://example.com/criterion/unknown/1.0.0' },
        ],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionNotInProfile,
          received: 'https://example.com/criterion/unknown/1.0.0',
          expected: [CRITERION_A, CRITERION_B],
          pointer: '/criteria/2/criterion',
        }),
      ]);
    });

    it('does not double-report missing criteria as topic-mismatch', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A },
          { criterion: CRITERION_B },
          {
            criterion: 'https://example.com/criterion/unknown/1.0.0',
            conformityTopic: 'https://example.com/topics/unknown',
          },
        ],
      };
      const outcome = validateConformityClaim(claim, scheme());
      const codes = outcome.warnings.map((w) => w.code);
      expect(codes).toContain(ConformityWarningCode.CriterionNotInProfile);
      expect(codes).not.toContain(ConformityWarningCode.CriterionTopicMismatch);
    });
  });

  describe('criterion-missing', () => {
    it('fires when the profile publishes a criterion the claim does not address', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A, conformityTopic: TOPIC_A1 }],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionMissing,
          expected: CRITERION_B,
          pointer: '/criteria',
        }),
      ]);
    });

    it('fires for every missing criterion (no short-circuit)', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [],
      };
      const outcome = validateConformityClaim(claim, scheme());
      const missingExpected = outcome.warnings
        .filter((w) => w.code === ConformityWarningCode.CriterionMissing)
        .map((w) => w.expected);
      expect(missingExpected).toEqual([CRITERION_A, CRITERION_B]);
    });
  });

  describe('criterion-topic-mismatch', () => {
    it("fires when the claim's topic for a criterion isn't in the criterion's published topics", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [
          { criterion: CRITERION_A, conformityTopic: 'https://example.com/topics/wrong' },
          { criterion: CRITERION_B },
        ],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([
        expect.objectContaining({
          code: ConformityWarningCode.CriterionTopicMismatch,
          received: 'https://example.com/topics/wrong',
          expected: [TOPIC_A1, TOPIC_A2],
          pointer: '/criteria/0/conformityTopic',
        }),
      ]);
    });

    it('does not fire when the claim does not declare a topic', () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A }, { criterion: CRITERION_B }],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([]);
    });

    it("does not fire when the claim's topic matches one of the criterion's topics", () => {
      const claim: ConformityClaim = {
        scheme: SCHEME_URI,
        profile: PROFILE_URI,
        criteria: [{ criterion: CRITERION_A, conformityTopic: TOPIC_A2 }, { criterion: CRITERION_B }],
      };
      const outcome = validateConformityClaim(claim, scheme());
      expect(outcome.warnings).toEqual([]);
    });
  });
});
