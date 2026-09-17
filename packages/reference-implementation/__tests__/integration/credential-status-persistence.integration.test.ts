import {
  AdapterType,
  CredentialStatusCapture,
  CredentialStatusProvenance,
  ServiceType,
} from '../../src/lib/prisma/generated/index.js';
import type { CanonicalCredentialStatusEntry } from '@uncefact/untp-ri-services';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import {
  createCredentialStatusEntries,
  clearPendingIntent,
  countPendingEntriesForInstance,
  finaliseStatusChange,
  getCredentialStatusEntry,
  listCredentialStatusEntries,
  persistObservationWithoutPending,
  readPendingToken,
  recordAcceptedReplacementDigest,
  reserveStatusChange,
  type CreateCredentialStatusEntryInput,
  type CreateCredentialStatusEntriesOutcome,
} from '../../src/lib/prisma/repositories/credential-status-entry.repository';
import {
  CredentialStatusCaptureInvariantError,
  createCredential,
  deleteNativeCredential,
  updateCredentialStatusCapture,
} from '../../src/lib/prisma/repositories/credential.repository';
import {
  deleteServiceInstance,
  lockServiceInstanceForUpdate,
  updateServiceInstance,
} from '../../src/lib/prisma/repositories/service-instance.repository';
import { lockLibraryRecordForUpdate } from '../../src/lib/prisma/repositories/library-record.repository';
import { ServiceInstanceStatusPendingError } from '../../src/lib/api/errors';

const OTHER_TENANT_ID = 'credential-status-other';
const INSTANCE_ID = 'credential-status-vc-instance';
const OTHER_INSTANCE_ID = 'credential-status-vc-other';

const REVOCATION_ENTRY: CanonicalCredentialStatusEntry = {
  id: 'https://issuer.example/status/1#0',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '0',
};

const SUSPENSION_ENTRY: CanonicalCredentialStatusEntry = {
  id: 'https://issuer.example/status/1#1',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'suspension',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '1',
};

const REVOCATION_DESCRIPTOR: CreateCredentialStatusEntryInput = {
  canonical: REVOCATION_ENTRY,
  wire: {
    ...REVOCATION_ENTRY,
    statusSize: 1,
    statusReference: ['https://issuer.example/status/1/reference'],
    retainedByIssuer: true,
  },
  statusListVcIssuer: 'did:web:issuer.example',
  provenance: CredentialStatusProvenance.ISSUANCE,
};

const SUSPENSION_DESCRIPTOR: CreateCredentialStatusEntryInput = {
  canonical: SUSPENSION_ENTRY,
  wire: { ...SUSPENSION_ENTRY },
  statusListVcIssuer: 'did:web:issuer.example',
  provenance: CredentialStatusProvenance.ISSUANCE,
};

const client = createRigClient();

beforeAll(async () => {
  await client.$connect();
});

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  await client.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other tenant' } });
  await client.serviceInstance.create({
    data: {
      id: INSTANCE_ID,
      tenantId: SYSTEM_TENANT_ID,
      serviceType: ServiceType.VC,
      adapterType: AdapterType.VCKIT,
      name: 'Credential status test VC',
      config: 'encrypted-test-config',
      isPrimary: false,
    },
  });
  await client.serviceInstance.create({
    data: {
      id: OTHER_INSTANCE_ID,
      tenantId: OTHER_TENANT_ID,
      serviceType: ServiceType.VC,
      adapterType: AdapterType.VCKIT,
      name: 'Other tenant credential status test VC',
      config: 'encrypted-other-test-config',
      isPrimary: false,
    },
  });
});

afterAll(async () => {
  await client.$disconnect();
});

async function nativeCredential(id: string, tenantId = SYSTEM_TENANT_ID): Promise<void> {
  await insertNativeCredential(client, { id, tenantId });
}

async function createEntries(
  credentialId: string,
  entries = [REVOCATION_DESCRIPTOR],
  tenantId = SYSTEM_TENANT_ID,
): Promise<CreateCredentialStatusEntriesOutcome> {
  return client.$transaction((tx) =>
    createCredentialStatusEntries(tx, {
      credentialId,
      tenantId,
      entries,
    }),
  );
}

