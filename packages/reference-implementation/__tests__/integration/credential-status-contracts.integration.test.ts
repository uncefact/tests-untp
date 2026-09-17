jest.unmock('jose');

const mockResolveVcService = jest.fn();
jest.mock('../../src/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));

import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CredentialStatusCapture,
  CredentialStatusProvenance,
  Prisma,
  VcServiceAttribution,
} from '../../src/lib/prisma/generated/index.js';
import { withStatusListMutex } from '../../src/lib/services/status-list-mutex';
import {
  backfillCredentialStatusEntries,
  credentialStatusBackfillExitCode,
} from '../../src/lib/credentials/backfill-credential-status-entries';
import { attributeCredentialStatusInstance } from '../../src/lib/credentials/attribute-credential-status-instance';
import { issueCredential } from '../../src/lib/credentials/issue-credential';
import {
  getCredentialStatusEntry,
  reserveStatusChange,
} from '../../src/lib/prisma/repositories/credential-status-entry.repository';
import { credentialDigestPreimage } from '../../src/lib/library/verify-generation-job';
import { createVerifierDouble } from './helpers/verifiable-credential-service-double';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';

const client = createRigClient();
const originalAcquireMs = process.env.STATUS_LOCK_ACQUIRE_MS;

function lockOptions(): { signal: AbortSignal; deadlineAt: number } {
  return { signal: new AbortController().signal, deadlineAt: Date.now() + 2_000 };
}

function envelopedCredential(
  statusListIndex = '3',
  statusPurposes: readonly string[] | undefined = ['revocation'],
  omitStatus = false,
): Record<string, unknown> {
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: { id: 'did:web:issuer.example' },
    credentialSubject: { id: 'https://example.com/subject' },
    ...(omitStatus || statusPurposes === undefined
      ? {}
      : {
          credentialStatus:
            statusPurposes.length === 1
              ? {
                  id: `https://status.example/list/1#${statusListIndex}`,
                  type: 'BitstringStatusListEntry',
                  statusPurpose: statusPurposes[0],
                  statusListCredential: 'https://status.example/list/1',
                  statusListIndex,
                  statusSize: 1,
                }
              : statusPurposes.map((statusPurpose, offset) => ({
                  id: `https://status.example/list/1#${Number(statusListIndex) + offset}`,
                  type: 'BitstringStatusListEntry',
                  statusPurpose,
                  statusListCredential: 'https://status.example/list/1',
                  statusListIndex: String(Number(statusListIndex) + offset),
                  statusSize: 1,
                })),
        }),
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'ES256', typ: 'vc+jwt' })}.${encode(payload)}.sig`;
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${jwt}`,
  };
}

async function storedCredential(
  statusPurposes: readonly string[] | null = ['revocation'],
): Promise<{ bytes: Uint8Array; digest: string }> {
  const credential = envelopedCredential('3', ['revocation'], statusPurposes === null);
  const bytes = new TextEncoder().encode(JSON.stringify(credential));
  const digest = (
    await MultibaseDigest.fromData(credentialDigestPreimage(credential), {
      algorithm: 'sha2-256',
      base: 'base58btc',
    })
  ).toString();
  return { bytes, digest };
}

async function issueThroughVerifier(statusPurposes: readonly ('revocation' | 'suspension')[] = ['revocation']) {
  const verifier = createVerifierDouble();
  jest.spyOn(verifier, 'sign').mockResolvedValue(envelopedCredential('3', statusPurposes) as never);
  return issueCredential({
    tenantId: SYSTEM_TENANT_ID,
    credentialPayload: { '@context': [], type: ['VerifiableCredential'], credentialSubject: {} } as never,
    credentialType: 'DigitalProductPassport',
    coreDataModelVersion: '0.6.0',
    refs: { organisations: [], facilities: [], products: [] },
    vcService: { service: verifier, instanceId: 'issuance-instance' },
    storageService: {
      service: {
        store: jest.fn().mockResolvedValue({
          uri: 'https://storage.test/issued-status-credential',
          digestMultibase: 'zissued-status-credential',
        }),
        storeBinary: jest.fn(),
        delete: jest.fn(),
      },
      instanceId: 'storage-instance',
    },
    storageOptions: { encrypt: false },
    bridge: { extractSubjectSummary: () => ({ id: undefined, name: undefined }) } as never,
    statusPurposes,
  });
}

