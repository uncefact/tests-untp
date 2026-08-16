import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import {
  quietLogger,
  capturingLogger,
  seedSystemTenant,
  seedCvcDataModel,
  schemeDoc,
  bootManifest,
  SYSTEM_TENANT_ID,
  CVC_SPEC_VERSION,
  type CapturedLog,
} from './fixtures';
import { ingestConformityScheme } from '../../src/lib/cvc/ingest-conformity-scheme';
import { refreshSeededSchemes } from '../../src/lib/cvc/refresh-seeded-schemes';
import { schemaLoader } from '../../src/lib/credentials/schema-loader';
import { ConformitySchemeSource, SeedEntryKind } from '../../src/lib/prisma/generated/index.js';

const prisma = createRigClient();
let fixtures: FixtureServer;

const SCHEME_URL_PATH = '/schemes/live.json';
const SCHEME_CANONICAL = 'https://schemes.example/live';
const REGISTRAR_ID = 'ctestbootregistrar0000001';

beforeAll(async () => {
  fixtures = await startFixtureServer();
});

beforeEach(async () => {
  await truncateApplicationTables(prisma);
  await seedSystemTenant(prisma);
  await seedCvcDataModel(prisma, fixtures);
});

afterAll(async () => {
  await fixtures.close();
  await prisma.$disconnect();
});

describe('seeded-scheme refresh against real rows', () => {
  it('picks up a changed URL document and persists the update', async () => {
    fixtures.set(SCHEME_URL_PATH, {
      body: JSON.stringify(schemeDoc(fixtures, SCHEME_CANONICAL, { name: 'Original', profiles: [] })),
    });
    await bootManifest(
      prisma,
      `conformitySchemes:\n  - url: ${fixtures.baseUrl}${SCHEME_URL_PATH}\n    version: "${CVC_SPEC_VERSION}"\n`,
    );
    const row = await prisma.conformityScheme.findFirstOrThrow();
    expect(row.name).toBe('Original');
    expect(row.seedEntryKind).toBe(SeedEntryKind.URL);

    fixtures.set(SCHEME_URL_PATH, {
      body: JSON.stringify(schemeDoc(fixtures, SCHEME_CANONICAL, { name: 'Publisher Updated', profiles: [] })),
    });

    const summary = await refreshSeededSchemes(quietLogger());

    expect(summary.refreshed).toBe(1);
    expect(summary.failed).toBe(0);
    const updated = await prisma.conformityScheme.findFirstOrThrow();
    expect(updated.id).toBe(row.id);
    expect(updated.name).toBe('Publisher Updated');
  });

  it('an unchanged document is a digest no-op that keeps profile row identity', async () => {
    const doc = JSON.stringify(
      schemeDoc(fixtures, SCHEME_CANONICAL, {
        name: 'Stable',
        profiles: [{ id: `${SCHEME_CANONICAL}/basic/1.0.0`, name: 'Basic' }],
      }),
    );
    fixtures.set(SCHEME_URL_PATH, { body: doc });
    await bootManifest(
      prisma,
      `conformitySchemes:\n  - url: ${fixtures.baseUrl}${SCHEME_URL_PATH}\n    version: "${CVC_SPEC_VERSION}"\n`,
    );
    const profileBefore = await prisma.conformityProfile.findFirstOrThrow();

    const summary = await refreshSeededSchemes(quietLogger());

    expect(summary.unchanged).toBe(1);
    expect(summary.refreshed).toBe(0);
    // The unchanged path never rewrites the profile graph, so the row
    // identity survives (a re-persist would delete-and-recreate it).
    const profileAfter = await prisma.conformityProfile.findFirstOrThrow();
    expect(profileAfter.id).toBe(profileBefore.id);
  });

  it('requireExistingRow returns stale (and creates nothing) when the row was evicted mid-refresh', async () => {
    fixtures.set(SCHEME_URL_PATH, {
      body: JSON.stringify(schemeDoc(fixtures, SCHEME_CANONICAL, { name: 'Original', profiles: [] })),
    });
    await bootManifest(
      prisma,
      `conformitySchemes:\n  - url: ${fixtures.baseUrl}${SCHEME_URL_PATH}\n    version: "${CVC_SPEC_VERSION}"\n`,
    );
    const dataModel = await prisma.dataModel.findFirstOrThrow({ where: { credentialType: 'ConformityScheme' } });

    // The eviction that raced the refresh: the row disappears after the
    // refresh listed it but before its persist.
    await prisma.conformityScheme.deleteMany();
    // A changed body forces the persist path (an unchanged digest would
    // short-circuit before the requireExistingRow check matters).
    fixtures.set(SCHEME_URL_PATH, {
      body: JSON.stringify(schemeDoc(fixtures, SCHEME_CANONICAL, { name: 'Newer', profiles: [] })),
    });

    const result = await ingestConformityScheme({
      sourceUrl: `${fixtures.baseUrl}${SCHEME_URL_PATH}`,
      source: ConformitySchemeSource.SYSTEM_SEED,
      tenantId: SYSTEM_TENANT_ID,
      conformitySchemaUrl: dataModel.schemaUrl,
      schemaLoader,
      conformityVocabularySpecVersion: CVC_SPEC_VERSION,
      requireExistingRow: true,
    });

    expect(result.kind).toBe('stale');
    // A timer must never recreate membership the manifest removed.
    expect(await prisma.conformityScheme.count()).toBe(0);
  });
});

