import { createRigClient, truncateApplicationTables } from './rig/db';
import { startFixtureServer, type FixtureServer } from './rig/fixture-server';
import { seedSystemTenant, seedCvcDataModel, schemeDoc, SYSTEM_TENANT_ID, CVC_SPEC_VERSION } from './fixtures';
import { reconcileRemovals } from '../../prisma/custom-seed-reconcile';
import { acquireCvcStructuralLock } from '../../src/lib/cvc/cvc-structural-lock';
import { ingestConformityScheme } from '../../src/lib/cvc/ingest-conformity-scheme';
import { schemaLoader } from '../../src/lib/credentials/schema-loader';
import type { CustomSeedManifest, ManifestSectionPresence } from '../../prisma/custom-seed-schema';
import type { Prisma } from '../../src/lib/prisma/generated/index.js';
import { ConformitySchemeSource, RecordSource } from '../../src/lib/prisma/generated/index.js';

const REGISTRAR_ID = 'ctestlockedregistrar00001';

const writer = createRigClient();
const attacker = createRigClient();
let fixtures: FixtureServer;

const EMPTY_MANIFEST: CustomSeedManifest = {
  registrars: [],
  dataModels: [],
  renderTemplates: [],
  conformitySchemes: [],
};

const REGISTRARS_PRESENT: ManifestSectionPresence = {
  registrars: true,
  dataModels: false,
  renderTemplates: false,
  conformitySchemes: false,
  identifierSchemesByRegistrar: new Map(),
  qualifiersByScheme: new Map(),
};

/**
 * Wraps a transaction client so `registrar.deleteMany` pauses at a barrier
 * before executing. For this fixture (victim registrar with no children)
 * that pause point is exactly #900's discovery-to-delete gap: after
 * `lockRows` has taken FOR UPDATE on the victim and the descendant checks
 * have passed, before any delete has run. Every other property and method
 * is returned bound to the real client, untouched (Prisma's tx is itself a
 * proxy, so receivers must be preserved).
 *
 * The mutation this makes detectable: with `lockRows` removed from
 * `reconcileRemovals`, the attacker's INSERT at the pause sees an unlocked,
 * still-live parent, commits into the gap, and is silently cascade-deleted
 * when the barrier lifts, which fails this suite's assertions.
 */