async function markCaptured(id: string): Promise<void> {
  await client.credential.update({
    where: { id },
    data: { statusCapture: CredentialStatusCapture.CAPTURED, statusCapturedAt: new Date() },
  });
}

async function addStatusEntry(id: string, statusPurpose = 'revocation', statusListIndex = '3'): Promise<void> {
  await client.credentialStatusEntry.create({
    data: {
      credentialId: id,
      tenantId: SYSTEM_TENANT_ID,
      type: 'BitstringStatusListEntry',
      statusPurpose,
      statusListCredential: 'https://status.example/list/1',
      statusListIndex,
      statusListVcIssuer: 'did:web:issuer.example',
      descriptor: {
        id: `https://status.example/list/1#${statusListIndex}`,
        type: 'BitstringStatusListEntry',
        statusPurpose,
        statusListCredential: 'https://status.example/list/1',
        statusListIndex: Number(statusListIndex),
        statusSize: 1,
      },
      provenance: CredentialStatusProvenance.BACKFILL,
    },
  });
}

beforeAll(async () => {
  await client.$connect();
  process.env.STATUS_LOCK_ACQUIRE_MS = '2000';
  mockResolveVcService.mockResolvedValue({
    instanceId: 'attribution-instance',
    service: createVerifierDouble(),
  });
});

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
});

afterAll(async () => {
  await client.$disconnect();
  if (originalAcquireMs === undefined) delete process.env.STATUS_LOCK_ACQUIRE_MS;
  else process.env.STATUS_LOCK_ACQUIRE_MS = originalAcquireMs;
});