describe('second boot with an unchanged manifest', () => {
  it('performs no deletions and keeps every row identity', async () => {
    const schemeFile = JSON.stringify(
      schemeDoc(fixtures, SCHEME_CANONICAL, {
        name: 'Stable',
        profiles: [
          {
            id: `${SCHEME_CANONICAL}/basic/1.0.0`,
            name: 'Basic',
            criteria: [{ id: 'https://criteria.example/boot/1.0.0', name: 'Boot Criterion' }],
          },
        ],
      }),
    );
    const manifest = `
registrars:
  - id: ${REGISTRAR_ID}
    name: Boot Registrar
    namespace: bootreg
    identifierSchemes:
      - id: ctestbootscheme0000000001
        name: Boot Scheme
        primaryKey: "01"
        validationPattern: ".*"
        linkTemplate: "/{primaryKey}/{value}"
        qualifiers:
          - id: ctestbootqualifier0000001
            key: "10"
            description: Batch number
            validationPattern: ".*"
conformitySchemes:
  - file: schemes/live.json
    version: "${CVC_SPEC_VERSION}"
`;

    await bootManifest(prisma, manifest, { 'schemes/live.json': schemeFile });

    // Snapshot identity as (id, createdAt) pairs: manifest-specified ids
    // (registrar, scheme, qualifier) would survive a delete-and-recreate
    // regression, but createdAt would not. Joins are included so a second
    // boot silently dropping graph edges cannot pass.
    const snapshot = async () => ({
      registrars: (await prisma.registrar.findMany()).map((r) => [r.id, r.createdAt.toISOString()]).sort(),
      schemes: (await prisma.identifierScheme.findMany()).map((r) => [r.id, r.createdAt.toISOString()]).sort(),
      qualifiers: (await prisma.schemeQualifier.findMany()).map((r) => [r.id, r.createdAt.toISOString()]).sort(),
      conformitySchemes: (await prisma.conformityScheme.findMany()).map((r) => r.id).sort(),
      profiles: (await prisma.conformityProfile.findMany()).map((r) => r.id).sort(),
      criteria: (await prisma.conformityCriterion.findMany()).map((r) => r.id).sort(),
      // Join ROW ids, not endpoints: a delete-and-recreate under the same
      // (profileId, criterionId) pair would keep the endpoints but not the ids.
      joins: (await prisma.conformityProfileCriterion.findMany()).map((j) => j.id).sort(),
    });
    const before = await snapshot();
    expect(before.qualifiers).toHaveLength(1);
    expect(before.joins).toHaveLength(1);

    const logs: CapturedLog[] = [];
    await bootManifest(prisma, manifest, { 'schemes/live.json': schemeFile }, capturingLogger(logs));

    // Identity, not timestamps: upsert update-arms legitimately bump
    // updatedAt, so the no-op contract is "same rows, nothing deleted,
    // nothing recreated under a new id or a new createdAt".
    expect(await snapshot()).toEqual(before);

    // A silently failed second ingest (log-and-continue) would retain the
    // old rows and pass the identity checks; the fetch status and the
    // captured summary pin that the second boot actually succeeded and
    // deleted nothing.
    const conformityRow = await prisma.conformityScheme.findFirstOrThrow();
    expect(conformityRow.lastFetchStatus).toBe('SUCCESS');

    expect(logs.filter((l) => l.level === 'error')).toEqual([]);
    const summaryLog = logs.find(
      (l) => l.level === 'info' && typeof l.args[1] === 'string' && l.args[1].includes('Custom seed completed'),
    );
    expect(summaryLog).toBeDefined();
    const summary = summaryLog!.args[0] as {
      removed: Record<string, number>;
      conformitySchemes: { failed: number; evicted: number; criteriaSwept: number };
    };
    expect(Object.values(summary.removed).every((count) => count === 0)).toBe(true);
    expect(summary.conformitySchemes.failed).toBe(0);
    expect(summary.conformitySchemes.evicted).toBe(0);
    expect(summary.conformitySchemes.criteriaSwept).toBe(0);
  });
});
