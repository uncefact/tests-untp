/** @jest-environment node */
const mockTx = { libraryRecord: { findFirst: jest.fn() }, serviceInstance: { findUniqueOrThrow: jest.fn() } };
const mockTransaction = jest.fn();
const mockReserve = jest.fn(),
  mockFinalise = jest.fn(),
  mockClear = jest.fn(),
  mockReadToken = jest.fn(),
  mockGetEntry = jest.fn();
const mockRead = jest.fn(),
  mockSet = jest.fn(),
  mockMutex = jest.fn();
const mockLogger = { warn: jest.fn(), error: jest.fn(), child: jest.fn() };
mockLogger.child.mockReturnValue(mockLogger);
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { ...mockTx, $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
jest.mock('@/lib/api/logger', () => ({ apiLogger: mockLogger, appLogger: mockLogger }));
jest.mock('@/lib/prisma/repositories/credential-status-entry.repository', () => ({
  reserveStatusChange: (...args: unknown[]) => mockReserve(...args),
  finaliseStatusChange: (...args: unknown[]) => mockFinalise(...args),
  clearPendingIntent: (...args: unknown[]) => mockClear(...args),
  readPendingToken: (...args: unknown[]) => mockReadToken(...args),
  getCredentialStatusEntry: (...args: unknown[]) => mockGetEntry(...args),
  lockStatusServiceInstance: async () => true,
}));
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  lockLibraryRecordForUpdate: async () => true,
}));
jest.mock('@/lib/services/resolve-service', () => ({
  resolveServiceInstance: () => ({
    service: { getCredentialStatus: mockRead, setCredentialStatus: mockSet },
    config: { baseUrl: 'https://provider.example', apiKey: 'secret' },
  }),
}));
jest.mock('@/lib/services/status-list-mutex', () => ({
  ...jest.requireActual('@/lib/services/status-list-mutex'),
  withStatusListMutex: (...args: unknown[]) => mockMutex(...args),
}));
import {
  VcStatusReadError,
  VcStatusResponseInvalidError,
  VcStatusSetError,
  VcStatusEntryUnsupportedError,
  type SetCredentialStatusInput,
} from '@uncefact/untp-ri-services';
import {
  StatusListLockLostError,
  StatusListMutexBusyError,
  StatusListMutexTimeoutError,
} from '@/lib/services/status-list-mutex';
import { setCredentialStatus } from './set-credential-status';
import { handleRouteError } from '@/lib/api/handle-route-error';
import { statusConfigDigest } from './credential-status-context';
import { prismaTransactionWriteConflictError } from '@/lib/prisma/db-errors.fixtures';
const applicationNow = new Date('2026-09-17T03:04:05.000Z');
const input = {
  recordId: 'credential-a',
  tenantId: 'tenant-a',
  purpose: 'revocation',
  value: true,
  ifVersion: '4',
  now: () => applicationNow,
};
const makeEntry = () => ({
  id: 'entry-a',
  credentialId: input.recordId,
  tenantId: input.tenantId,
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '23',
  statusListVcIssuer: 'did:web:issuer.example',
  descriptor: {
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListCredential: 'https://issuer.example/status/1',
    statusListIndex: 23,
  },
  value: false,
  version: 4,
  pendingToken: null,
});
const observation = (value: boolean) => ({
  value,
  observedAt: '2026-09-17T01:01:00.000Z',
  statusPurpose: 'revocation',
  statusListCredential: makeEntry().statusListCredential,
  statusListIndex: '23',
});
let record: {
  origin: string;
  credential: {
    statusCapture: string;
    vcServiceInstanceId: string | null;
    statusEntries: ReturnType<typeof makeEntry>[];
  };
};
let reserved: { token: string; configDigest: string };
beforeEach(() => {
  jest.resetAllMocks();
  record = {
    origin: 'NATIVE',
    credential: { statusCapture: 'CAPTURED', vcServiceInstanceId: 'instance-a', statusEntries: [makeEntry()] },
  };
  mockTx.libraryRecord.findFirst.mockImplementation(async () => record);
  mockTx.serviceInstance.findUniqueOrThrow.mockResolvedValue({ id: 'instance-a', serviceType: 'VC' });
  mockTransaction.mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  mockReserve.mockImplementation(async (_tx, value) => {
    reserved = value;
    return { outcome: 'reserved', pendingDeadline: new Date(Date.now() + 30_000) };
  });
  mockReadToken.mockImplementation(async () => reserved.token);
  mockGetEntry.mockImplementation(async () => ({
    ...record.credential.statusEntries[0],
    pendingToken: reserved.token,
    pendingConfigDigest: reserved.configDigest,
  }));
  mockRead.mockResolvedValueOnce(observation(false)).mockResolvedValue(observation(true));
  mockSet.mockImplementation(
    async (request: SetCredentialStatusInput) =>
      request.serialise?.('opaque-provider-key', async () => undefined, request.signal),
  );
  mockMutex.mockImplementation(async (_key, fn) => fn());
  mockFinalise.mockResolvedValue('finalised');
  mockClear.mockResolvedValue('cleared');
  process.env.CREDENTIAL_STATUS_MUTATION_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.CREDENTIAL_STATUS_MUTATION_ENABLED;
  jest.restoreAllMocks();
});
it('returns the committed read-back observation and shares one signal across all provider calls', async () => {
  expect(await setCredentialStatus(input)).toEqual({
    entryId: 'entry-a',
    statusPurpose: 'revocation',
    value: true,
    observedAt: applicationNow.toISOString(),
    version: 5,
  });
  const signal = mockRead.mock.calls[0][0].signal;
  expect(mockSet.mock.calls[0][0]).toMatchObject({ entry: { statusListIndex: '23' }, signal, value: true });
  expect(mockRead.mock.calls[1][0].signal).toBe(signal);
  expect(mockMutex.mock.calls[0][2].signal).toBe(signal);
  expect(mockFinalise.mock.calls[0][1]).toMatchObject({ token: reserved.token, expectedVersion: 4, value: true });
  expect(mockClear).not.toHaveBeenCalled();
});
it.each([undefined, 'false'] as const)(
  'refuses mutation when CREDENTIAL_STATUS_MUTATION_ENABLED is %s before reservation',
  async (enabled) => {
    if (enabled === undefined) delete process.env.CREDENTIAL_STATUS_MUTATION_ENABLED;
    else process.env.CREDENTIAL_STATUS_MUTATION_ENABLED = enabled;

    await expect(setCredentialStatus(input)).rejects.toMatchObject({
      code: 'STATUS_MUTATION_DISABLED',
      statusCode: 503,
    });
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  },
);
it('skips the list rewrite when the preliminary observation already equals the request', async () => {
  mockRead.mockReset().mockResolvedValue(observation(true));
  await expect(setCredentialStatus(input)).resolves.toMatchObject({ value: true, version: 5 });
  expect(mockSet).not.toHaveBeenCalled();
});
it.each([
  ['absent', null, 'NOT_FOUND'],
  ['external', { origin: 'EXTERNAL' }, 'EXTERNAL_CREDENTIAL_STATUS_NOT_MANAGEABLE'],
])('refuses %s records before reservation', async (_name, row, code) => {
  mockTx.libraryRecord.findFirst.mockResolvedValue(row);
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code });
  expect(mockReserve).not.toHaveBeenCalled();
  expect(mockRead).not.toHaveBeenCalled();
});
it('requires captured metadata before entry selection', async () => {
  record.credential.statusCapture = 'PENDING';
  record.credential.statusEntries = [];
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_METADATA_UNAVAILABLE' });
});
it('refuses an absent purpose without manufacturing an entry', async () => {
  await expect(setCredentialStatus({ ...input, purpose: 'suspension' })).rejects.toMatchObject({
    code: 'STATUS_ENTRY_NOT_FOUND',
  });
  expect(mockReserve).not.toHaveBeenCalled();
});
it.each(['refresh', 'message', 'custom'])(
  'refuses %s before irreversibility and version validation',
  async (purpose) => {
    record.credential.statusEntries[0].statusPurpose = purpose;
    await expect(setCredentialStatus({ ...input, purpose, value: false, ifVersion: null })).rejects.toMatchObject({
      code: 'STATUS_PURPOSE_UNSUPPORTED',
    });
    expect(mockRead).not.toHaveBeenCalled();
  },
);
it('refuses multi-bit entries before irreversible clearance or a missing version', async () => {
  Object.assign(record.credential.statusEntries[0].descriptor, { statusSize: 2 });
  await expect(setCredentialStatus({ ...input, value: false, ifVersion: null })).rejects.toMatchObject({
    code: 'STATUS_ENTRY_UNSUPPORTED',
  });
  expect(mockReserve).not.toHaveBeenCalled();
});
it('refuses an index outside JavaScript safe integer range before reservation', async () => {
  record.credential.statusEntries[0].statusListIndex = '9007199254740993';

  let failure: unknown;
  try {
    await setCredentialStatus(input);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: 'STATUS_ENTRY_UNSUPPORTED' });
  expect((handleRouteError(failure) as Response).status).toBe(422);
  expect(mockReserve).not.toHaveBeenCalled();
  expect(mockRead).not.toHaveBeenCalled();
});
it('refuses revocation clearance with 409 before any provider call', async () => {
  await expect(setCredentialStatus({ ...input, value: false })).rejects.toMatchObject({ code: 'STATUS_IRREVERSIBLE' });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockReserve).not.toHaveBeenCalled();
});
it('permits suspension clearance and commits its observation', async () => {
  record.credential.statusEntries[0].statusPurpose = 'suspension';
  mockRead
    .mockReset()
    .mockResolvedValueOnce({ ...observation(true), statusPurpose: 'suspension' })
    .mockResolvedValue({ ...observation(false), statusPurpose: 'suspension' });
  await expect(setCredentialStatus({ ...input, purpose: 'suspension', value: false })).resolves.toMatchObject({
    value: false,
    statusPurpose: 'suspension',
  });
});
it.each([null, '', '1.5', '0', '2147483648'])('rejects invalid version %s without dispatch', async (ifVersion) => {
  await expect(setCredentialStatus({ ...input, ifVersion })).rejects.toMatchObject({ code: 'INVALID_IF_VERSION' });
  expect(mockRead).not.toHaveBeenCalled();
});
it('refuses stale retries before contacting the provider', async () => {
  await expect(setCredentialStatus({ ...input, ifVersion: '3' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(mockRead).not.toHaveBeenCalled();
});
it('requires attribution without choosing a tenant primary', async () => {
  record.credential.vcServiceInstanceId = null;
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_METADATA_UNAVAILABLE' });
  expect(mockRead).not.toHaveBeenCalled();
});
it.each([
  ['pending_exists', 'STATUS_OPERATION_IN_PROGRESS'],
  ['pending_expired', 'STATUS_RECOVERY_REQUIRED'],
  ['version_conflict', 'VERSION_CONFLICT'],
  ['instance_missing', 'VC_SERVICE_UNAVAILABLE'],
])('maps reservation %s without dispatch', async (outcome, code) => {
  mockReserve.mockResolvedValue(outcome);
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code });
  expect(mockRead).not.toHaveBeenCalled();
});
it('refuses dispatch after a changed reservation token', async () => {
  mockReadToken.mockResolvedValue('replacement-token');
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED' });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
it('clears intent when the deadline expires before dispatch', async () => {
  mockReserve.mockResolvedValue({ outcome: 'reserved', pendingDeadline: new Date(Date.now() - 1) });
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'VC_SERVICE_UNAVAILABLE' });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockClear).toHaveBeenCalled();
});
it.each([
  [new VcStatusReadError('secret'), 'VC_SERVICE_UNAVAILABLE', 503],
  [new VcStatusResponseInvalidError('secret'), 'VC_STATUS_RESPONSE_INVALID', 502],
  [new VcStatusEntryUnsupportedError('corrupt record', 'input'), 'RECORD_UNREADABLE', 500],
])('clears intent and maps preliminary failure %s', async (error, code, statusCode) => {
  mockRead.mockReset().mockRejectedValue(error);
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code, statusCode });
  expect(mockClear).toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
});
it('preserves the original read failure when intent cleanup fails', async () => {
  mockRead.mockReset().mockRejectedValue(new VcStatusReadError('offline'));
  const clearFailure = new Error('DB down');
  mockClear.mockRejectedValue(clearFailure);
  await expect(setCredentialStatus(input)).rejects.toMatchObject({
    code: 'VC_SERVICE_UNAVAILABLE',
    cause: expect.objectContaining({ code: 'VC_STATUS_READ_FAILED' }),
    clearFailure,
  });
});
it('preserves a definitive provider refusal when clearing its reservation fails', async () => {
  const providerError = new VcStatusSetError('provider returned 502', false, 502);
  const clearFailure = new Error('database unavailable');
  mockSet.mockRejectedValue(providerError);
  mockClear.mockRejectedValue(clearFailure);

  let failure: unknown;
  try {
    await setCredentialStatus(input);
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    code: 'VC_SERVICE_UNAVAILABLE',
    statusCode: 502,
    cause: providerError,
    clearFailure,
  });
  const response = handleRouteError(failure);
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body).toMatchObject({
    code: 'VC_SERVICE_UNAVAILABLE',
    error: expect.stringContaining('The provider refused the change. The previous confirmed value is unchanged.'),
  });
  expect(JSON.stringify(body)).not.toContain('provider returned 502');
  expect(body).toMatchObject({ error: expect.stringContaining('reservation could not be cleared') });
  expect((body.error as string).match(/reservation (?:was|could not be) cleared/g)).toEqual([
    'reservation could not be cleared',
  ]);
  expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  expect(mockLogger.warn).toHaveBeenCalledWith(
    { err: providerError, clearFailure },
    'Credential status failure and reservation clear failure',
  );
});
it('uses the shared sanitised server message for an unexpected provider-set failure', async () => {
  const providerError = new Error('provider host and token details');
  mockSet.mockRejectedValue(providerError);

  let failure: unknown;
  try {
    await setCredentialStatus(input);
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({ code: 'VC_SERVICE_UNAVAILABLE', statusCode: 503 });
  const response = handleRouteError(failure);
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toEqual({
    error: 'An unexpected error has occurred.',
    code: 'VC_SERVICE_UNAVAILABLE',
  });
  expect(JSON.stringify(body)).not.toContain('provider host');
  expect(JSON.stringify(body)).not.toContain('token details');
  // Regression: the sanitised 503 must still leave the operator the cause and the clear outcome.
  const clearOutcomeLog = mockLogger.error.mock.calls.find(
    (call) => call[1] === 'Credential status reservation clear outcome after an unexpected provider failure',
  );
  expect(clearOutcomeLog).toBeDefined();
  expect(clearOutcomeLog![0]).toMatchObject({
    err: providerError,
    reservationCleared: true,
    recordId: input.recordId,
    tenantId: input.tenantId,
  });
  expect(clearOutcomeLog![0]).toHaveProperty('correlationId');
});
it('reports a failed reservation clear on an unsupported 422 provider response', async () => {
  const providerError = new VcStatusEntryUnsupportedError('unsupported index', 'index');
  const clearFailure = new Error('database unavailable');
  mockSet.mockRejectedValue(providerError);
  mockClear.mockRejectedValue(clearFailure);

  let failure: unknown;
  try {
    await setCredentialStatus(input);
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({ code: 'STATUS_ENTRY_UNSUPPORTED', clearFailure });
  expect((failure as Error).message).toContain('reservation could not be cleared');
  expect((handleRouteError(failure) as Response).status).toBe(422);
});
it.each([
  [new VcStatusSetError('refused', false, 401), 'VC_SERVICE_UNAVAILABLE', 502],
  [new StatusListMutexTimeoutError('key'), 'STATUS_LIST_BUSY', 503],
  [new StatusListMutexBusyError('key', new Error('pool')), 'STATUS_COORDINATION_UNAVAILABLE', 503],
])('clears intent on definitive set refusal %s', async (error, code, statusCode) => {
  mockSet.mockRejectedValue(error);
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code, statusCode });
  expect(mockClear).toHaveBeenCalled();
  expect(mockFinalise).not.toHaveBeenCalled();
});
it.each([new VcStatusSetError('connection lost', true), new StatusListLockLostError('key', undefined)])(
  'retains intent on uncertain set failure %s',
  async (error) => {
    mockSet.mockRejectedValue(error);
    await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_OUTCOME_UNKNOWN' });
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockFinalise).not.toHaveBeenCalled();
  },
);
it('keeps intent when read-back fails after a successful set', async () => {
  mockRead.mockReset().mockResolvedValueOnce(observation(false)).mockRejectedValue(new VcStatusReadError('offline'));
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_OUTCOME_UNKNOWN' });
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockFinalise).not.toHaveBeenCalled();
});
it('reports a mismatching read-back without committing it', async () => {
  mockRead.mockReset().mockResolvedValue(observation(false));
  await expect(setCredentialStatus(input)).rejects.toMatchObject({
    code: 'STATUS_OUTCOME_MISMATCH',
    observed: { value: false, observedAt: applicationNow.toISOString() },
  });
  expect(mockFinalise).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
it('retains intent when the dispatcher digest differs from the reservation', async () => {
  mockGetEntry.mockImplementation(async () => ({
    ...makeEntry(),
    pendingToken: reserved.token,
    pendingConfigDigest: 'changed',
  }));
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_PROVIDER_CHANGED' });
  expect(mockFinalise).not.toHaveBeenCalled();
});
it('maps zero-row finalisation to 503 without clearing another reservation', async () => {
  mockFinalise.mockResolvedValue('token_mismatch');
  await expect(setCredentialStatus(input)).rejects.toMatchObject({
    code: 'STATUS_PERSISTENCE_FAILED',
    statusCode: 503,
  });
  expect(mockClear).not.toHaveBeenCalled();
});
it('distinguishes a failed finalisation write from a lost commit acknowledgement', async () => {
  mockFinalise.mockRejectedValue(new Error('write failed'));
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_FAILED' });
  mockFinalise.mockResolvedValue('finalised');
  mockRead.mockReset().mockResolvedValue(observation(true));
  mockTransaction
    .mockImplementationOnce((fn) => fn(mockTx))
    .mockImplementationOnce(async (fn) => {
      await fn(mockTx);
      throw new Error('commit ack lost');
    });
  await expect(setCredentialStatus(input)).rejects.toMatchObject({ code: 'STATUS_PERSISTENCE_UNCERTAIN' });
});
it('hashes canonical effective config and distinguishes different keys', async () => {
  expect(await statusConfigDigest({ a: 'x', b: 'y' })).toBe(await statusConfigDigest({ b: 'y', a: 'x' }));
  expect(await statusConfigDigest({ key: 'a' })).not.toBe(await statusConfigDigest({ key: 'b' }));
});

it('reports a known transaction rollback as failed even after finalisation returned', async () => {
  mockTransaction
    .mockImplementationOnce((fn) => fn(mockTx))
    .mockImplementationOnce(async (fn) => {
      await fn(mockTx);
      throw prismaTransactionWriteConflictError();
    });
  await expect(setCredentialStatus(input)).rejects.toMatchObject({
    code: 'STATUS_PERSISTENCE_FAILED',
    statusCode: 503,
  });
  expect(mockFinalise).toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});

it('retains intent when reservation ownership cannot be read before dispatch', async () => {
  mockReadToken.mockRejectedValue(new Error('database unavailable'));
  await expect(setCredentialStatus(input)).rejects.toMatchObject({
    code: 'STATUS_PERSISTENCE_FAILED',
    statusCode: 503,
  });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
