/** @jest-environment node */
const mockRecordFindFirst = jest.fn();
const mockInstanceFindUniqueOrThrow = jest.fn();
const mockTransaction = jest.fn();
const mockRead = jest.fn();
const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: jest.fn() };
mockLogger.child.mockReturnValue(mockLogger);

const mockTx = {
  libraryRecord: { findFirst: mockRecordFindFirst },
  serviceInstance: { findUniqueOrThrow: mockInstanceFindUniqueOrThrow },
};

jest.mock('@/lib/prisma/prisma', () => ({
  prisma: { ...mockTx, $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
jest.mock('@/lib/api/logger', () => ({ apiLogger: mockLogger, appLogger: mockLogger }));
jest.mock('@/lib/prisma/repositories/credential-status-entry.repository', () => ({
  lockStatusServiceInstance: jest.fn().mockResolvedValue(true),
  readPendingToken: jest.fn(),
}));
jest.mock('@/lib/services/resolve-service', () => ({
  resolveServiceInstance: () => ({
    service: { getCredentialStatus: mockRead },
    config: { baseUrl: 'https://provider.example' },
  }),
}));

import { readStatusOperationBudgetMs } from '@/lib/config/credential-status.config';
import { readCredentialStatus } from './read-credential-status';

const descriptor = {
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '23',
};

const entry = {
  id: 'entry-a',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://issuer.example/status/1',
  statusListIndex: '23',
  statusListVcIssuer: 'did:web:issuer.example',
  descriptor,
  value: false,
  observedAt: new Date('2026-09-17T01:00:00Z'),
  valueChangedAt: null,
  version: 4,
  pendingToken: null,
  pendingValue: null,
  pendingSince: null,
  pendingDeadline: null,
  pendingInstanceId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordFindFirst.mockResolvedValue({
    origin: 'NATIVE',
    credential: {
      statusCapture: 'CAPTURED',
      statusCaptureError: null,
      vcServiceInstanceId: 'instance-a',
      vcServiceAttribution: 'ISSUANCE',
      vcServiceAttributedAt: null,
      statusEntries: [entry],
    },
  });
  mockInstanceFindUniqueOrThrow.mockResolvedValue({ id: 'instance-a', serviceType: 'VC' });
  mockTransaction.mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  mockRead.mockResolvedValue({
    value: true,
    observedAt: '2026-09-17T02:00:00.000Z',
    statusPurpose: 'revocation',
    statusListCredential: entry.statusListCredential,
    statusListIndex: entry.statusListIndex,
  });
});

it('bounds a fresh provider read, retries included, by the status operation budget', async () => {
  // Fails if the read loses its deadline: a refused read would then retry for the default 30 s whatever the budget.
  const before = Date.now();

  const result = await readCredentialStatus({ recordId: 'credential-a', tenantId: 'tenant-a', fresh: true });

  expect(result).toMatchObject({ observed: [{ entryId: 'entry-a', value: true }], failures: [] });
  const [{ deadline, signal }] = mockRead.mock.calls[0] as [{ deadline: number; signal: AbortSignal }];
  expect(deadline).toBeGreaterThanOrEqual(before + readStatusOperationBudgetMs());
  expect(deadline).toBeLessThanOrEqual(Date.now() + readStatusOperationBudgetMs());
  expect(signal.aborted).toBe(false);
});
