/** @jest-environment node */
const mockRecordFindFirst = jest.fn();
const mockInstanceFindUniqueOrThrow = jest.fn();
const mockQueryRaw = jest.fn();
const mockTransaction = jest.fn();
const mockRead = jest.fn();
const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: jest.fn() };
mockLogger.child.mockReturnValue(mockLogger);

const mockTx = {
  libraryRecord: { findFirst: mockRecordFindFirst },
  serviceInstance: { findUniqueOrThrow: mockInstanceFindUniqueOrThrow },
  $queryRaw: mockQueryRaw,
};

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { ...mockTx, $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
jest.mock('@/lib/api/logger', () => ({ apiLogger: mockLogger, appLogger: mockLogger }));
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  lockLibraryRecordForUpdate: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/prisma/repositories/credential-status-entry.repository', () => ({
  lockStatusServiceInstance: jest.fn().mockResolvedValue(true),
  readPendingToken: jest.fn(),
  finaliseStatusChange: jest.fn(),
  persistObservationWithoutPending: jest.fn(),
}));
jest.mock('@/lib/services/resolve-service', () => ({
  resolveServiceInstance: () => ({
    service: { getCredentialStatus: mockRead },
    config: { baseUrl: 'https://provider.example' },
  }),
}));

import {
  VcStatusEntryUnsupportedError,
  VcStatusListNotFoundError,
  VcStatusReadError,
  VcStatusResponseInvalidError,
} from '@uncefact/untp-ri-services';
import { UnprocessableError } from '@/lib/api/errors';
import { handleRouteError } from '@/lib/api/handle-route-error';
import { CredentialStatusError } from './credential-status-error';
import { reconcileCredentialStatus } from './reconcile-credential-status';

const validDescriptor = {
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '23',
};

const entry = {
  id: 'entry-a',
  credentialId: 'credential-a',
  tenantId: 'tenant-a',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '23',
  statusListVcIssuer: 'did:web:issuer.example',
  descriptor: { ...validDescriptor },
  value: false,
  observedAt: new Date('2026-09-17T01:00:00Z'),
  version: 4,
  pendingToken: 'pending-token',
  pendingValue: true,
  pendingSince: new Date('2026-09-17T00:00:00Z'),
  pendingDeadline: new Date(Date.now() - 60_000),
  pendingInstanceId: 'instance-a',
  pendingConfigDigest: 'old-digest',
};

const record = {
  statusCapture: 'CAPTURED',
  vcServiceInstanceId: 'instance-a',
  statusEntries: [entry],
};

const input = {
  recordId: 'credential-a',
  tenantId: 'tenant-a',
  purpose: 'revocation',
  ifVersion: '4',
  acceptProviderChange: true,
};

