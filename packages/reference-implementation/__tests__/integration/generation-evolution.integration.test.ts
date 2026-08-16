import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { seedSystemTenant, seedCvcDataModel, schemeDoc, bootManifest, CVC_SPEC_VERSION } from './fixtures';

const prisma = createRigClient();
let fixtures: FixtureServer;

const SCHEME_S = 'https://schemes.example/s';
const SCHEME_T = 'https://schemes.example/t';
const PROFILE_P1 = 'https://schemes.example/s/basic/1.0.0';
const PROFILE_P2 = 'https://schemes.example/s/advanced/1.0.0';
const CRITERION_C1 = 'https://criteria.example/c1/1.0.0';
const CRITERION_C2 = 'https://criteria.example/c2/1.0.0';
const CRITERION_C3 = 'https://criteria.example/c3/1.0.0';

/** Boots a manifest listing each entry as a `file:` conformity-scheme source. */
function boot(docs: { file: string; doc: Record<string, unknown> }[]): Promise<void> {
  const yaml =
    `conformitySchemes:\n` + docs.map((d) => `  - file: ${d.file}\n    version: "${CVC_SPEC_VERSION}"\n`).join('');
  const files = Object.fromEntries(docs.map((d) => [d.file, JSON.stringify(d.doc)]));
  return bootManifest(prisma, yaml, files);
}

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

describe('two-generation document evolution converges on re-ingest', () => {
  it('applies rename-in-place, profile addition, and criterion drop-with-sweep; shared criteria survive', async () => {
    // Generation 1: scheme S has profile P1 with criteria C1 + C2; a second
    // scheme T also references C1, making it tenant-shared.
    const gen1S = schemeDoc(fixtures, SCHEME_S, {
      name: 'Scheme S',
      profiles: [
        {
          id: PROFILE_P1,
          name: 'Basic',
          criteria: [
            { id: CRITERION_C1, name: 'C1' },
            { id: CRITERION_C2, name: 'C2' },
          ],
        },
      ],
    });
    const docT = schemeDoc(fixtures, SCHEME_T, {
      name: 'Scheme T',
      profiles: [{ id: `${SCHEME_T}/full/1.0.0`, name: 'Full', criteria: [{ id: CRITERION_C1, name: 'C1' }] }],
    });

    await boot([
      { file: 'schemes/s.json', doc: gen1S },
      { file: 'schemes/t.json', doc: docT },
    ]);

    const schemeRowGen1 = await prisma.conformityScheme.findFirstOrThrow({ where: { canonicalId: SCHEME_S } });
    expect(await prisma.conformityProfile.count()).toBe(2);
    expect(await prisma.conformityCriterion.count()).toBe(2);
    const c1RowGen1 = await prisma.conformityCriterion.findFirstOrThrow({ where: { canonicalId: CRITERION_C1 } });

    // Generation 2 of S: P1 renamed at the same canonical id, P2 added with
    // new criterion C3, and C2 dropped from the document entirely.
    const gen2S = schemeDoc(fixtures, SCHEME_S, {
      name: 'Scheme S (2nd edition)',
      profiles: [
        { id: PROFILE_P1, name: 'Basic (renamed)', criteria: [{ id: CRITERION_C1, name: 'C1' }] },
        { id: PROFILE_P2, name: 'Advanced', criteria: [{ id: CRITERION_C3, name: 'C3' }] },
      ],
    });

    await boot([
      { file: 'schemes/s.json', doc: gen2S },
      { file: 'schemes/t.json', doc: docT },
    ]);

    // The scheme row is updated in place (stable row id, new name).
    const schemeRowGen2 = await prisma.conformityScheme.findFirstOrThrow({ where: { canonicalId: SCHEME_S } });
    expect(schemeRowGen2.id).toBe(schemeRowGen1.id);
    expect(schemeRowGen2.name).toBe('Scheme S (2nd edition)');

    // Profile convergence is canonical-identity based: one profile at P1's
    // canonical id carrying the new name, and P2 present. (Profile row ids
    // are deliberately not asserted: ingest delete-and-recreates them.)
    const profiles = await prisma.conformityProfile.findMany({ where: { schemeId: schemeRowGen2.id } });
    expect(profiles.map((p) => [p.canonicalId, p.name]).sort()).toEqual([
      [PROFILE_P2, 'Advanced'],
      [PROFILE_P1, 'Basic (renamed)'],
    ]);

    // C2 is referenced by nothing and swept; C1 survives because scheme T
    // still references it; C3 was added. Criterion rows keep their identity
    // for unchanged canonical ids.
    const criteria = await prisma.conformityCriterion.findMany();
    expect(criteria.map((c) => c.canonicalId).sort()).toEqual([CRITERION_C1, CRITERION_C3]);

    const c1 = criteria.find((c) => c.canonicalId === CRITERION_C1)!;
    // Criterion rows are upserted on (canonicalId, tenantId), so an
    // unchanged canonical id must keep its ROW identity across generations
    // (unlike profiles, which are delete-and-recreated by design).
    expect(c1.id).toBe(c1RowGen1.id);
    const c1Joins = await prisma.conformityProfileCriterion.count({ where: { criterionId: c1.id } });
    expect(c1Joins).toBe(2); // S's renamed P1 and T's Full profile.
  });

  it('dropping the last scheme referencing a criterion sweeps it once unreferenced', async () => {
    const doc = schemeDoc(fixtures, SCHEME_S, {
      name: 'Scheme S',
      profiles: [{ id: PROFILE_P1, name: 'Basic', criteria: [{ id: CRITERION_C1, name: 'C1' }] }],
    });
    await boot([{ file: 'schemes/s.json', doc }]);
    expect(await prisma.conformityCriterion.count()).toBe(1);

    const gen2 = schemeDoc(fixtures, SCHEME_S, {
      name: 'Scheme S',
      profiles: [{ id: PROFILE_P1, name: 'Basic', criteria: [] }],
    });
    await boot([{ file: 'schemes/s.json', doc: gen2 }]);

    expect(await prisma.conformityCriterion.count()).toBe(0);
    expect(await prisma.conformityProfile.count()).toBe(1);
  });
});