describe('Credential status Postgres contracts', () => {
  it('serialises one status-list key while allowing different keys to overlap', async () => {
    // Catches a regression that uses a session lock or conflates distinct issuer keys.
    let active = 0;
    let maximum = 0;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const hold = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return 'ok';
    };

    const sameKeyFirst = withStatusListMutex('adapter:issuer-a', hold, lockOptions());
    await firstEntered;
    const sameKeySecond = withStatusListMutex('adapter:issuer-a', hold, lockOptions());
    await Promise.all([sameKeyFirst, sameKeySecond]);
    expect(maximum).toBe(1);

    active = 0;
    maximum = 0;
    const differentKeys = await Promise.all([
      withStatusListMutex('adapter:issuer-b', hold, lockOptions()),
      withStatusListMutex('adapter:issuer-c', hold, lockOptions()),
    ]);
    expect(differentKeys).toEqual(['ok', 'ok']);
    expect(maximum).toBe(2);
  });

  it('releases the transaction-scoped lock when the callback throws', async () => {
    // Catches a regression from session-scoped advisory locking that leaks after callback failure.
    const callbackError = new Error('provider call failed');
    await expect(
      withStatusListMutex(
        'adapter:issuer-throw',
        async () => {
          throw callbackError;
        },
        lockOptions(),
      ),
    ).rejects.toBe(callbackError);

    const retries = await Promise.all([
      withStatusListMutex(
        'adapter:issuer-throw',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'released';
        },
        lockOptions(),
      ),
      withStatusListMutex(
        'adapter:issuer-throw',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'released';
        },
        lockOptions(),
      ),
    ]);
    expect(retries).toEqual(['released', 'released']);
  });

  it('persists the issued revocation entry with canonical and wire fields in one transaction', async () => {
    const issued = await issueThroughVerifier();

    const entries = await client.credentialStatusEntry.findMany({ where: { credentialId: issued.credentialId } });
    expect(issued.statusCaptureFailed).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      provenance: CredentialStatusProvenance.ISSUANCE,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListCredential: 'https://status.example/list/1',
      statusListIndex: '3',
      statusListVcIssuer: 'did:web:issuer.example',
      descriptor: {
        id: 'https://status.example/list/1#3',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListCredential: 'https://status.example/list/1',
        statusListIndex: '3',
        statusSize: 1,
      },
    });
  });

  it('persists one issuance entry for each explicitly requested purpose', async () => {
    const issued = await issueThroughVerifier(['revocation', 'suspension']);

    const entries = await client.credentialStatusEntry.findMany({
      where: { credentialId: issued.credentialId },
      orderBy: { statusPurpose: 'asc' },
    });
    expect(issued.statusCaptureFailed).toBe(false);
    expect(entries.map((entry) => [entry.statusPurpose, entry.statusListIndex, entry.provenance])).toEqual([
      ['revocation', '3', CredentialStatusProvenance.ISSUANCE],
      ['suspension', '4', CredentialStatusProvenance.ISSUANCE],
    ]);
  });

  it('retries a classified failure, converges on a second run, and reports a concurrent write race', async () => {
    const { bytes, digest } = await storedCredential();
    await insertNativeCredential(client, {
      id: 'status-backfill-retry',
      storageUri: 'https://storage.test/status-retry',
      digestMultibase: digest,
    });

    const unavailable = await backfillCredentialStatusEntries(client, {
      fetchStoredCopy: async () => {
        throw new Error('storage unavailable');
      },
    });
    expect(unavailable).toMatchObject({ scanned: 1, captured: 0, failed: 1 });
    expect(unavailable.failures[0]?.errorClass).toBe('STORAGE_UNAVAILABLE');
    expect(credentialStatusBackfillExitCode(unavailable)).toBe(1);
    expect((await client.credential.findUniqueOrThrow({ where: { id: 'status-backfill-retry' } })).statusCapture).toBe(
      CredentialStatusCapture.FAILED,
    );

    const remaining = await backfillCredentialStatusEntries(client, { dryRun: true });
    expect(remaining).toMatchObject({ scanned: 0, captured: 0, failed: 0, failedRows: 1 });
    expect(credentialStatusBackfillExitCode(remaining)).toBe(1);

    const retried = await backfillCredentialStatusEntries(client, {
      retryFailed: true,
      fetchStoredCopy: async () => bytes,
    });
    expect(retried).toMatchObject({ scanned: 1, captured: 1, failed: 0 });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'status-backfill-retry' } })).toBe(1);

    const secondRun = await backfillCredentialStatusEntries(client, { fetchStoredCopy: async () => bytes });
    expect(secondRun).toMatchObject({
      dryRun: false,
      retryFailed: false,
      scanned: 0,
      captured: 0,
      failed: 0,
      failedRows: 0,
      failedByClass: {},
      failures: [],
    });

    await insertNativeCredential(client, {
      id: 'status-backfill-race',
      storageUri: 'https://storage.test/status-race',
      digestMultibase: digest,
    });
    let fetched = 0;
    let release!: () => void;
    const bothFetched = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBoth = async () => {
      fetched += 1;
      if (fetched === 2) release();
      await bothFetched;
      return bytes;
    };
    const [left, right] = await Promise.all([
      backfillCredentialStatusEntries(client, { fetchStoredCopy: fetchBoth }),
      backfillCredentialStatusEntries(client, { fetchStoredCopy: fetchBoth }),
    ]);
    expect(left.captured + right.captured).toBe(1);
    expect(left.failed + right.failed).toBe(1);
    expect([...left.failures, ...right.failures][0]?.errorClass).toBe('WRITE_RACE');
    expect((await client.credential.findUniqueOrThrow({ where: { id: 'status-backfill-race' } })).statusCapture).toBe(
      CredentialStatusCapture.CAPTURED,
    );
    expect(
      await client.credentialStatusEntry.findFirst({
        where: { credentialId: 'status-backfill-race' },
        select: { provenance: true, statusListIndex: true },
      }),
    ).toEqual({ provenance: CredentialStatusProvenance.BACKFILL, statusListIndex: '3' });
  });

  it('treats an absent credentialStatus member as CAPTURED with no entries', async () => {
    const { bytes, digest } = await storedCredential(null);
    await insertNativeCredential(client, {
      id: 'status-backfill-absent',
      storageUri: 'https://storage.test/status-absent',
      digestMultibase: digest,
    });

    const result = await backfillCredentialStatusEntries(client, { fetchStoredCopy: async () => bytes });

    expect(result).toMatchObject({ scanned: 1, captured: 1, failed: 0, failedRows: 0, failedByClass: {} });
    expect(await client.credential.findUniqueOrThrow({ where: { id: 'status-backfill-absent' } })).toMatchObject({
      statusCapture: CredentialStatusCapture.CAPTURED,
      statusCaptureError: null,
    });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'status-backfill-absent' } })).toBe(0);
  });

  it('lists permanent FAILED rows for inspection without gating a no-op dry run', async () => {
    const permanentRows = [
      ['status-backfill-malformed', 'MALFORMED_ENTRY'],
      ['status-backfill-ambiguous', 'AMBIGUOUS_PURPOSE'],
      ['status-backfill-unreadable', 'UNREADABLE_ENVELOPE'],
      ['status-backfill-missing', 'PURPOSE_MISSING'],
    ] as const;
    for (const [id, errorClass] of permanentRows) {
      await insertNativeCredential(client, { id });
      await client.credential.update({
        where: { id },
        data: { statusCapture: CredentialStatusCapture.FAILED, statusCaptureError: errorClass },
      });
    }

    const result = await backfillCredentialStatusEntries(client, { dryRun: true });

    expect(result).toMatchObject({ scanned: 0, captured: 0, failed: 0, failedRows: 4 });
    expect(result.failedByClass).toEqual({
      MALFORMED_ENTRY: 1,
      AMBIGUOUS_PURPOSE: 1,
      UNREADABLE_ENVELOPE: 1,
      PURPOSE_MISSING: 1,
    });
    expect(result.remainingFailures).toEqual(
      expect.arrayContaining(permanentRows.map(([id, errorClass]) => ({ id, errorClass }))),
    );
    expect(credentialStatusBackfillExitCode(result)).toBe(0);
  });

  it("does not count another tenant's retryable FAILED row in a tenant-scoped run", async () => {
    const otherTenantId = 'status-backfill-other-tenant';
    await client.tenant.create({ data: { id: otherTenantId, name: 'Other status backfill tenant' } });
    await insertNativeCredential(client, { id: 'status-backfill-other-row', tenantId: otherTenantId });
    await client.credential.update({
      where: { id: 'status-backfill-other-row' },
      data: { statusCapture: CredentialStatusCapture.FAILED, statusCaptureError: 'STORAGE_UNAVAILABLE' },
    });

    const result = await backfillCredentialStatusEntries(client, { dryRun: true, tenantId: SYSTEM_TENANT_ID });

    expect(result).toMatchObject({ scanned: 0, captured: 0, failed: 0, failedRows: 0, failedByClass: {} });
    expect(result.remainingFailures).toEqual([]);
    expect(credentialStatusBackfillExitCode(result)).toBe(0);
  });

  it('supports a dry-run without changing a readable PENDING row or creating entries', async () => {
    const { bytes, digest } = await storedCredential();
    await insertNativeCredential(client, {
      id: 'status-backfill-dry-run',
      storageUri: 'https://storage.test/status-dry-run',
      digestMultibase: digest,
    });

    const result = await backfillCredentialStatusEntries(client, { dryRun: true, fetchStoredCopy: async () => bytes });

    expect(result).toMatchObject({ scanned: 1, captured: 1, failed: 0, failedRows: 0 });
    expect(await client.credential.findUniqueOrThrow({ where: { id: 'status-backfill-dry-run' } })).toMatchObject({
      statusCapture: CredentialStatusCapture.PENDING,
      statusCaptureError: null,
    });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'status-backfill-dry-run' } })).toBe(0);
  });

  it('uses the storage-produced plain credential digest preimage while backfilling', async () => {
    const plainCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc+jwt,eyJhbGciOiJFUzI1NiJ9.eyJmb28iOiJiYXIifQ.sig',
    };
    const bytes = new TextEncoder().encode(JSON.stringify(plainCredential));
    const digest = (
      await MultibaseDigest.fromData(credentialDigestPreimage(plainCredential), {
        algorithm: 'sha2-256',
        base: 'base58btc',
      })
    ).toString();
    await insertNativeCredential(client, {
      id: 'status-backfill-digest-vector',
      storageUri: 'https://storage.test/status-digest-vector',
      digestMultibase: digest,
    });

    const result = await backfillCredentialStatusEntries(client, { fetchStoredCopy: async () => bytes });

    expect(result).toMatchObject({ scanned: 1, captured: 1, failed: 0, failedRows: 0 });
    expect(await client.credentialStatusEntry.count({ where: { credentialId: 'status-backfill-digest-vector' } })).toBe(
      0,
    );
  });

  it('attributes only eligible rows and reports concurrent attribution races', async () => {
    const unattributed = await insertNativeCredential(client, { id: 'status-attr-unattributed' });
    await markCaptured(unattributed.id);
    await addStatusEntry(unattributed.id);
    const issuance = await insertNativeCredential(client, { id: 'status-attr-issuance' });
    await markCaptured(issuance.id);
    await addStatusEntry(issuance.id);
    await client.credential.update({
      where: { id: issuance.id },
      data: { vcServiceInstanceId: 'issued-instance', vcServiceAttribution: VcServiceAttribution.ISSUANCE },
    });
    const operator = await insertNativeCredential(client, { id: 'status-attr-operator' });
    await markCaptured(operator.id);
    await addStatusEntry(operator.id);
    await client.credential.update({
      where: { id: operator.id },
      data: { vcServiceInstanceId: 'old-instance', vcServiceAttribution: VcServiceAttribution.OPERATOR },
    });
    const verifier = createVerifierDouble();
    jest.spyOn(verifier, 'getCredentialStatus').mockResolvedValue({
      statusPurpose: 'revocation',
      statusListCredential: 'https://status.example/list/1',
      statusListIndex: '3',
      value: false,
      observedAt: '2026-09-17T00:00:00.000Z',
    });
    mockResolveVcService.mockResolvedValue({ instanceId: 'new-instance', service: verifier });

    const first = await attributeCredentialStatusInstance(
      { tenantId: SYSTEM_TENANT_ID, instanceId: 'new-instance', reason: 'historical issuance mapping' },
      client,
    );
    expect(first).toMatchObject({ scanned: 1, attributed: 1, evidenceFailures: [], writeFailures: [] });
    expect(await client.credential.findUniqueOrThrow({ where: { id: unattributed.id } })).toMatchObject({
      vcServiceInstanceId: 'new-instance',
      vcServiceAttribution: VcServiceAttribution.OPERATOR,
    });

    const reassigned = await attributeCredentialStatusInstance(
      {
        tenantId: SYSTEM_TENANT_ID,
        instanceId: 'replacement-instance',
        reason: 'corrected historical mapping',
        reassign: true,
      },
      client,
    );
    expect(reassigned).toMatchObject({ scanned: 2, attributed: 2 });
    expect(await client.credential.findUniqueOrThrow({ where: { id: issuance.id } })).toMatchObject({
      vcServiceInstanceId: 'issued-instance',
      vcServiceAttribution: VcServiceAttribution.ISSUANCE,
    });
    expect(await client.credential.findUniqueOrThrow({ where: { id: operator.id } })).toMatchObject({
      vcServiceInstanceId: 'replacement-instance',
      vcServiceAttribution: VcServiceAttribution.OPERATOR,
    });

    const dryRunRow = await insertNativeCredential(client, { id: 'status-attr-dry-run' });
    await markCaptured(dryRunRow.id);
    await addStatusEntry(dryRunRow.id);
    const dryRun = await attributeCredentialStatusInstance(
      { tenantId: SYSTEM_TENANT_ID, instanceId: 'dry-run-instance', reason: 'preview', dryRun: true },
      client,
    );
    expect(dryRun).toMatchObject({ scanned: 1, attributed: 1 });
    expect(await client.credential.findUniqueOrThrow({ where: { id: dryRunRow.id } })).toMatchObject({
      vcServiceInstanceId: null,
      vcServiceAttribution: null,
    });

    const race = await insertNativeCredential(client, { id: 'status-attr-race' });
    await markCaptured(race.id);
    await addStatusEntry(race.id);
    const racingClient = {
      credential: client.credential,
      $transaction: async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        await client.credential.update({
          where: { id: race.id },
          data: { vcServiceAttribution: VcServiceAttribution.ISSUANCE, vcServiceInstanceId: 'race-instance' },
        });
        return client.$transaction(callback);
      },
    };
    const raced = await attributeCredentialStatusInstance(
      { tenantId: SYSTEM_TENANT_ID, instanceId: 'race-target', reason: 'race' },
      racingClient as never,
    );
    expect(raced.writeFailures).toEqual([
      { credentialId: race.id, message: 'The row changed before attribution was committed' },
    ]);
  });

  it('takes the parent lock before attribution so a concurrent reservation is observed', async () => {
    const row = await insertNativeCredential(client, { id: 'status-attr-parent-lock' });
    await markCaptured(row.id);
    await addStatusEntry(row.id);
    const entry = await client.$transaction((tx) =>
      getCredentialStatusEntry(tx, row.id, SYSTEM_TENANT_ID, 'revocation'),
    );
    if (entry === null) throw new Error('expected a captured status entry');

    const verifier = createVerifierDouble();
    let providerRead!: () => void;
    const providerReadComplete = new Promise<void>((resolve) => {
      providerRead = resolve;
    });
    let releaseProviderRead!: () => void;
    const providerReadRelease = new Promise<void>((resolve) => {
      releaseProviderRead = resolve;
    });
    jest.spyOn(verifier, 'getCredentialStatus').mockImplementation(async () => {
      providerRead();
      await providerReadRelease;
      return {
        statusPurpose: 'revocation',
        statusListCredential: 'https://status.example/list/1',
        statusListIndex: '3',
        value: false,
        observedAt: '2026-09-17T00:00:00.000Z',
      };
    });
    mockResolveVcService.mockResolvedValue({ instanceId: 'attribution-instance', service: verifier });
    await client.serviceInstance.create({
      data: {
        id: 'reservation-instance',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: 'Reservation test VC',
        config: 'encrypted-reservation-config',
        isPrimary: false,
      },
    });

    const second = createRigClient();
    await second.$connect();
    let releaseReservation!: () => void;
    const reservationRelease = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });
    let reservationLocked!: () => void;
    const reservationLockAcquired = new Promise<void>((resolve) => {
      reservationLocked = resolve;
    });
    let attributionSettled = false;
    const attributionPromise = attributeCredentialStatusInstance(
      { tenantId: SYSTEM_TENANT_ID, instanceId: 'attribution-instance', reason: 'parent lock test' },
      client,
    ).then((result) => {
      attributionSettled = true;
      return result;
    });

    let reservation: Promise<unknown> | undefined;
    try {
      await providerReadComplete;
      reservation = second.$transaction(async (tx) => {
        const outcome = await reserveStatusChange(tx, {
          entryId: entry.id,
          credentialId: row.id,
          tenantId: SYSTEM_TENANT_ID,
          expectedVersion: 1,
          value: true,
          budgetMs: 60_000,
          instanceId: 'reservation-instance',
          configDigest: 'reservation-digest',
          token: 'reservation-token',
        });
        reservationLocked();
        await reservationRelease;
        return outcome;
      });
      await reservationLockAcquired;
      releaseProviderRead();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(attributionSettled).toBe(false);
      releaseReservation();

      const result = await attributionPromise;
      await expect(reservation).resolves.toMatchObject({ outcome: 'reserved' });
      expect(result).toMatchObject({ scanned: 1, attributed: 0 });
      expect(result.writeFailures).toEqual([
        { credentialId: row.id, message: 'The row changed before attribution was committed' },
      ]);
      expect(await client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
        pendingToken: 'reservation-token',
      });
    } finally {
      releaseProviderRead();
      releaseReservation();
      await Promise.allSettled([attributionPromise, reservation]);
      await second.$disconnect();
    }
  });
});