function setPendingState(pending: boolean): void {
  Object.assign(entry, {
    pendingToken: pending ? 'pending-token' : null,
    pendingValue: pending ? true : null,
    pendingSince: pending ? new Date('2026-09-17T00:00:00Z') : null,
    pendingDeadline: pending ? new Date(Date.now() - 60_000) : null,
    pendingInstanceId: pending ? 'instance-a' : null,
    pendingConfigDigest: pending ? 'old-digest' : null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockReset();
  record.statusEntries[0].descriptor = { ...validDescriptor } as never;
  mockRecordFindFirst.mockResolvedValue({ origin: 'NATIVE', credential: record });
  mockInstanceFindUniqueOrThrow.mockResolvedValue({ id: 'instance-a', serviceType: 'VC' });
  mockQueryRaw.mockResolvedValue([{ now: new Date() }]);
  mockTransaction.mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
});

it('maps an unrepresentable management entry to 422 and tells callers that retrying cannot help', async () => {
  record.statusEntries[0].descriptor = { ...validDescriptor, statusSize: 2 } as never;

  let failure: unknown;
  try {
    await reconcileCredentialStatus(input);
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({ constructor: UnprocessableError, code: 'STATUS_ENTRY_UNSUPPORTED' });
  expect((handleRouteError(failure) as Response).status).toBe(422);
  expect((failure as Error).message).toContain('pending intent is unchanged and retrying will not help');
  expect(mockRead).not.toHaveBeenCalled();
});

it('maps an invalid provider observation to 502 without clearing the pending intent', async () => {
  mockRead.mockResolvedValue({
    value: 'not-a-boolean',
    observedAt: '2026-09-17T02:00:00.000Z',
    statusPurpose: 'revocation',
    statusListCredential: entry.statusListCredential,
    statusListIndex: entry.statusListIndex,
  });

  let failure: unknown;
  try {
    await reconcileCredentialStatus(input);
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    constructor: CredentialStatusError,
    code: 'VC_STATUS_RESPONSE_INVALID',
    statusCode: 502,
  });
  expect((handleRouteError(failure) as Response).status).toBe(502);
  expect((failure as Error).message).toContain('pending intent is unchanged and retrying will not help');
  expect(mockTransaction).toHaveBeenCalledTimes(1);
});

const providerReadFailures = [
  ['unsupported stored input', new VcStatusEntryUnsupportedError('bad entry', 'input'), 'RECORD_UNREADABLE', 500],
  ['unsupported index', new VcStatusEntryUnsupportedError('bad index', 'index'), 'STATUS_ENTRY_UNSUPPORTED', 422],
  ['unsupported size', new VcStatusEntryUnsupportedError('bad size', 'statusSize'), 'STATUS_ENTRY_UNSUPPORTED', 422],
  ['unsupported purpose', new VcStatusEntryUnsupportedError('bad purpose', 'purpose'), 'STATUS_ENTRY_UNSUPPORTED', 422],
  ['invalid response', new VcStatusResponseInvalidError('bad response'), 'VC_STATUS_RESPONSE_INVALID', 502],
  ['missing list', new VcStatusListNotFoundError('missing list'), 'VC_SERVICE_UNAVAILABLE', 503],
  ['transport read', new VcStatusReadError('offline'), 'VC_SERVICE_UNAVAILABLE', 503],
  ['unclassified failure', new Error('unexpected provider failure'), 'VC_SERVICE_UNAVAILABLE', 503],
] as const;

it.each(providerReadFailures)(
  'normalises a %s provider read in both pending states',
  async (_name, failure, code, statusCode) => {
    for (const pending of [true, false]) {
      setPendingState(pending);
      mockRead.mockReset().mockRejectedValue(failure);

      let caught: unknown;
      try {
        await reconcileCredentialStatus(input);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ code });
      expect((handleRouteError(caught) as Response).status).toBe(statusCode);
      expect(caught).toBeInstanceOf(code === 'STATUS_ENTRY_UNSUPPORTED' ? UnprocessableError : CredentialStatusError);
      if (code === 'STATUS_ENTRY_UNSUPPORTED' || code === 'VC_STATUS_RESPONSE_INVALID') {
        if (pending)
          expect((caught as Error).message).toContain('pending intent is unchanged and retrying will not help');
      }
    }
  },
);

it.each([true, false])('keeps an already translated UnprocessableError class for pending=%s', async (pending) => {
  setPendingState(pending);
  mockRead.mockRejectedValue(new UnprocessableError('already translated', 'STATUS_ENTRY_UNSUPPORTED'));

  await expect(reconcileCredentialStatus(input)).rejects.toMatchObject({
    constructor: UnprocessableError,
    code: 'STATUS_ENTRY_UNSUPPORTED',
  });
});

it.each([true, false])('keeps an already translated CredentialStatusError class for pending=%s', async (pending) => {
  setPendingState(pending);
  mockRead.mockRejectedValue(new CredentialStatusError('VC_SERVICE_UNAVAILABLE', 'already translated', 503));

  await expect(reconcileCredentialStatus(input)).rejects.toMatchObject({
    constructor: CredentialStatusError,
    code: 'VC_SERVICE_UNAVAILABLE',
    statusCode: 503,
  });
});