describe('credential status persistence', () => {
  it('proves the Credential.statusCapture column default on insert and passes issuance attribution fields through', async () => {
    await nativeCredential('migration-default');
    const defaultRow = await client.credential.findUniqueOrThrow({ where: { id: 'migration-default' } });
    expect(defaultRow.statusCapture).toBe(CredentialStatusCapture.PENDING);
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'migration-default' } })).toBe(0);

    const attributed = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.example/attributed',
      digestMultibase: 'zattributed',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.7.0',
      vcServiceInstanceId: INSTANCE_ID,
      vcServiceAttribution: 'ISSUANCE',
      vcServiceAttributedAt: new Date('2026-09-16T00:00:00.000Z'),
      statusCapture: CredentialStatusCapture.CAPTURED,
      statusCapturedAt: new Date('2026-09-16T00:00:01.000Z'),
    });
    expect(attributed.credential.vcServiceInstanceId).toBe(INSTANCE_ID);
    expect(await client.credential.findUniqueOrThrow({ where: { id: attributed.credential.id } })).toMatchObject({
      vcServiceAttribution: 'ISSUANCE',
      statusCapture: 'CAPTURED',
      statusCaptureError: null,
    });
  });

  it('proves an old raw Credential insert receives PENDING from the new column default', async () => {
    const createdAt = new Date('2026-09-16T00:00:00.000Z');
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "LibraryRecord" ("id", "tenantId", "origin", "credentialType", "createdAt", "updatedAt")
        VALUES (${'raw-default'}, ${SYSTEM_TENANT_ID}, 'NATIVE', 'DigitalProductPassport', ${createdAt}, ${createdAt})
      `;
      await tx.$executeRaw`
        INSERT INTO "Credential" ("id", "tenantId", "storageUri", "digestMultibase", "createdAt", "updatedAt")
        VALUES (${'raw-default'}, ${SYSTEM_TENANT_ID}, 'https://storage.test/raw-default', 'zraw-default', ${createdAt}, ${createdAt})
      `;
    });

    await expect(client.credential.findUniqueOrThrow({ where: { id: 'raw-default' } })).resolves.toMatchObject({
      statusCapture: CredentialStatusCapture.PENDING,
    });
  });

  it('rejects a partial pending intent written directly through SQL', async () => {
    await nativeCredential('pending-check');
    await createEntries('pending-check');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'pending-check', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    await expect(
      client.$executeRaw`
        UPDATE "CredentialStatusEntry"
           SET "pendingToken" = ${'only-token'}
         WHERE "id" = ${entry.id}
      `,
    ).rejects.toThrow(/pending_intent_all_or_none_check/);
  });

  it('rejects an accepted replacement digest without a pending intent', async () => {
    await nativeCredential('replacement-digest-check');
    await createEntries('replacement-digest-check');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'replacement-digest-check', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    await expect(
      client.$executeRaw`
        UPDATE "CredentialStatusEntry"
           SET "acceptedReplacementDigest" = ${'replacement-digest'}
         WHERE "id" = ${entry.id}
           AND "pendingToken" IS NULL
      `,
    ).rejects.toThrow(/accepted_replacement_requires_pending_che/);
  });

  it('captures canonical coordinates and the untouched descriptor, and rejects duplicate purposes atomically', async () => {
    await nativeCredential('capture-1');
    await expect(
      client.$transaction((tx) =>
        createCredentialStatusEntries(tx, {
          credentialId: 'capture-1',
          tenantId: SYSTEM_TENANT_ID,
          entries: [],
        }),
      ),
    ).resolves.toEqual({ outcome: 'created', count: 0 });
    await createEntries('capture-1', [REVOCATION_DESCRIPTOR, SUSPENSION_DESCRIPTOR]);

    await expect(
      client.$transaction((tx) => listCredentialStatusEntries(tx, 'capture-1', SYSTEM_TENANT_ID)),
    ).resolves.toHaveLength(2);

    const rows = await client.credentialStatusEntry.findMany({
      where: { credentialId: 'capture-1', tenantId: SYSTEM_TENANT_ID },
      orderBy: { statusPurpose: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      originalId: 'https://issuer.example/status/1#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '0',
      statusListVcIssuer: 'did:web:issuer.example',
      value: null,
      version: 1,
      provenance: CredentialStatusProvenance.ISSUANCE,
      descriptor: { statusSize: 1, retainedByIssuer: true },
    });

    await expect(
      client.$transaction((tx) =>
        createCredentialStatusEntries(tx, {
          credentialId: 'capture-1',
          tenantId: SYSTEM_TENANT_ID,
          entries: [REVOCATION_DESCRIPTOR, { ...REVOCATION_DESCRIPTOR }],
        }),
      ),
    ).resolves.toEqual({ outcome: 'duplicate_purpose', purpose: 'revocation' });
    await expect(createEntries('capture-1')).resolves.toEqual({ outcome: 'duplicate_purpose', purpose: 'revocation' });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'capture-1' } })).toBe(2);
  });

  it('rejects a non-object wire descriptor instead of coercing it through JSON', async () => {
    await nativeCredential('descriptor-shape');
    const invalidDescriptor: CreateCredentialStatusEntryInput = {
      ...REVOCATION_DESCRIPTOR,
      wire: [] as unknown as CreateCredentialStatusEntryInput['wire'],
    };

    await expect(createEntries('descriptor-shape', [invalidDescriptor])).rejects.toThrow(
      'credential status wire descriptor must be a plain JSON object',
    );
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'descriptor-shape' } })).toBe(0);
  });

  it('reports the first existing purpose when a concurrent two-entry insert collides on its second entry', async () => {
    await nativeCredential('duplicate-purpose-race');
    const second = createRigClient();
    await second.$connect();
    let releaseExisting!: () => void;
    const existingRelease = new Promise<void>((resolve) => {
      releaseExisting = resolve;
    });
    let existingCreatedResolve!: () => void;
    const existingCreated = new Promise<void>((resolve) => {
      existingCreatedResolve = resolve;
    });
    const existingWriter = second.$transaction(async (tx) => {
      await tx.credentialStatusEntry.create({
        data: {
          id: 'duplicate-purpose-existing',
          credentialId: 'duplicate-purpose-race',
          tenantId: SYSTEM_TENANT_ID,
          originalId: SUSPENSION_ENTRY.id,
          type: SUSPENSION_ENTRY.type,
          statusPurpose: SUSPENSION_ENTRY.statusPurpose,
          statusListCredential: SUSPENSION_ENTRY.statusListCredential,
          statusListIndex: SUSPENSION_ENTRY.statusListIndex,
          statusListVcIssuer: 'did:web:issuer.example',
          descriptor: JSON.parse(JSON.stringify(SUSPENSION_DESCRIPTOR.wire)),
          provenance: CredentialStatusProvenance.ISSUANCE,
        },
      });
      existingCreatedResolve();
      await existingRelease;
    });
    let insertion: Promise<unknown> | undefined;

    try {
      await existingCreated;
      let insertionSettled = false;
      insertion = client
        .$transaction((tx) =>
          createCredentialStatusEntries(tx, {
            credentialId: 'duplicate-purpose-race',
            tenantId: SYSTEM_TENANT_ID,
            entries: [REVOCATION_DESCRIPTOR, SUSPENSION_DESCRIPTOR],
          }),
        )
        .then((outcome) => {
          insertionSettled = true;
          return outcome;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(insertionSettled).toBe(false);
      releaseExisting();
      await expect(Promise.all([existingWriter, insertion])).resolves.toEqual([
        undefined,
        { outcome: 'duplicate_purpose', purpose: 'suspension' },
      ]);
      expect(await client.credentialStatusEntry.count({ where: { credentialId: 'duplicate-purpose-race' } })).toBe(1);
    } finally {
      releaseExisting();
      await Promise.allSettled([existingWriter, insertion]);
      await second.$disconnect();
    }
  });

  it('uses row counts for reservation, expiry, version conflict and token-fenced finalisation', async () => {
    await nativeCredential('reservation-1');
    await createEntries('reservation-1');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'reservation-1', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    const wrongNodeClock = jest.spyOn(Date, 'now').mockReturnValue(new Date('2000-01-01T00:00:00.000Z').getTime());
    let reservationOutcome: Awaited<ReturnType<typeof reserveStatusChange>>;
    try {
      reservationOutcome = await client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'digest-1',
          token: 't1',
        }),
      );
    } finally {
      wrongNodeClock.mockRestore();
    }
    expect(reservationOutcome).toMatchObject({ outcome: 'reserved' });
    if (typeof reservationOutcome === 'string') throw new Error('expected a reservation outcome');
    expect(reservationOutcome.pendingSince.getTime()).toBeGreaterThan(new Date('2025-01-01T00:00:00.000Z').getTime());
    expect(reservationOutcome.pendingDeadline.getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00.000Z').getTime(),
    );
    const reservation = await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reservation.pendingSince).not.toBeNull();
    expect(reservation.pendingDeadline).not.toBeNull();
    expect(reservation.pendingDeadline!.getTime() - reservation.pendingSince!.getTime()).toBeGreaterThanOrEqual(59_000);
    expect(reservation.pendingDeadline!.getTime() - reservation.pendingSince!.getTime()).toBeLessThanOrEqual(61_000);
    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: false,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'digest-1',
          token: 't2',
        }),
      ),
    ).resolves.toBe('pending_exists');

    await client.credentialStatusEntry.update({
      where: { id: entry.id },
      data: { pendingDeadline: new Date(Date.now() - 1_000) },
    });
    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: false,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'digest-1',
          token: 't2',
        }),
      ),
    ).resolves.toBe('pending_expired');
    expect(await client.$transaction((tx) => readPendingToken(tx, entry.id, SYSTEM_TENANT_ID))).toBe('t1');
    const parentBeforeFinalise = await client.libraryRecord.findUniqueOrThrow({ where: { id: 'reservation-1' } });

    await expect(
      client.$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          token: 'wrong-token',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:01:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('token_mismatch');
    expect(await client.$transaction((tx) => readPendingToken(tx, entry.id, SYSTEM_TENANT_ID))).toBe('t1');

    await expect(
      client.$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          token: 't1',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:02:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('finalised');
    const finalised = await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(finalised).toMatchObject({ value: true, version: 2, pendingToken: null, pendingInstanceId: null });
    expect(finalised.valueChangedAt).toEqual(new Date('2026-09-16T00:02:00.000Z'));
    const parentAfterFinalise = await client.libraryRecord.findUniqueOrThrow({ where: { id: 'reservation-1' } });
    expect(parentAfterFinalise.updatedAt.getTime()).toBeGreaterThan(parentBeforeFinalise.updatedAt.getTime());
    expect(parentAfterFinalise.updatedAt).not.toEqual(new Date('2026-09-16T00:02:00.000Z'));
    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'reservation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: false,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'digest-1',
          token: 't3',
        }),
      ),
    ).resolves.toBe('version_conflict');
  });

  it('persists an observation only while unreserved and records replacement digests on all pinned entries', async () => {
    await nativeCredential('observation-1');
    await createEntries('observation-1', [REVOCATION_DESCRIPTOR, SUSPENSION_DESCRIPTOR]);
    const entries = await client.credentialStatusEntry.findMany({ where: { credentialId: 'observation-1' } });
    for (const [index, entry] of entries.entries()) {
      await client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'observation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: index === 0,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'old-digest',
          token: `observation-token-${index}`,
        }),
      );
    }
    expect(await client.$transaction((tx) => countPendingEntriesForInstance(tx, INSTANCE_ID, SYSTEM_TENANT_ID))).toBe(
      2,
    );
    await expect(
      client.$transaction((tx) =>
        recordAcceptedReplacementDigest(tx, {
          instanceId: INSTANCE_ID,
          tenantId: SYSTEM_TENANT_ID,
          digest: 'replacement-digest',
        }),
      ),
    ).resolves.toEqual({ outcome: 'live_reservation', live: 2 });
    await client.credentialStatusEntry.updateMany({
      where: { credentialId: 'observation-1' },
      data: { pendingDeadline: new Date('2026-09-15T00:00:00.000Z') },
    });
    await expect(
      client.$transaction((tx) =>
        recordAcceptedReplacementDigest(tx, {
          instanceId: INSTANCE_ID,
          tenantId: SYSTEM_TENANT_ID,
          digest: 'replacement-digest',
        }),
      ),
    ).resolves.toEqual({ outcome: 'recorded', updated: 2 });
    expect(
      await client.credentialStatusEntry.findMany({
        where: { credentialId: 'observation-1' },
        select: { acceptedReplacementDigest: true },
      }),
    ).toEqual([
      { acceptedReplacementDigest: 'replacement-digest' },
      { acceptedReplacementDigest: 'replacement-digest' },
    ]);

    const first = entries[0];
    await client.$transaction((tx) =>
      finaliseStatusChange(tx, {
        entryId: first.id,
        credentialId: 'observation-1',
        tenantId: SYSTEM_TENANT_ID,
        token: 'observation-token-0',
        expectedVersion: 1,
        value: true,
        observedAt: new Date('2026-09-16T00:03:00.000Z'),
        instanceId: INSTANCE_ID,
      }),
    );
    await expect(
      client.$transaction((tx) =>
        persistObservationWithoutPending(tx, {
          entryId: first.id,
          credentialId: 'observation-1',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 2,
          value: true,
          observedAt: new Date('2026-09-16T00:04:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('persisted');
    expect(await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      value: true,
      version: 3,
      pendingToken: null,
    });
    expect((await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: first.id } })).valueChangedAt).toEqual(
      new Date('2026-09-16T00:03:00.000Z'),
    );
  });

  it('returns missing for every conditional status operation when its classifier cannot read the row', async () => {
    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: 'missing-entry',
          credentialId: 'missing-credential',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'missing-digest',
          token: 'missing-token',
        }),
      ),
    ).resolves.toBe('missing');
    await expect(
      client.$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: 'missing-entry',
          credentialId: 'missing-credential',
          tenantId: SYSTEM_TENANT_ID,
          token: 'missing-token',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:07:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('missing');
    await expect(
      client.$transaction((tx) =>
        persistObservationWithoutPending(tx, {
          entryId: 'missing-entry',
          credentialId: 'missing-credential',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:08:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('missing');
    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: 'missing-entry',
          credentialId: 'missing-credential',
          tenantId: SYSTEM_TENANT_ID,
          token: 'missing-token',
        }),
      ),
    ).resolves.toBe('missing');
  });

  it('classifies clear races as token mismatch, already cleared or missing', async () => {
    await nativeCredential('clear-outcomes');
    await createEntries('clear-outcomes');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'clear-outcomes', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: entry.id,
        credentialId: 'clear-outcomes',
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'clear-digest',
        token: 'clear-token',
      }),
    );
    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: entry.id,
          credentialId: 'clear-outcomes',
          tenantId: SYSTEM_TENANT_ID,
          token: 'wrong-token',
        }),
      ),
    ).resolves.toBe('token_mismatch');
    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: entry.id,
          credentialId: 'clear-outcomes',
          tenantId: SYSTEM_TENANT_ID,
          token: 'clear-token',
        }),
      ),
    ).resolves.toBe('cleared');
    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: entry.id,
          credentialId: 'clear-outcomes',
          tenantId: SYSTEM_TENANT_ID,
          token: 'clear-token',
        }),
      ),
    ).resolves.toBe('already_cleared');
    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: 'absent-entry',
          credentialId: 'clear-outcomes',
          tenantId: SYSTEM_TENANT_ID,
          token: 'clear-token',
        }),
      ),
    ).resolves.toBe('missing');
  });

  it('refuses repository deletion while a status change is pending', async () => {
    await nativeCredential('delete-pending');
    await createEntries('delete-pending', [REVOCATION_DESCRIPTOR, SUSPENSION_DESCRIPTOR]);
    const entries = await client.credentialStatusEntry.findMany({
      where: { credentialId: 'delete-pending' },
      orderBy: { statusPurpose: 'asc' },
    });
    expect(entries).toHaveLength(2);
    for (const [index, entry] of entries.entries()) {
      await client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'delete-pending',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'delete-digest',
          token: `delete-token-${index}`,
        }),
      );
    }

    await expect(deleteNativeCredential({ recordId: 'delete-pending', tenantId: SYSTEM_TENANT_ID })).resolves.toEqual({
      outcome: 'status_change_pending',
      statusPurposes: ['revocation', 'suspension'],
    });
  });

  it('database trigger refuses direct credential deletion while pending and cascades completed entries', async () => {
    await nativeCredential('delete-pending');
    await createEntries('delete-pending');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'delete-pending', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: entry.id,
        credentialId: 'delete-pending',
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'delete-digest',
        token: 'delete-token',
      }),
    );

    await expect(
      client.$executeRaw`DELETE FROM "Credential" WHERE "id" = ${'delete-pending'} AND "tenantId" = ${SYSTEM_TENANT_ID}`,
    ).rejects.toThrow(/delete-pending.*revocation/);

    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: entry.id,
          credentialId: 'delete-pending',
          tenantId: SYSTEM_TENANT_ID,
          token: 'delete-token',
        }),
      ),
    ).resolves.toBe('cleared');
    await client.libraryRecord.delete({ where: { id: 'delete-pending' } });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'delete-pending' } })).toBe(0);
    expect(await client.credential.count({ where: { id: 'delete-pending' } })).toBe(0);
  });

  it('keeps a second tenant from reading or writing the first tenant entry', async () => {
    await nativeCredential('tenant-isolation', SYSTEM_TENANT_ID);
    await createEntries('tenant-isolation');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'tenant-isolation', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    expect(
      await client.$transaction((tx) =>
        getCredentialStatusEntry(tx, 'tenant-isolation', OTHER_TENANT_ID, 'revocation'),
      ),
    ).toBeNull();
    expect(await client.$transaction((tx) => readPendingToken(tx, entry.id, OTHER_TENANT_ID))).toBeNull();
    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'tenant-isolation',
          tenantId: OTHER_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'foreign-digest',
          token: 'foreign-token',
        }),
      ),
    ).resolves.toBe('missing');
    expect(await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
      value: null,
      pendingToken: null,
      version: 1,
    });

    await expect(
      client.$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'tenant-isolation',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'system-digest',
          token: 'system-token',
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'reserved' });

    // A token from the first tenant is a missing row to the second tenant's
    // classifier, while the owning tenant remains a valid control.
    await expect(
      client.$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'tenant-isolation',
          tenantId: OTHER_TENANT_ID,
          token: 'system-token',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:05:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('missing');
    expect(await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
      value: null,
      pendingToken: 'system-token',
      version: 1,
    });
    await expect(
      client.$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'tenant-isolation',
          tenantId: SYSTEM_TENANT_ID,
          token: 'system-token',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:06:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      ),
    ).resolves.toBe('finalised');
  });

  it('scopes tenant-owned instance writes to entry tenants while system instances span tenants', async () => {
    await nativeCredential('tenant-owned-entry', OTHER_TENANT_ID);
    await createEntries('tenant-owned-entry', [REVOCATION_DESCRIPTOR], OTHER_TENANT_ID);
    const tenantEntry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'tenant-owned-entry', OTHER_TENANT_ID, 'revocation'),
    );
    if (tenantEntry === null) throw new Error('expected the other tenant status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: tenantEntry.id,
        credentialId: 'tenant-owned-entry',
        tenantId: OTHER_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: OTHER_INSTANCE_ID,
        configDigest: 'other-tenant-digest',
        token: 'other-tenant-token',
      }),
    );
    expect(
      await client.$transaction((tx) => countPendingEntriesForInstance(tx, OTHER_INSTANCE_ID, SYSTEM_TENANT_ID)),
    ).toBe(0);
    expect(
      await client.$transaction((tx) => countPendingEntriesForInstance(tx, OTHER_INSTANCE_ID, OTHER_TENANT_ID)),
    ).toBe(1);
    await expect(
      client.$transaction((tx) =>
        recordAcceptedReplacementDigest(tx, {
          instanceId: OTHER_INSTANCE_ID,
          tenantId: SYSTEM_TENANT_ID,
          digest: 'wrong-tenant-digest',
        }),
      ),
    ).resolves.toEqual({ outcome: 'recorded', updated: 0 });
    await expect(
      client.$transaction((tx) =>
        recordAcceptedReplacementDigest(tx, {
          instanceId: OTHER_INSTANCE_ID,
          tenantId: OTHER_TENANT_ID,
          digest: 'other-tenant-digest',
        }),
      ),
    ).resolves.toEqual({ outcome: 'live_reservation', live: 1 });

    await nativeCredential('system-entry-other-tenant', OTHER_TENANT_ID);
    await createEntries('system-entry-other-tenant', [REVOCATION_DESCRIPTOR], OTHER_TENANT_ID);
    const systemEntry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'system-entry-other-tenant', OTHER_TENANT_ID, 'revocation'),
    );
    if (systemEntry === null) throw new Error('expected the system-pinned status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: systemEntry.id,
        credentialId: 'system-entry-other-tenant',
        tenantId: OTHER_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'system-entry-digest',
        token: 'system-entry-token',
      }),
    );
    await client.credentialStatusEntry.update({
      where: { id: systemEntry.id },
      data: { pendingDeadline: new Date('2026-09-15T00:00:00.000Z') },
    });
    expect(await client.$transaction((tx) => countPendingEntriesForInstance(tx, INSTANCE_ID, SYSTEM_TENANT_ID))).toBe(
      1,
    );
    expect(await client.$transaction((tx) => countPendingEntriesForInstance(tx, INSTANCE_ID, OTHER_TENANT_ID))).toBe(1);
    await expect(
      client.$transaction((tx) =>
        recordAcceptedReplacementDigest(tx, {
          instanceId: INSTANCE_ID,
          tenantId: SYSTEM_TENANT_ID,
          digest: 'system-replacement-digest',
        }),
      ),
    ).resolves.toEqual({ outcome: 'recorded', updated: 1 });
  });

  it('blocks configuration and deletion while pinned but allows name and description PATCHes', async () => {
    await nativeCredential('service-guard');
    await createEntries('service-guard');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'service-guard', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: entry.id,
        credentialId: 'service-guard',
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'guard-digest',
        token: 'guard-token',
      }),
    );

    await expect(
      updateServiceInstance(INSTANCE_ID, SYSTEM_TENANT_ID, { name: 'metadata-only name' }),
    ).resolves.toMatchObject({
      name: 'metadata-only name',
    });
    await expect(
      updateServiceInstance(INSTANCE_ID, SYSTEM_TENANT_ID, { description: 'metadata-only description' }),
    ).resolves.toMatchObject({ description: 'metadata-only description' });
    await expect(
      updateServiceInstance(INSTANCE_ID, SYSTEM_TENANT_ID, { config: 'changed-config' }),
    ).rejects.toBeInstanceOf(ServiceInstanceStatusPendingError);
    await expect(deleteServiceInstance(INSTANCE_ID, SYSTEM_TENANT_ID)).rejects.toBeInstanceOf(
      ServiceInstanceStatusPendingError,
    );
    expect(await client.serviceInstance.findUniqueOrThrow({ where: { id: INSTANCE_ID } })).toMatchObject({
      config: 'encrypted-test-config',
    });

    await expect(
      client.$transaction((tx) =>
        clearPendingIntent(tx, {
          entryId: entry.id,
          credentialId: 'service-guard',
          tenantId: SYSTEM_TENANT_ID,
          token: 'guard-token',
        }),
      ),
    ).resolves.toBe('cleared');
    await expect(
      updateServiceInstance(INSTANCE_ID, SYSTEM_TENANT_ID, { config: 'changed-config' }),
    ).resolves.toMatchObject({
      config: 'changed-config',
    });
  });

  it('blocks a reservation behind the instance guard so the guard count is race-free', async () => {
    await nativeCredential('guard-race');
    await createEntries('guard-race');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'guard-race', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    const second = createRigClient();
    await second.$connect();
    let releaseGuard!: () => void;
    const guardRelease = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });
    let guardLockedResolve!: () => void;
    const guardLocked = new Promise<void>((resolve) => {
      guardLockedResolve = resolve;
    });
    let guardCount!: number;
    const guard = client.$transaction(async (tx) => {
      expect(await lockServiceInstanceForUpdate(tx, INSTANCE_ID, SYSTEM_TENANT_ID)).toBe(true);
      guardCount = await countPendingEntriesForInstance(tx, INSTANCE_ID, SYSTEM_TENANT_ID);
      guardLockedResolve();
      await guardRelease;
      return guardCount;
    });

    let reservationSettled = false;
    const reservation = second
      .$transaction((tx) =>
        reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'guard-race',
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: INSTANCE_ID,
          configDigest: 'guard-race-digest',
          token: 'guard-race-token',
        }),
      )
      .then((outcome) => {
        reservationSettled = true;
        return outcome;
      });

    try {
      await guardLocked;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(guardCount).toBe(0);
      expect(reservationSettled).toBe(false);
      releaseGuard();
      await expect(Promise.all([guard, reservation])).resolves.toEqual([
        0,
        expect.objectContaining({ outcome: 'reserved' }),
      ]);
    } finally {
      releaseGuard();
      await Promise.allSettled([guard, reservation]);
      await second.$disconnect();
    }
  });

  it('has no service-to-parent deadlock edge when a parent-first writer waits for the service row', async () => {
    await nativeCredential('lock-order');
    await createEntries('lock-order');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'lock-order', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: entry.id,
        credentialId: 'lock-order',
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'lock-digest',
        token: 'lock-token',
      }),
    );

    const second = createRigClient();
    await second.$connect();
    let serviceLockedResolve!: () => void;
    let parentLockedResolve!: () => void;
    const serviceLocked = new Promise<void>((resolve) => {
      serviceLockedResolve = resolve;
    });
    const parentLocked = new Promise<void>((resolve) => {
      parentLockedResolve = resolve;
    });

    const serviceFirst = client.$transaction(async (tx) => {
      expect(await lockServiceInstanceForUpdate(tx, INSTANCE_ID, SYSTEM_TENANT_ID)).toBe(true);
      serviceLockedResolve();
      await parentLocked;
      return countPendingEntriesForInstance(tx, INSTANCE_ID, SYSTEM_TENANT_ID);
    });
    const parentFirst = second.$transaction(async (tx) => {
      await serviceLocked;
      expect(await lockLibraryRecordForUpdate(tx, 'lock-order', SYSTEM_TENANT_ID)).toBe(true);
      parentLockedResolve();
      expect(await lockServiceInstanceForUpdate(tx, INSTANCE_ID, SYSTEM_TENANT_ID)).toBe(true);
    });

    await expect(
      Promise.race([
        Promise.all([serviceFirst, parentFirst]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('lock-order test timed out')), 4_000)),
      ]),
    ).resolves.toEqual([1, undefined]);
    await second.$disconnect();
  });

  it('blocks a concurrent service-instance lock and does not lock a foreign tenant row', async () => {
    const second = createRigClient();
    await second.$connect();
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstLockedResolve!: () => void;
    const firstLocked = new Promise<void>((resolve) => {
      firstLockedResolve = resolve;
    });
    const first = client.$transaction(async (tx) => {
      expect(await lockServiceInstanceForUpdate(tx, INSTANCE_ID, SYSTEM_TENANT_ID)).toBe(true);
      firstLockedResolve();
      await firstReleased;
    });
    await firstLocked;
    let secondSettled = false;
    const secondLock = second
      .$transaction((tx) => lockServiceInstanceForUpdate(tx, INSTANCE_ID, SYSTEM_TENANT_ID))
      .then((locked) => {
        secondSettled = true;
        return locked;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondSettled).toBe(false);
    releaseFirst();
    await expect(Promise.all([first, secondLock])).resolves.toEqual([undefined, true]);
    await expect(
      second.$transaction((tx) => lockServiceInstanceForUpdate(tx, INSTANCE_ID, OTHER_TENANT_ID)),
    ).resolves.toBe(false);
    await second.$disconnect();
  });

  it('waits for the parent lock before finalising a child status entry', async () => {
    await nativeCredential('parent-lock-order');
    await createEntries('parent-lock-order');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'parent-lock-order', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');
    await client.$transaction((tx) =>
      reserveStatusChange(tx, {
        entryId: entry.id,
        credentialId: 'parent-lock-order',
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 1,
        value: true,
        budgetMs: 60_000,
        instanceId: INSTANCE_ID,
        configDigest: 'parent-lock-digest',
        token: 'parent-lock-token',
      }),
    );

    const second = createRigClient();
    await second.$connect();
    let releaseParent!: () => void;
    const parentRelease = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    let parentLockedResolve!: () => void;
    const parentLocked = new Promise<void>((resolve) => {
      parentLockedResolve = resolve;
    });
    const deleteLikeWriter = client.$transaction(async (tx) => {
      expect(await lockLibraryRecordForUpdate(tx, 'parent-lock-order', SYSTEM_TENANT_ID)).toBe(true);
      parentLockedResolve();
      await parentRelease;
    });
    await parentLocked;
    let finaliseSettled = false;
    const finalise = second
      .$transaction((tx) =>
        finaliseStatusChange(tx, {
          entryId: entry.id,
          credentialId: 'parent-lock-order',
          tenantId: SYSTEM_TENANT_ID,
          token: 'parent-lock-token',
          expectedVersion: 1,
          value: true,
          observedAt: new Date('2026-09-16T00:10:00.000Z'),
          instanceId: INSTANCE_ID,
        }),
      )
      .then((outcome) => {
        finaliseSettled = true;
        return outcome;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(finaliseSettled).toBe(false);
    releaseParent();
    await expect(Promise.all([deleteLikeWriter, finalise])).resolves.toEqual([undefined, 'finalised']);
    await second.$disconnect();
  });

  it('waits for the parent lock before reserving a child status entry', async () => {
    await nativeCredential('parent-lock-reservation');
    await createEntries('parent-lock-reservation');
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, 'parent-lock-reservation', SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    const second = createRigClient();
    await second.$connect();
    let releaseParent!: () => void;
    const parentRelease = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    let parentLockedResolve!: () => void;
    const parentLocked = new Promise<void>((resolve) => {
      parentLockedResolve = resolve;
    });
    const parentWriter = client.$transaction(async (tx) => {
      expect(await lockLibraryRecordForUpdate(tx, 'parent-lock-reservation', SYSTEM_TENANT_ID)).toBe(true);
      parentLockedResolve();
      await parentRelease;
    });
    let reservation: Promise<unknown> | undefined;

    try {
      await parentLocked;
      let reservationSettled = false;
      reservation = second
        .$transaction((tx) =>
          reserveStatusChange(tx, {
            entryId: entry.id,
            credentialId: 'parent-lock-reservation',
            tenantId: SYSTEM_TENANT_ID,
            expectedVersion: 1,
            value: true,
            budgetMs: 60_000,
            instanceId: INSTANCE_ID,
            configDigest: 'parent-lock-reservation-digest',
            token: 'parent-lock-reservation-token',
          }),
        )
        .then((outcome) => {
          reservationSettled = true;
          return outcome;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(reservationSettled).toBe(false);
      releaseParent();
      await expect(Promise.all([parentWriter, reservation])).resolves.toEqual([
        undefined,
        expect.objectContaining({ outcome: 'reserved' }),
      ]);
    } finally {
      releaseParent();
      await Promise.allSettled([parentWriter, reservation]);
      await second.$disconnect();
    }
  });

  it('conditionally advances capture state and reports a lost state race', async () => {
    await nativeCredential('capture-state');
    await expect(
      client.$transaction((tx) =>
        updateCredentialStatusCapture(tx, {
          credentialId: 'capture-state',
          tenantId: SYSTEM_TENANT_ID,
          expectedStatus: CredentialStatusCapture.PENDING,
          statusCapture: CredentialStatusCapture.CAPTURED,
          statusCapturedAt: new Date('2026-09-16T00:05:00.000Z'),
        }),
      ),
    ).resolves.toBe('updated');
    await expect(
      client.$transaction((tx) =>
        updateCredentialStatusCapture(tx, {
          credentialId: 'capture-state',
          tenantId: SYSTEM_TENANT_ID,
          expectedStatus: CredentialStatusCapture.PENDING,
          statusCapture: CredentialStatusCapture.FAILED,
          statusCaptureError: 'MALFORMED_ENTRY',
          statusCapturedAt: new Date('2026-09-16T00:06:00.000Z'),
        }),
      ),
    ).resolves.toBe('status_conflict');
    await expect(
      client.$transaction((tx) =>
        updateCredentialStatusCapture(tx, {
          credentialId: 'capture-state',
          tenantId: SYSTEM_TENANT_ID,
          expectedStatus: CredentialStatusCapture.FAILED,
          statusCapture: undefined,
        }),
      ),
    ).rejects.toBeInstanceOf(CredentialStatusCaptureInvariantError);
  });
});
