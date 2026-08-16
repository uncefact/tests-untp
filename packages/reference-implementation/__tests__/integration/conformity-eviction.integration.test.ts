import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { seedSystemTenant, seedCvcDataModel, schemeDoc, bootManifest, CVC_SPEC_VERSION } from './fixtures';

const prisma = createRigClient();
let fixtures: FixtureServer;

const SCHEME_A = 'https://schemes.example/a';
const SCHEME_B = 'https://schemes.example/b';
const CRITERION_SHARED = 'https://criteria.example/shared/1.0.0';
const CRITERION_A_ONLY = 'https://criteria.example/a-only/1.0.0';

/** Boots a manifest listing each entry as a `file:` conformity-scheme source. */
async function bootWithFiles(entries: { file: string; doc?: Record<string, unknown> }[]): Promise<void> {
  const yaml =
    `conformitySchemes:\n` + entries.map((e) => `  - file: ${e.file}\n    version: "${CVC_SPEC_VERSION}"\n`).join('');
  const files = Object.fromEntries(entries.filter((e) => e.doc).map((e) => [e.file, JSON.stringify(e.doc)]));
  await bootManifest(prisma, yaml, files);
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

describe('seeded conformity scheme eviction and orphan-criterion sweep', () => {
  it('evicts a scheme dropped from the manifest and sweeps its now-orphaned criteria', async () => {
    const docA = schemeDoc(fixtures, SCHEME_A, {
      name: 'Scheme A',
      profiles: [
        {
          id: `${SCHEME_A}/full/1.0.0`,
          name: 'Full',
          criteria: [
            { id: CRITERION_A_ONLY, name: 'A Only' },
            { id: CRITERION_SHARED, name: 'Shared' },
          ],
        },
      ],
    });
    const docB = schemeDoc(fixtures, SCHEME_B, {
      name: 'Scheme B',
      profiles: [{ id: `${SCHEME_B}/full/1.0.0`, name: 'Full', criteria: [{ id: CRITERION_SHARED, name: 'Shared' }] }],
    });

    await bootWithFiles([
      { file: 'schemes/a.json', doc: docA },
      { file: 'schemes/b.json', doc: docB },
    ]);
    expect(await prisma.conformityScheme.count()).toBe(2);
    expect(await prisma.conformityCriterion.count()).toBe(2);

    // Second boot drops scheme A. Its profiles cascade; the A-only criterion
    // is swept, while the criterion scheme B still references survives.
    await bootWithFiles([{ file: 'schemes/b.json', doc: docB }]);

    const schemes = await prisma.conformityScheme.findMany();
    expect(schemes).toHaveLength(1);
    expect(schemes[0].canonicalId).toBe(SCHEME_B);

    const criteria = await prisma.conformityCriterion.findMany();
    expect(criteria).toHaveLength(1);
    expect(criteria[0].canonicalId).toBe(CRITERION_SHARED);
    expect(await prisma.conformityProfileCriterion.count()).toBe(1);
  });

  it('an explicit empty conformitySchemes array removes every seeded scheme and all orphaned criteria', async () => {
    const docA = schemeDoc(fixtures, SCHEME_A, {
      name: 'Scheme A',
      profiles: [{ id: `${SCHEME_A}/full/1.0.0`, name: 'Full', criteria: [{ id: CRITERION_A_ONLY, name: 'A Only' }] }],
    });
    await bootWithFiles([{ file: 'schemes/a.json', doc: docA }]);
    expect(await prisma.conformityScheme.count()).toBe(1);

    await bootManifest(prisma, `conformitySchemes: []\n`);

    expect(await prisma.conformityScheme.count()).toBe(0);
    expect(await prisma.conformityProfile.count()).toBe(0);
    expect(await prisma.conformityCriterion.count()).toBe(0);
  });

  it('a FILE entry that fails to resolve suppresses eviction for the boot', async () => {
    const docA = schemeDoc(fixtures, SCHEME_A, { name: 'Scheme A', profiles: [] });
    await bootWithFiles([{ file: 'schemes/a.json', doc: docA }]);
    expect(await prisma.conformityScheme.count()).toBe(1);

    // The next manifest omits scheme A and carries one FILE entry whose file
    // is missing: identity resolution fails, so nothing may be evicted, and
    // the previously seeded row must survive the boot.
    await bootWithFiles([{ file: 'schemes/missing.json' }]);

    expect(await prisma.conformityScheme.count()).toBe(1);
  });

  it('a document that moved URL with a stable canonical id converges to one row at the new URL', async () => {
    const doc = schemeDoc(fixtures, SCHEME_A, { name: 'Scheme A', profiles: [] });
    fixtures.set('/schemes/old-location.json', { body: JSON.stringify(doc) });
    fixtures.set('/schemes/new-location.json', { body: JSON.stringify(doc) });

    const bootWithUrl = (path: string) =>
      bootManifest(
        prisma,
        `conformitySchemes:\n  - url: ${fixtures.baseUrl}${path}\n    version: "${CVC_SPEC_VERSION}"\n`,
      );

    await bootWithUrl('/schemes/old-location.json');
    expect(await prisma.conformityScheme.count()).toBe(1);

    await bootWithUrl('/schemes/new-location.json');

    const schemes = await prisma.conformityScheme.findMany();
    expect(schemes).toHaveLength(1);
    expect(schemes[0].canonicalId).toBe(SCHEME_A);
    expect(schemes[0].sourceUrl).toBe(`${fixtures.baseUrl}/schemes/new-location.json`);
  });
});

describe('top-level conformitySchemes presence semantics', () => {
  it('an absent conformitySchemes key leaves previously seeded schemes and their graph untouched', async () => {
    const doc = schemeDoc(fixtures, SCHEME_A, {
      name: 'Scheme A',
      profiles: [{ id: `${SCHEME_A}/full/1.0.0`, name: 'Full', criteria: [{ id: CRITERION_A_ONLY, name: 'A Only' }] }],
    });
    await bootWithFiles([{ file: 'schemes/a.json', doc }]);
    expect(await prisma.conformityScheme.count()).toBe(1);

    // A later boot managing a different section only: conformity schemes are
    // unmanaged this boot, so nothing is evicted and the graph survives.
    await bootManifest(prisma, `dataModels: []\n`);

    expect(await prisma.conformityScheme.count()).toBe(1);
    expect(await prisma.conformityProfile.count()).toBe(1);
    expect(await prisma.conformityCriterion.count()).toBe(1);
    expect(await prisma.conformityProfileCriterion.count()).toBe(1);
  });
});
