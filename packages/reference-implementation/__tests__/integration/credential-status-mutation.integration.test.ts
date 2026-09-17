import { readCredentialStatus } from '../../src/lib/credentials/read-credential-status';
import { reconcileCredentialStatus } from '../../src/lib/credentials/reconcile-credential-status';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../src/lib/prisma/prisma';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { setCredentialStatus } from '../../src/lib/credentials/set-credential-status';
import {
  finaliseStatusChange,
  reserveStatusChange,
  clearPendingIntent,
} from '../../src/lib/prisma/repositories/credential-status-entry.repository';
import { lockServiceInstanceForUpdate } from '../../src/lib/prisma/repositories/service-instance-lock.repository';
import { statusConfigDigest } from '../../src/lib/credentials/credential-status-context';
import { CredentialStatusError } from '../../src/lib/credentials/credential-status-error';
import { prismaTransactionWriteConflictError } from '../../src/lib/prisma/db-errors.fixtures';

jest.mock('@/lib/encryption/encryption', () => ({
  getEncryptionService: () => ({
    decrypt: (config: unknown) => JSON.stringify(config),
    encrypt: (plaintext: string) => JSON.parse(plaintext),
  }),
}));

const client = createRigClient();
const instanceId = 'status-provider';
const entryId = 'status-entry';
const recordId = 'status-credential';
let baseUrl: string;
let bit: boolean;
let calls: string[];
let onRead: ((response: ServerResponse) => Promise<boolean>) | undefined;
let onSet: ((response: ServerResponse) => Promise<boolean>) | undefined;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  calls.push(req.url ?? '');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/agent/checkBitstringStatus') {
    if (onRead && (await onRead(res))) return;
    res.end(JSON.stringify({ revoked: bit, errors: [] }));
    return;
  }
  if (req.url === '/agent/setBitstringStatus') {
    if (onSet && (await onSet(res))) return;
    bit = body.status;
    res.end(JSON.stringify({ status: bit }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
const request = () => ({ recordId, tenantId: SYSTEM_TENANT_ID, purpose: 'revocation', value: true, ifVersion: '1' });
const stored = () => client.credentialStatusEntry.findUniqueOrThrow({ where: { id: entryId } });
const config = () => ({ baseUrl, apiKey: 'test-key', apiVersion: '1.0.0' });

beforeAll(async () => {
  await client.$connect();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  await client.serviceInstance.create({
    data: {
      id: instanceId,
      tenantId: SYSTEM_TENANT_ID,
      serviceType: 'VC',
      adapterType: 'VCKIT',
      name: 'Status test',
      config: JSON.stringify(config()),
    },
  });
  await insertNativeCredential(client, { id: recordId, tenantId: SYSTEM_TENANT_ID });
  await client.credential.update({
    where: { id: recordId },
    data: { statusCapture: 'CAPTURED', vcServiceInstanceId: instanceId, vcServiceAttribution: 'ISSUANCE' },
  });
  await client.credentialStatusEntry.create({
    data: {
      id: entryId,
      credentialId: recordId,
      tenantId: SYSTEM_TENANT_ID,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListCredential: 'https://issuer.example/status/1',
      statusListIndex: '7',
      statusListVcIssuer: 'did:web:issuer.example',
      descriptor: {
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListCredential: 'https://issuer.example/status/1',
        statusListIndex: '7',
      },
      provenance: 'ISSUANCE',
      value: false,
    },
  });
  bit = false;
  calls = [];
  onRead = undefined;
  onSet = undefined;
  process.env.CREDENTIAL_STATUS_MUTATION_ENABLED = 'true';
});
afterAll(async () => {
  delete process.env.CREDENTIAL_STATUS_MUTATION_ENABLED;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await client.$disconnect();
  await prisma.$disconnect();
});

async function reserve(token = 'owned-token') {
  return client.$transaction((tx) =>
    reserveStatusChange(tx, {
      entryId,
      credentialId: recordId,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 1,
      value: true,
      budgetMs: 30_000,
      instanceId,
      configDigest: 'digest',
      token,
    }),
  );
}

it('commits intent before any provider call and publishes only the read-back value', async () => {
  let reads = 0;
  onRead = async () => {
    reads++;
    const row = await stored();
    expect(row).toMatchObject({ pendingValue: true, pendingInstanceId: instanceId, value: false, version: 1 });
    expect(row.pendingToken).not.toBeNull();
    expect(row.pendingConfigDigest).toBe(await statusConfigDigest(config()));
    return false;
  };
  const before = await client.libraryRecord.findUniqueOrThrow({ where: { id: recordId } });
  await expect(setCredentialStatus(request())).resolves.toMatchObject({ entryId, value: true, version: 2 });
  expect(reads).toBe(2);
  expect(calls).toEqual(['/agent/checkBitstringStatus', '/agent/setBitstringStatus', '/agent/checkBitstringStatus']);
  expect(await stored()).toMatchObject({ value: true, version: 2, pendingToken: null, pendingConfigDigest: null });
  expect((await stored()).valueChangedAt).not.toBeNull();
  expect(
    (await client.libraryRecord.findUniqueOrThrow({ where: { id: recordId } })).updatedAt.getTime(),
  ).toBeGreaterThan(before.updatedAt.getTime());
});
it('uses the application clock for observations while the database owns row timestamps and coordination state', async () => {
  const forward = new Date('2040-01-02T03:04:05.000Z');
  const backward = new Date('2000-01-02T03:04:05.000Z');
  const before = await stored();
  let reads = 0;
  onRead = async () => {
    if (++reads === 1)
      expect(await stored()).toMatchObject({ version: 1, pendingValue: true, pendingToken: expect.any(String) });
    return false;
  };

  await expect(setCredentialStatus({ ...request(), now: () => forward })).resolves.toMatchObject({
    value: true,
    observedAt: forward.toISOString(),
    version: 2,
  });
  const afterSet = await stored();
  expect(afterSet).toMatchObject({
    value: true,
    version: 2,
    pendingToken: null,
    observedAt: forward,
    valueChangedAt: forward,
  });
  expect(afterSet.updatedAt.getTime()).toBeGreaterThan(backward.getTime());
  expect(afterSet.updatedAt.getTime()).toBeLessThan(forward.getTime());

  bit = false;
  await expect(reconcileCredentialStatus({ ...request(), ifVersion: '2', now: () => backward })).resolves.toMatchObject(
    { value: false, observedAt: backward.toISOString(), version: 3 },
  );
  const afterReconcile = await stored();
  expect(afterReconcile).toMatchObject({
    value: false,
    version: 3,
    pendingToken: null,
    observedAt: backward,
    valueChangedAt: backward,
  });
  expect(afterReconcile.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  expect(afterReconcile.updatedAt.getTime()).toBeGreaterThan(backward.getTime());
  expect(afterReconcile.updatedAt.getTime()).toBeLessThan(forward.getTime());
});
it.each([undefined, 'false'] as const)(
  'leaves the status row untouched when mutation is disabled: %s',
  async (enabled) => {
    if (enabled === undefined) delete process.env.CREDENTIAL_STATUS_MUTATION_ENABLED;
    else process.env.CREDENTIAL_STATUS_MUTATION_ENABLED = enabled;
    const before = await stored();

    await expect(setCredentialStatus(request())).rejects.toMatchObject({
      code: 'STATUS_MUTATION_DISABLED',
      statusCode: 503,
    });
    expect(await stored()).toEqual(before);
    expect(calls).toEqual([]);
  },
);
it('keeps stored reads and reconciliation available when mutation is disabled', async () => {
  delete process.env.CREDENTIAL_STATUS_MUTATION_ENABLED;

  await expect(readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID })).resolves.toMatchObject({
    entries: [{ entryId, value: false, version: 1 }],
  });
  await expect(reconcileCredentialStatus(request())).resolves.toMatchObject({
    entryId,
    value: false,
    version: 2,
  });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
});
it('refuses a stale version without reserving or making provider calls', async () => {
  await expect(setCredentialStatus({ ...request(), ifVersion: '2' })).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
  });
  expect(calls).toEqual([]);
  expect(await stored()).toMatchObject({ version: 1, pendingToken: null });
});
it('one of two competing reservations wins and the other remains pending', async () => {
  const outcomes = await Promise.all([reserve('first'), reserve('second')]);
  expect(outcomes.filter((outcome) => typeof outcome === 'object')).toHaveLength(1);
  expect(outcomes).toContain('pending_exists');
  expect(['first', 'second']).toContain((await stored()).pendingToken);
});
it('stale-token finalisation affects zero rows and maps to 503 with the row untouched', async () => {
  await reserve('new-token');
  const before = await stored();
  await expect(
    client.$transaction(async (tx) => {
      const result = await finaliseStatusChange(tx, {
        entryId,
        credentialId: recordId,
        tenantId: SYSTEM_TENANT_ID,
        token: 'old-token',
        expectedVersion: 1,
        value: true,
        observedAt: new Date(),
        instanceId,
      });
      if (result !== 'finalised')
        throw new CredentialStatusError('STATUS_PERSISTENCE_FAILED', 'The reservation changed.');
    }),
  ).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED', statusCode: 503 });
  expect(await stored()).toEqual(before);
});
it('retains pending and the old fact when config changes before finalisation', async () => {
  let reads = 0;
  onRead = async () => {
    if (++reads === 2)
      await client.serviceInstance.update({
        where: { id: instanceId },
        data: { config: JSON.stringify({ ...config(), apiKey: 'changed-key' }) },
      });
    return false;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
  expect((await stored()).pendingToken).not.toBeNull();
  expect(bit).toBe(true);
});
it('finalises a reservation after an operator records its accepted replacement digest', async () => {
  const { repairServiceConfig } = await import('../../src/lib/services/repair-config');
  let reads = 0;
  onRead = async () => {
    if (++reads === 2) {
      await client.credentialStatusEntry.update({
        where: { id: entryId },
        data: { pendingDeadline: new Date(Date.now() - 60_000) },
      });
      await expect(
        repairServiceConfig(
          { instanceId, config: { ...config(), apiKey: 'repaired-key' }, allowPending: true },
          client,
        ),
      ).resolves.toMatchObject({ pendingEntries: 1 });
    }
    return false;
  };

  await expect(setCredentialStatus(request())).resolves.toMatchObject({ value: true, version: 2 });
  expect(await stored()).toMatchObject({ value: true, version: 2, pendingToken: null });
  expect((await client.serviceInstance.findUniqueOrThrow({ where: { id: instanceId } })).config).not.toBe(
    JSON.stringify(config()),
  );
});
it('refuses finalisation when the current digest is neither pinned nor accepted', async () => {
  let reads = 0;
  onRead = async () => {
    if (++reads === 2) {
      await client.credentialStatusEntry.update({
        where: { id: entryId },
        data: {
          pendingDeadline: new Date(Date.now() - 60_000),
          acceptedReplacementDigest: 'unaccepted-digest',
        },
      });
      await client.serviceInstance.update({
        where: { id: instanceId },
        data: { config: JSON.stringify({ ...config(), apiKey: 'unaccepted-key' }) },
      });
    }
    return false;
  };

  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(await stored()).toMatchObject({
    value: false,
    version: 1,
    pendingValue: true,
    pendingToken: expect.any(String),
  });
});
it('clears owned intent after a preliminary read failure without setting a bit', async () => {
  onRead = async (res) => {
    res.end(JSON.stringify({ revoked: true, errors: [{ message: 'list unavailable' }] }));
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'VC_SERVICE_UNAVAILABLE' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: null });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
});
it('records an already-matching preliminary observation without rewriting the provider list', async () => {
  bit = true;
  await expect(setCredentialStatus(request())).resolves.toMatchObject({ value: true, version: 2 });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
  expect(await stored()).toMatchObject({ value: true, version: 2, pendingToken: null });
});
it('clears intent and returns 502 for an invalid preliminary response without inventing a bit', async () => {
  onRead = async (res) => {
    res.end(JSON.stringify({ revoked: 'true', errors: [] }));
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({
    code: 'VC_STATUS_RESPONSE_INVALID',
    statusCode: 502,
  });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: null });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
});
it('clears intent after a definitive provider refusal and preserves the previous fact', async () => {
  onSet = async (res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'request refused' }));
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({
    code: 'VC_SERVICE_UNAVAILABLE',
    statusCode: 502,
  });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: null });
  expect(bit).toBe(false);
  expect(calls).toEqual(['/agent/checkBitstringStatus', '/agent/setBitstringStatus']);
});
it('keeps intent after read-back errors even when the provider reports a true bit', async () => {
  let reads = 0;
  onRead = async (res) => {
    if (++reads === 1) return false;
    res.end(JSON.stringify({ revoked: true, errors: [{ message: 'list unavailable' }] }));
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({
    code: 'STATUS_OUTCOME_UNKNOWN',
    statusCode: 503,
  });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
  expect((await stored()).pendingToken).not.toBeNull();
  expect(bit).toBe(true);
});
it('reports the observed mismatch and keeps it separate from the stored fact and pending request', async () => {
  onSet = async (res) => {
    res.end(JSON.stringify({ status: true }));
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({
    code: 'STATUS_OUTCOME_MISMATCH',
    statusCode: 503,
    observed: { value: false, observedAt: expect.any(String) },
  });
  expect(await stored()).toMatchObject({ value: false, version: 1, observedAt: null, pendingValue: true });
  expect((await stored()).pendingToken).not.toBeNull();
});
it('refuses reconciliation while a dispatcher is paused before its first set', async () => {
  let reads = 0;
  onRead = async () => {
    if (++reads === 1) {
      const before = await stored();
      await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({
        code: 'STATUS_OPERATION_IN_PROGRESS',
      });
      expect(await stored()).toEqual(before);
    }
    return false;
  };
  await expect(setCredentialStatus(request())).resolves.toMatchObject({ value: true, version: 2 });
  expect(calls).toEqual(['/agent/checkBitstringStatus', '/agent/setBitstringStatus', '/agent/checkBitstringStatus']);
});
it('keeps intent when a set may have applied despite a provider error', async () => {
  onSet = async (res) => {
    bit = true;
    res.statusCode = 500;
    res.end('{}');
    return true;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_OUTCOME_UNKNOWN' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
  expect((await stored()).pendingToken).not.toBeNull();
});
it('does not finalise a changed token after read-back', async () => {
  let reads = 0;
  onRead = async () => {
    if (++reads === 2)
      await client.credentialStatusEntry.update({
        where: { id: entryId },
        data: { pendingToken: 'replacement-token' },
      });
    return false;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: 'replacement-token' });
});
it('reports a missing instance distinctly at reservation and finalisation', async () => {
  await client.serviceInstance.delete({ where: { id: instanceId } });
  expect(await reserve()).toBe('instance_missing');
  expect(
    await client.$transaction((tx) =>
      finaliseStatusChange(tx, {
        entryId,
        credentialId: recordId,
        tenantId: SYSTEM_TENANT_ID,
        token: 'absent',
        expectedVersion: 1,
        value: true,
        observedAt: new Date(),
        instanceId,
      }),
    ),
  ).toBe('instance_missing');
});
it('does not clear intent while another transaction holds the instance row', async () => {
  await reserve();
  let release!: () => void;
  let locked!: () => void;
  const lockReady = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const finish = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = client.$transaction(async (tx) => {
    await lockServiceInstanceForUpdate(tx, instanceId, SYSTEM_TENANT_ID);
    locked();
    await finish;
  });
  await lockReady;
  let settled = false;
  const clearing = prisma
    .$transaction((tx) =>
      clearPendingIntent(tx, { entryId, credentialId: recordId, tenantId: SYSTEM_TENANT_ID, token: 'owned-token' }),
    )
    .finally(() => {
      settled = true;
    });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    expect((await stored()).pendingToken).toBe('owned-token');
  } finally {
    release();
    await holder;
  }
  await expect(clearing).resolves.toBe('cleared');
  expect((await stored()).pendingToken).toBeNull();
});

it('reconciles an expired pending intent after grace and records the observed value', async () => {
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 60_000), pendingConfigDigest: await statusConfigDigest(config()) },
  });
  bit = true;
  await expect(reconcileCredentialStatus({ ...request(), acceptProviderChange: false })).resolves.toMatchObject({
    value: true,
    version: 2,
  });
  expect(await stored()).toMatchObject({ pendingToken: null, value: true, version: 2 });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
});
it('records a first observation without pending intent or any provider set', async () => {
  await client.credentialStatusEntry.update({ where: { id: entryId }, data: { value: null, provenance: 'BACKFILL' } });
  await expect(reconcileCredentialStatus(request())).resolves.toMatchObject({ value: false, version: 2 });
  expect(await stored()).toMatchObject({ value: false, version: 2, pendingToken: null });
  expect(calls).toEqual(['/agent/checkBitstringStatus']);
});
it('refuses pending reconciliation while the grace window remains live', async () => {
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 100) },
  });
  const before = await stored();
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_OPERATION_IN_PROGRESS' });
  expect(await stored()).toEqual(before);
  expect(calls).toEqual([]);
});
it('requires explicit provider-change acceptance and keeps the original pin until observation commits', async () => {
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 60_000) },
  });
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(calls).toEqual([]);
  onRead = async () => {
    expect((await stored()).pendingConfigDigest).toBe('digest');
    return false;
  };
  await expect(reconcileCredentialStatus({ ...request(), acceptProviderChange: true })).resolves.toMatchObject({
    value: false,
    version: 2,
  });
});
it('retains pending intent when reconciliation cannot read the provider', async () => {
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 60_000) },
  });
  const before = await stored();
  onRead = async (res) => {
    res.statusCode = 503;
    res.end('{}');
    return true;
  };
  await expect(reconcileCredentialStatus({ ...request(), acceptProviderChange: true })).rejects.toMatchObject({
    code: 'VC_SERVICE_UNAVAILABLE',
  });
  expect(await stored()).toEqual(before);
});
it('keeps an unobserved entry unchanged when a first observation fails', async () => {
  await client.credentialStatusEntry.update({ where: { id: entryId }, data: { value: null } });
  const before = await stored();
  onRead = async (res) => {
    res.end(JSON.stringify({ revoked: true, errors: [{ message: 'list verification failed' }] }));
    return true;
  };
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'VC_SERVICE_UNAVAILABLE' });
  expect(await stored()).toEqual(before);
});
it('first-observation persistence refuses a concurrently reserved entry even without a version bump', async () => {
  onRead = async () => {
    await reserve('concurrent-token');
    return false;
  };
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: 'concurrent-token' });
});
it('first-observation persistence revalidates the effective config after the read', async () => {
  onRead = async () => {
    await client.serviceInstance.update({
      where: { id: instanceId },
      data: { config: JSON.stringify({ ...config(), apiKey: 'replacement' }) },
    });
    return false;
  };
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(await stored()).toMatchObject({ version: 1, pendingToken: null });
});
it('first-observation persistence revalidates credential attribution after the read', async () => {
  onRead = async () => {
    await client.credential.update({ where: { id: recordId }, data: { vcServiceInstanceId: 'other-instance' } });
    return false;
  };
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(await stored()).toMatchObject({ version: 1 });
});
it('pending reconciliation cannot clear a replacement token', async () => {
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 60_000) },
  });
  onRead = async () => {
    await client.credentialStatusEntry.update({ where: { id: entryId }, data: { pendingToken: 'replacement-token' } });
    return false;
  };
  await expect(reconcileCredentialStatus({ ...request(), acceptProviderChange: true })).rejects.toMatchObject({
    code: 'STATUS_PERSISTENCE_FAILED',
  });
  expect(await stored()).toMatchObject({ version: 1, pendingToken: 'replacement-token' });
});