function pauseBeforeRegistrarDelete(
  tx: Prisma.TransactionClient,
  onReachedDelete: () => void,
  release: Promise<void>,
): Prisma.TransactionClient {
  const registrarDelegate = new Proxy(tx.registrar, {
    get(target, prop, receiver) {
      if (prop === 'deleteMany') {
        return async (...args: unknown[]) => {
          onReachedDelete();
          await release;
          return (target.deleteMany as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'registrar') return registrarDelegate;
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Runs reconcileRemovals paused at the gap, invokes `attack` there, then releases. */
async function withGapOpen(attack: () => Promise<void>): Promise<{ registrarsRemoved: number }> {
  let releaseDelete!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let signalReached!: () => void;
  const reachedDelete = new Promise<void>((resolve) => {
    signalReached = resolve;
  });

  const reconcile = writer.$transaction(
    async (tx) => {
      const paused = pauseBeforeRegistrarDelete(tx, signalReached, release);
      return reconcileRemovals(paused, EMPTY_MANIFEST, REGISTRARS_PRESENT, SYSTEM_TENANT_ID);
    },
    { timeout: 30_000 },
  );

  await reachedDelete;
  try {
    await attack();
  } finally {
    releaseDelete();
  }
  const summary = await reconcile;
  return { registrarsRemoved: summary.registrars };
}

beforeAll(async () => {
  fixtures = await startFixtureServer();
});

beforeEach(async () => {
  await truncateApplicationTables(writer);
  await seedSystemTenant(writer);
  await writer.registrar.create({
    data: {
      id: REGISTRAR_ID,
      tenantId: SYSTEM_TENANT_ID,
      name: 'Victim Registrar',
      namespace: 'victim',
      source: RecordSource.CUSTOM_SEED,
    },
  });
});

afterAll(async () => {
  await fixtures.close();
  await writer.$disconnect();
  await attacker.$disconnect();
});

describe('reconcile FOR UPDATE victim locks (the #900 discovery-to-delete race)', () => {
  it('a child INSERT inside the gap times out on the FOR UPDATE lock instead of committing and being cascade-deleted', async () => {
    const { registrarsRemoved } = await withGapOpen(async () => {
      // Inside the gap: the victim is locked FOR UPDATE but NOT yet deleted.
      // The insert's FK check takes FOR KEY SHARE on the parent row, which
      // conflicts with FOR UPDATE, so with a bounded lock_timeout it fails
      // loudly here rather than waiting or slipping through.
      await expect(
        attacker.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '1s'`);
          await tx.identifierScheme.create({
            data: {
              id: 'ctestlateattach0000000001',
              tenantId: SYSTEM_TENANT_ID,
              registrarId: REGISTRAR_ID,
              name: 'Late Attach',
              primaryKey: '01',
              validationPattern: '.*',
              linkTemplate: '/{primaryKey}/{value}',
              source: RecordSource.USER,
            },
          });
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('lock timeout') });
    });

    expect(registrarsRemoved).toBe(1);
    // Nothing slipped into the gap: no child row exists, silently deleted or otherwise.
    expect(await writer.identifierScheme.count()).toBe(0);
    expect(await writer.registrar.count()).toBe(0);
  });

  it('after the gap closes (transaction committed), a late attach fails its FK check loudly', async () => {
    await withGapOpen(async () => {
      /* no attack inside the gap; this case pins the post-commit behaviour */
    });

    await expect(
      attacker.identifierScheme.create({
        data: {
          id: 'ctestlateattach0000000002',
          tenantId: SYSTEM_TENANT_ID,
          registrarId: REGISTRAR_ID,
          name: 'Too Late',
          primaryKey: '01',
          validationPattern: '.*',
          linkTemplate: '/{primaryKey}/{value}',
          source: RecordSource.USER,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('CVC structural advisory lock', () => {
  it('serialises a second helper acquisition until the holder commits (key + lock semantics)', async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let signalAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });

    const holder = writer.$transaction(
      async (tx) => {
        await acquireCvcStructuralLock(tx, SYSTEM_TENANT_ID);
        signalAcquired();
        await hold;
      },
      { timeout: 20_000 },
    );
    await acquired;

    await expect(
      attacker.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`);
        await acquireCvcStructuralLock(tx, SYSTEM_TENANT_ID);
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('lock timeout') });

    releaseHold();
    await holder;

    await attacker.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`);
      await acquireCvcStructuralLock(tx, SYSTEM_TENANT_ID);
    });
  });

  it('blocks a REAL production writer (ingest persist) until the holder releases', async () => {
    await seedCvcDataModel(writer, fixtures);
    fixtures.set('/schemes/lock-probe.json', {
      body: JSON.stringify(schemeDoc(fixtures, 'https://schemes.example/lock-probe', { name: 'Probe', profiles: [] })),
    });
    const dataModel = await writer.dataModel.findFirstOrThrow({ where: { credentialType: 'ConformityScheme' } });

    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let signalAcquired!: (identity: { classid: number; objid: number; objsubid: number }) => void;
    const acquired = new Promise<{ classid: number; objid: number; objsubid: number }>((resolve) => {
      signalAcquired = resolve;
    });
    const holder = writer.$transaction(
      async (tx) => {
        await acquireCvcStructuralLock(tx, SYSTEM_TENANT_ID);
        // Capture THIS transaction's granted advisory-lock identity so the
        // wait signal below matches this exact lock key, not any advisory
        // waiter that happens to exist on a shared external database.
        const granted = await tx.$queryRaw<{ classid: number; objid: number; objsubid: number }[]>`
          SELECT classid::int, objid::int, objsubid::int FROM pg_locks
          WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()
        `;
        signalAcquired(granted[0]);
        await hold;
      },
      { timeout: 30_000 },
    );
    const lockIdentity = await acquired;

    try {
      let holderReleasedAt = 0;
      const ingest = ingestConformityScheme({
        sourceUrl: `${fixtures.baseUrl}/schemes/lock-probe.json`,
        source: ConformitySchemeSource.SYSTEM_SEED,
        tenantId: SYSTEM_TENANT_ID,
        conformitySchemaUrl: dataModel.schemaUrl,
        schemaLoader,
        conformityVocabularySpecVersion: CVC_SPEC_VERSION,
      }).then((result) => ({ result, settledAfterRelease: holderReleasedAt !== 0 }));

      // Wait signal, not a sleep: the ingest's persist transaction must show
      // up in pg_locks as an UNGRANTED waiter on the holder's exact lock key
      // before the holder releases. Removing acquireCvcStructuralLock from
      // the persist path makes this wait never appear and the assertion fail.
      const deadline = Date.now() + 15_000;
      let waiting = false;
      while (Date.now() < deadline && !waiting) {
        const rows = await attacker.$queryRaw<{ count: bigint }[]>`
          SELECT count(*)::bigint AS count FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND classid = ${lockIdentity.classid} AND objid = ${lockIdentity.objid}
            AND objsubid = ${lockIdentity.objsubid}
        `;
        waiting = Number(rows[0].count) > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(waiting).toBe(true);

      holderReleasedAt = Date.now();
      releaseHold();
      await holder;

      const { result, settledAfterRelease } = await ingest;
      expect(result.kind).toBe('success');
      expect(settledAfterRelease).toBe(true);
    } finally {
      // A failed wait must still release the holder, or the open transaction
      // and pending ingest sit on their timeouts and bury the real failure.
      releaseHold();
    }
  });
});
