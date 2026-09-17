import cvcSchema from '../../../untp-utils/artefacts/schema/untp/0.7.0/cvc.json';
import { extractDccConformityClaimWithProvenance } from '../../../services/src/data-model-bridges/data-models/dcc/versions/v070/conformity-claim';
import { validateConformityClaim } from '../../../untp-utils/src/conformity-vocabulary/validate-conformity-claim';
import { remapWarningPointers } from '../../../services/src/cvc/remap-warning-pointers';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { SYSTEM_TENANT_ID, seedCvcDataModel, seedSystemTenant } from './fixtures';
import { ingestConformityScheme } from '../../src/lib/cvc/ingest-conformity-scheme';
import {
  findConformitySchemeByCanonicalId,
  resolveConformityReferences,
} from '../../src/lib/prisma/repositories/conformity-scheme.repository';
import { schemaLoader } from '../../src/lib/credentials/schema-loader';
import { contextCache } from '../../src/lib/credentials/context-cache';
import { ConformitySchemeSource } from '../../src/lib/prisma/generated/index.js';

const prisma = createRigClient();
let fixtures: FixtureServer;

const TENANT_ID = 'cvc-score-tenant';
const OTHER_TENANT_ID = 'cvc-score-other-tenant';
const CVC_CONTEXT = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
const LOCAL_CONTEXT = { '@context': { '@vocab': 'https://scheme.example/vocab#', id: '@id', type: '@type' } };

type SourceCase = {
  source: ConformitySchemeSource;
  tenantId: string;
  label: string;
};

const SOURCE_CASES: SourceCase[] = [
  { source: ConformitySchemeSource.UNTP, tenantId: SYSTEM_TENANT_ID, label: 'untp' },
  { source: ConformitySchemeSource.SYSTEM_SEED, tenantId: SYSTEM_TENANT_ID, label: 'system-seed' },
  { source: ConformitySchemeSource.TENANT_IMPORTED, tenantId: TENANT_ID, label: 'tenant-import' },
];