it('stored status reads expose attribution and pending facts without provider traffic', async () => {
  await reserve();
  const before = await stored();
  expect(await readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID })).toMatchObject({
    capture: 'CAPTURED',
    statusCaptureError: null,
    attribution: { instanceId, source: 'ISSUANCE' },
    entries: [{ entryId, version: 1, value: false, pending: { value: true } }],
  });
  expect(calls).toEqual([]);
  expect(await stored()).toEqual(before);
});
it('fresh reads return observations separately and leave every stored field unchanged', async () => {
  await reserve();
  bit = true;
  const before = await stored();
  const parent = await client.libraryRecord.findUniqueOrThrow({ where: { id: recordId } });
  expect(await readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID, fresh: true })).toMatchObject({
    entries: [{ value: false, version: 1, pending: { value: true } }],
    observed: [{ entryId, value: true }],
    failures: [],
  });
  expect(await stored()).toEqual(before);
  expect(await client.libraryRecord.findUniqueOrThrow({ where: { id: recordId } })).toEqual(parent);
});
it('fresh read errors are per-entry failures and never inferred status values', async () => {
  onRead = async (res) => {
    res.end(JSON.stringify({ revoked: true, errors: [{ message: 'unavailable' }] }));
    return true;
  };
  const before = await stored();
  expect(await readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID, fresh: true })).toMatchObject({
    observed: [],
    failures: [{ entryId, code: 'VC_SERVICE_UNAVAILABLE' }],
  });
  expect(await stored()).toEqual(before);
});
it('a fresh read reports missing attribution without choosing a current primary', async () => {
  await client.credential.update({ where: { id: recordId }, data: { vcServiceInstanceId: null } });
  expect(await readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID, fresh: true })).toMatchObject({
    attribution: null,
    observed: [],
    failures: [{ entryId, code: 'STATUS_METADATA_UNAVAILABLE' }],
  });
  expect(calls).toEqual([]);
});
it('read and management entry points hide foreign-tenant credentials', async () => {
  await expect(readCredentialStatus({ recordId, tenantId: 'foreign-tenant' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(setCredentialStatus({ ...request(), tenantId: 'foreign-tenant' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(reconcileCredentialStatus({ ...request(), tenantId: 'foreign-tenant' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(calls).toEqual([]);
});

it('repair refuses live reservations without changing configuration or any pending field', async () => {
  const { repairServiceConfig } = await import('../../src/lib/services/repair-config');
  await reserve();
  const before = await stored();
  const instance = await client.serviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
  await expect(
    repairServiceConfig({ instanceId, config: { ...config(), apiKey: 'repaired' }, allowPending: true }, client),
  ).rejects.toThrow('have not passed their deadline');
  expect(await stored()).toEqual(before);
  expect(await client.serviceInstance.findUniqueOrThrow({ where: { id: instanceId } })).toEqual(instance);
});
it('repair requires acknowledgement and preserves original pins and attribution after expiry', async () => {
  const { repairServiceConfig } = await import('../../src/lib/services/repair-config');
  await reserve();
  await client.credentialStatusEntry.update({
    where: { id: entryId },
    data: { pendingDeadline: new Date(Date.now() - 60_000) },
  });
  const replacement = { ...config(), apiKey: 'repaired' };
  await expect(repairServiceConfig({ instanceId, config: replacement, allowPending: false }, client)).rejects.toThrow(
    '--allow-pending',
  );
  const before = await stored();
  const credential = await client.credential.findUniqueOrThrow({ where: { id: recordId } });
  await expect(
    repairServiceConfig({ instanceId, config: replacement, allowPending: true }, client),
  ).resolves.toMatchObject({ pendingEntries: 1, replacementDigest: await statusConfigDigest(replacement) });
  const after = await stored();
  expect(after).toEqual({
    ...before,
    acceptedReplacementDigest: await statusConfigDigest(replacement),
    updatedAt: after.updatedAt,
  });
  expect(await client.credential.findUniqueOrThrow({ where: { id: recordId } })).toEqual(credential);
  expect(JSON.parse((await client.serviceInstance.findUniqueOrThrow({ where: { id: instanceId } })).config)).toEqual(
    replacement,
  );
  await expect(reconcileCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  await expect(reconcileCredentialStatus({ ...request(), acceptProviderChange: true })).resolves.toMatchObject({
    version: 2,
    value: false,
  });
});
it('repair validates the replacement without needing to decrypt an unusable old config', async () => {
  const { repairServiceConfig } = await import('../../src/lib/services/repair-config');
  await client.serviceInstance.update({ where: { id: instanceId }, data: { config: 'unreadable old envelope' } });
  await expect(repairServiceConfig({ instanceId, config: {}, allowPending: false }, client)).rejects.toThrow('schema');
  await expect(
    repairServiceConfig({ instanceId, config: config(), allowPending: false }, client),
  ).resolves.toMatchObject({ pendingEntries: 0 });
});
it('the config comparison runs after acquiring the instance lock and cannot bypass pending protection', async () => {
  const { updateServiceInstance } = await import('../../src/lib/prisma/repositories/service-instance.repository');
  await reserve();
  let inspected: string | undefined;
  await expect(
    updateServiceInstance(instanceId, SYSTEM_TENANT_ID, {
      config: JSON.stringify({ ...config(), apiKey: 'replacement' }),
      configChanged: (current) => {
        inspected = current;
        return true;
      },
    }),
  ).rejects.toMatchObject({ code: 'SERVICE_INSTANCE_STATUS_PENDING' });
  expect(inspected).toBe(JSON.stringify(config()));
  await expect(
    updateServiceInstance(instanceId, SYSTEM_TENANT_ID, {
      config: JSON.stringify(config()),
      configChanged: () => false,
    }),
  ).resolves.toMatchObject({ config: JSON.stringify(config()) });
  expect((await stored()).pendingToken).toBe('owned-token');
});

it('maps malformed stored descriptor input to a record error and clears only its own reservation', async () => {
  await client.credentialStatusEntry.update({ where: { id: entryId }, data: { descriptor: { id: 0 } } });
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'RECORD_UNREADABLE', statusCode: 500 });
  expect(calls).toEqual([]);
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingToken: null });
});
it('retains intent if the provider configuration becomes unreadable after a set', async () => {
  let reads = 0;
  onRead = async () => {
    if (++reads === 2)
      await client.serviceInstance.update({ where: { id: instanceId }, data: { config: 'unreadable' } });
    return false;
  };
  await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
});
it.each([false, true])(
  'keeps uncertainty when an aborted provider request applies before abort: %s',
  async (applyBeforeAbort) => {
    const previousBudget = process.env.CREDENTIAL_STATUS_OPERATION_BUDGET_MS;
    process.env.CREDENTIAL_STATUS_OPERATION_BUDGET_MS = '2000';
    let release!: () => void;
    const reply = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished!: () => void;
    const applied = new Promise<void>((resolve) => {
      finished = resolve;
    });
    onSet = async (res) => {
      if (applyBeforeAbort) bit = true;
      await reply;
      bit = true;
      res.end('{}');
      finished();
      return true;
    };
    try {
      await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_OUTCOME_UNKNOWN' });
      expect(bit).toBe(applyBeforeAbort);
      expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
      expect(calls).toEqual(['/agent/checkBitstringStatus', '/agent/setBitstringStatus']);
    } finally {
      release();
      if (calls.includes('/agent/setBitstringStatus')) await applied;
      if (previousBudget === undefined) delete process.env.CREDENTIAL_STATUS_OPERATION_BUDGET_MS;
      else process.env.CREDENTIAL_STATUS_OPERATION_BUDGET_MS = previousBudget;
    }
    expect(bit).toBe(true);
    expect(await stored()).toMatchObject({ value: false, version: 1, pendingValue: true });
  },
);
it('reports an uncertain acknowledgement after an actual committed observation and GET reveals the commit', async () => {
  bit = true;
  const original = prisma.$transaction.bind(prisma);
  let transactions = 0;
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (callback, options) => {
    const result = await original(callback, options);
    if (++transactions === 2) throw new Error('Commit acknowledgement lost after commit');
    return result;
  });
  try {
    await expect(setCredentialStatus(request())).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_UNCERTAIN' });
  } finally {
    spy.mockRestore();
  }
  expect(await stored()).toMatchObject({ value: true, version: 2, pendingToken: null });
  expect(await readCredentialStatus({ recordId, tenantId: SYSTEM_TENANT_ID })).toMatchObject({
    entries: [{ value: true, version: 2, pending: null }],
  });
});

it.each(['set', 'pending reconcile', 'first reconcile'])(
  'retains the previous fact when a known rollback follows the finalisation callback: %s',
  async (operation) => {
    if (operation === 'pending reconcile') {
      await reserve();
      await client.credentialStatusEntry.update({
        where: { id: entryId },
        data: {
          pendingDeadline: new Date(Date.now() - 60_000),
          pendingConfigDigest: await statusConfigDigest(config()),
        },
      });
    }
    bit = true;
    const before = await stored();
    const original = prisma.$transaction.bind(prisma);
    let transactions = 0;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (callback, options) => {
      if (++transactions !== 2) return original(callback, options);
      return original(async (tx) => {
        await callback(tx);
        throw prismaTransactionWriteConflictError();
      }, options);
    });
    try {
      await expect(
        operation === 'set' ? setCredentialStatus(request()) : reconcileCredentialStatus(request()),
      ).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED', statusCode: 503 });
    } finally {
      spy.mockRestore();
    }
    const after = await stored();
    expect(after).toMatchObject({ value: before.value, version: before.version, observedAt: before.observedAt });
    if (operation === 'set') expect(after.pendingToken).not.toBeNull();
    else expect(after.pendingToken).toBe(before.pendingToken);
    expect(calls).toEqual(['/agent/checkBitstringStatus']);
  },
);