function scoredSchemeDocument(schemeId: string, profileId: string, criterionId: string, requiredCode: string) {
  return {
    '@context': [CVC_CONTEXT],
    type: ['ConformityScheme'],
    id: schemeId,
    name: 'Example scoring scheme',
    owner: { id: 'https://scheme.example/owner', name: 'Example owner' },
    endorsementLevel: 'endorsed_self',
    documentation: 'https://scheme.example/documentation',
    schemeScoringFramework: {
      name: 'Scheme framework',
      description: 'The scheme-level framework.',
      score: [{ code: 'SCHEME' }],
    },
    includedProfile: [
      {
        type: ['ConformityProfile'],
        id: profileId,
        name: 'Example profile',
        version: '1.0.0',
        validFrom: '2026-01-01',
        status: 'active',
        scheme: { id: schemeId, name: 'Example scoring scheme' },
        criterionScoringFramework: [
          {
            name: 'Profile framework',
            description: 'The profile-level framework.',
            score: [{ code: 'PROFILE' }],
          },
        ],
        criterion: [
          {
            type: ['Criterion'],
            id: criterionId,
            name: 'Example criterion',
            version: '1.0.0',
            status: 'active',
            conformityTopic: [
              {
                type: ['ConformityTopic'],
                id: 'https://scheme.example/topic/example',
                name: 'Example topic',
              },
            ],
            requiredPerformance: [
              {
                metric: {
                  type: ['PerformanceMetric'],
                  id: 'https://scheme.example/metric/example',
                  name: 'Example metric',
                },
                score: { code: requiredCode },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function ingest(sourceCase: SourceCase, schemeId: string, document: Record<string, unknown>): Promise<void> {
  const sourceUrl = `${fixtures.baseUrl}/schemes/${sourceCase.label}-${encodeURIComponent(schemeId)}.json`;
  fixtures.set(sourceUrl.replace(fixtures.baseUrl, ''), { body: JSON.stringify(document) });
  const result = await ingestConformityScheme({
    sourceUrl,
    source: sourceCase.source,
    tenantId: sourceCase.tenantId,
    conformitySchemaUrl: `${fixtures.baseUrl}/cvc/schema.json`,
    schemaLoader,
    conformityVocabularySpecVersion: '0.7.0',
  });
  if (result.kind !== 'success') {
    const cause = result.kind === 'failure' ? result.error.cause : undefined;
    const nestedCause = cause && typeof cause === 'object' ? (cause as { cause?: unknown }).cause : undefined;
    throw new Error(`Conformity fixture ingest failed: ${result.kind} ${String(cause)} cause=${String(nestedCause)}`);
  }
}

beforeAll(async () => {
  fixtures = await startFixtureServer();
});

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await seedSystemTenant(prisma);
  await prisma.tenant.create({ data: { id: TENANT_ID, name: 'CVC score tenant' } });
  await prisma.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other tenant' } });
  await seedCvcDataModel(prisma, fixtures);
  fixtures.set('/cvc/schema.json', { body: JSON.stringify(cvcSchema) });
  await contextCache.clear();
  await contextCache.get(CVC_CONTEXT, async () => ({ documentUrl: CVC_CONTEXT, document: LOCAL_CONTEXT }));
  await contextCache.get(`${CVC_CONTEXT}.`, async () => ({ documentUrl: `${CVC_CONTEXT}.`, document: LOCAL_CONTEXT }));
});

afterAll(async () => {
  await fixtures.close();
  await prisma.$disconnect();
});

describe('conformity score evidence through every ingest source', () => {
  it('projects all framework tiers after UNTP, system-seed and tenant-imported ingestion', async () => {
    for (const sourceCase of SOURCE_CASES) {
      const schemeId = `https://scheme.example/${sourceCase.label}`;
      const profileId = `${schemeId}/profile/1.0.0`;
      const criterionId = `${schemeId}/criterion/1.0.0`;
      await ingest(
        sourceCase,
        schemeId,
        scoredSchemeDocument(schemeId, profileId, criterionId, `REQUIRED-${sourceCase.label}`),
      );

      const lookup = await findConformitySchemeByCanonicalId(schemeId, sourceCase.tenantId);
      expect(lookup?.scoringEvidence).toBe('available');
      expect(lookup?.scheme.scoringFramework?.scores.map((score) => score.code)).toEqual(['SCHEME']);
      expect(lookup?.scheme.profiles[0].criterionScoringFrameworks?.[0].scores.map((score) => score.code)).toEqual([
        'PROFILE',
      ]);
      expect(lookup?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe(
        `REQUIRED-${sourceCase.label}`,
      );

      const references = await resolveConformityReferences([schemeId, profileId, criterionId], sourceCase.tenantId);
      expect(references).toEqual(
        new Map([
          [schemeId, [{ tier: 'scheme', schemes: [schemeId] }]],
          [profileId, [{ tier: 'profile', schemes: [schemeId] }]],
          [criterionId, [{ tier: 'criterion', schemes: [schemeId], profiles: [profileId] }]],
        ]),
      );

      const subject = {
        type: ['ConformityAttestation'],
        id: `${schemeId}/attestation/1`,
        name: 'Example conformity attestation',
        assessorLevel: '3rdParty',
        assessmentLevel: 'scheme-cab',
        attestationType: 'certification',
        issuedToParty: { id: 'https://scheme.example/party/1', name: 'Example party' },
        referenceScheme: { id: schemeId, name: 'Example scoring scheme' },
        referenceProfile: { id: profileId, name: 'Example profile' },
        profileScore: { code: 'NOT-PUBLISHED' },
        conformityAssessment: [
          {
            type: ['ConformityAssessment'],
            id: `${schemeId}/assessment/1`,
            name: 'Example assessment',
            assessmentCriteria: [{ type: ['Criterion'], id: criterionId, name: 'Example criterion' }],
            assessmentDate: '2026-01-01',
            assessedPerformance: [
              {
                metric: { id: 'https://scheme.example/metric/example', name: 'Example metric' },
                score: { code: 'NOT-PUBLISHED' },
              },
            ],
            conformityTopic: [
              {
                type: ['ConformityTopic'],
                id: 'https://scheme.example/topic/example',
                name: 'Example topic',
              },
            ],
          },
        ],
      };
      const extracted = extractDccConformityClaimWithProvenance(subject);
      expect(extracted).not.toBeNull();
      const warnings = validateConformityClaim(extracted!.claim, lookup!.scheme);
      const remapped = remapWarningPointers(
        warnings,
        extracted!.sourceMap,
        { credentialSubject: subject },
        '/credentialSubject',
      );
      expect(remapped.map((warning) => warning.code)).toEqual([
        'conformity-attestation.score-not-in-framework',
        'conformity-assessment.score-not-in-framework',
      ]);
      expect(remapped.map((warning) => warning.pointer)).toEqual([
        '/credentialSubject/profileScore/code',
        '/credentialSubject/conformityAssessment/0/assessedPerformance/0/score/code',
      ]);
    }
  });

  it('uses the system scoring document over a tenant overlay and keeps shared-criterion evidence scheme-local', async () => {
    const precedenceScheme = 'https://scheme.example/precedence';
    const precedenceProfile = `${precedenceScheme}/profile/1.0.0`;
    const precedenceCriterion = `${precedenceScheme}/criterion/1.0.0`;
    await ingest(
      SOURCE_CASES[0],
      precedenceScheme,
      scoredSchemeDocument(precedenceScheme, precedenceProfile, precedenceCriterion, 'SYSTEM-ONLY'),
    );
    await ingest(
      SOURCE_CASES[2],
      precedenceScheme,
      scoredSchemeDocument(precedenceScheme, precedenceProfile, precedenceCriterion, 'TENANT-ONLY'),
    );

    const precedenceLookup = await findConformitySchemeByCanonicalId(precedenceScheme, TENANT_ID);
    expect(precedenceLookup?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('SYSTEM-ONLY');

    const tenantOnlySubject = {
      referenceScheme: { id: precedenceScheme },
      referenceProfile: { id: precedenceProfile },
      conformityAssessment: [
        {
          assessmentCriteria: [{ id: precedenceCriterion }],
          assessedPerformance: [{ score: { code: 'TENANT-ONLY' } }],
        },
      ],
    };
    const tenantOnlyExtracted = extractDccConformityClaimWithProvenance(tenantOnlySubject);
    const tenantOnlyWarnings = validateConformityClaim(tenantOnlyExtracted!.claim, precedenceLookup!.scheme);
    expect(tenantOnlyWarnings).toEqual([
      expect.objectContaining({
        code: 'conformity-assessment.score-not-in-framework',
        received: 'TENANT-ONLY',
        expected: ['SCHEME', 'PROFILE', 'SYSTEM-ONLY'],
      }),
    ]);

    const sharedCriterion = 'https://scheme.example/shared-criterion/1.0.0';
    const firstScheme = 'https://scheme.example/shared-first';
    const secondScheme = 'https://scheme.example/shared-second';
    await ingest(
      SOURCE_CASES[0],
      firstScheme,
      scoredSchemeDocument(firstScheme, `${firstScheme}/profile/1.0.0`, sharedCriterion, 'FIRST-SCHEME'),
    );
    await ingest(
      SOURCE_CASES[0],
      secondScheme,
      scoredSchemeDocument(secondScheme, `${secondScheme}/profile/1.0.0`, sharedCriterion, 'SECOND-SCHEME'),
    );

    const firstLookup = await findConformitySchemeByCanonicalId(firstScheme, SYSTEM_TENANT_ID);
    const secondLookup = await findConformitySchemeByCanonicalId(secondScheme, SYSTEM_TENANT_ID);
    expect(firstLookup?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('FIRST-SCHEME');
    expect(secondLookup?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('SECOND-SCHEME');

    const otherTenantReferences = await resolveConformityReferences([precedenceScheme], OTHER_TENANT_ID);
    expect(otherTenantReferences).toEqual(
      new Map([[precedenceScheme, [{ tier: 'scheme', schemes: [precedenceScheme] }]]]),
    );

    const tenantOnlyScheme = 'https://scheme.example/tenant-only-visible-to-one-tenant';
    const tenantOnlyProfile = `${tenantOnlyScheme}/profile/1.0.0`;
    const tenantOnlyCriterion = `${tenantOnlyScheme}/criterion/1.0.0`;
    await ingest(
      SOURCE_CASES[2],
      tenantOnlyScheme,
      scoredSchemeDocument(tenantOnlyScheme, tenantOnlyProfile, tenantOnlyCriterion, 'TENANT-ONLY'),
    );
    const otherTenantReferencesForTenantImport = await resolveConformityReferences(
      [tenantOnlyScheme, tenantOnlyProfile, tenantOnlyCriterion],
      OTHER_TENANT_ID,
    );
    expect(otherTenantReferencesForTenantImport).toEqual(
      new Map([
        [tenantOnlyScheme, []],
        [tenantOnlyProfile, []],
        [tenantOnlyCriterion, []],
      ]),
    );
  });

  it('diagnoses an ingested profile URI used as the scheme reference', async () => {
    const schemeId = 'https://scheme.example/wrong-tier-scheme';
    const profileId = `${schemeId}/profile/1.0.0`;
    const criterionId = `${schemeId}/criterion/1.0.0`;
    await ingest(SOURCE_CASES[0], schemeId, scoredSchemeDocument(schemeId, profileId, criterionId, 'REQUIRED'));

    const references = await resolveConformityReferences([profileId], SYSTEM_TENANT_ID);
    const subject = { referenceScheme: { id: profileId } };
    const extracted = extractDccConformityClaimWithProvenance(subject);
    const warnings = validateConformityClaim(extracted!.claim, null, { scheme: references.get(profileId) ?? [] });
    const remapped = remapWarningPointers(
      warnings,
      extracted!.sourceMap,
      { credentialSubject: subject },
      '/credentialSubject',
    );

    expect(remapped).toEqual([
      expect.objectContaining({
        code: 'conformity-scheme.wrong-tier',
        received: profileId,
        expected: [schemeId],
        pointer: '/credentialSubject/referenceScheme/id',
      }),
    ]);
  });

  it('retains the scoring document through unchanged and failed refreshes', async () => {
    const sourceCase = SOURCE_CASES[0];
    const schemeId = 'https://scheme.example/refresh-retention';
    const profileId = `${schemeId}/profile/1.0.0`;
    const criterionId = `${schemeId}/criterion/1.0.0`;
    const document = scoredSchemeDocument(schemeId, profileId, criterionId, 'RETAINED');
    const sourceUrl = `${fixtures.baseUrl}/schemes/${sourceCase.label}-${encodeURIComponent(schemeId)}.json`;
    const fixturePath = sourceUrl.replace(fixtures.baseUrl, '');

    await ingest(sourceCase, schemeId, document);
    const beforeRefresh = await findConformitySchemeByCanonicalId(schemeId, sourceCase.tenantId);
    expect(beforeRefresh?.scoringEvidence).toBe('available');
    expect(beforeRefresh?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('RETAINED');
    const claim = {
      scheme: schemeId,
      profile: profileId,
      profileScore: { code: 'NOT-RETAINED' },
      criteria: [{ criterion: criterionId }],
    };
    const verdictBeforeRefresh = validateConformityClaim(claim, beforeRefresh!.scheme).map((warning) => warning.code);
    expect(verdictBeforeRefresh).toEqual(['conformity-attestation.score-not-in-framework']);

    fixtures.set(fixturePath, { body: JSON.stringify(document) });
    const unchanged = await ingestConformityScheme({
      sourceUrl,
      source: sourceCase.source,
      tenantId: sourceCase.tenantId,
      conformitySchemaUrl: `${fixtures.baseUrl}/cvc/schema.json`,
      schemaLoader,
      conformityVocabularySpecVersion: '0.7.0',
    });
    expect(unchanged.kind).toBe('unchanged');

    fixtures.set(fixturePath, { body: '{ invalid json' });
    const failed = await ingestConformityScheme({
      sourceUrl,
      source: sourceCase.source,
      tenantId: sourceCase.tenantId,
      conformitySchemaUrl: `${fixtures.baseUrl}/cvc/schema.json`,
      schemaLoader,
      conformityVocabularySpecVersion: '0.7.0',
    });
    expect(failed.kind).toBe('failure');

    const afterRefresh = await findConformitySchemeByCanonicalId(schemeId, sourceCase.tenantId);
    expect(afterRefresh?.scoringEvidence).toBe('available');
    expect(afterRefresh?.scheme.profiles[0].criteria[0].requiredPerformance?.[0].score?.code).toBe('RETAINED');
    expect(validateConformityClaim(claim, afterRefresh!.scheme).map((warning) => warning.code)).toEqual(
      verdictBeforeRefresh,
    );
  });
});
