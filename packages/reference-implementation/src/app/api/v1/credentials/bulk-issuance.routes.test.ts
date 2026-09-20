jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth:
    (handler: (request: unknown, context: unknown) => Promise<unknown>) => (request: unknown, context: unknown) =>
      handler(request, context),
}));

const mockFindBatch = jest.fn();
const mockCreateBatch = jest.fn();
const mockGetBatch = jest.fn();
const mockStartJobQueue = jest.fn();
jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => ({
  findCredentialBatchSubmission: (...args: unknown[]) => mockFindBatch(...args),
  createCredentialBatch: (...args: unknown[]) => mockCreateBatch(...args),
  getCredentialBatchById: (...args: unknown[]) => mockGetBatch(...args),
}));
jest.mock('@/lib/jobs/app-job-queue', () => ({ startJobQueue: (...args: unknown[]) => mockStartJobQueue(...args) }));

const mockGetLibraryRecord = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  getLibraryRecordById: (...args: unknown[]) => mockGetLibraryRecord(...args),
  updateLibraryRecordAnnotations: jest.fn(),
  LibraryRecordWriteAnomalyError: class extends Error {},
}));
jest.mock('@/lib/library/library-record-view', () => ({ LibraryRecordShapeError: class extends Error {} }));
jest.mock('@/lib/library/delete-library-record', () => ({ deleteLibraryRecordAndCopy: jest.fn() }));

import type { CredentialBatchIssueDependencies } from '@/lib/credentials/issue-batch-job';
import { credentialBatchIssueHandler } from '@/lib/credentials/issue-batch-job';
import {
  CoreCredentialType,
  CredentialBatchItemState,
  CredentialBatchState,
  CredentialDetailsStatus,
  CredentialStatusCapture,
  LibraryRecordOrigin,
} from '@/lib/prisma/generated';
import { GET as getLibraryRecord } from '../library/[id]/route';
import { GET as getBatchStatus } from './batches/[id]/route';
import { POST as submitBatch } from './batches/route';

const item = (index: number) => ({
  credentialPayload: { issuer: { id: 'did:web:issuer.example' }, index },
  credentialType: 'DigitalProductPassport',
  version: '0.7.0',
});

function libraryRecordView(credentialId: string) {
  const createdAt = new Date('2026-09-17T00:00:00.000Z');
  return {
    origin: LibraryRecordOrigin.NATIVE,
    record: {
      id: credentialId,
      tenantId: 'tenant-1',
      origin: LibraryRecordOrigin.NATIVE,
      name: 'Issued credential',
      issuerName: 'Issuer',
      issuerDid: 'did:web:issuer.example',
      subjectName: 'Subject',
      subjectId: 'subject-1',
      validFrom: createdAt,
      validUntil: null,
      credentialType: 'DigitalProductPassport',
      coreCredentialType: CoreCredentialType.DPP,
      coreDataModelVersion: '0.7.0',
      detailsStatus: CredentialDetailsStatus.EXTRACTED,
      detailsError: null,
      createdAt,
      updatedAt: createdAt,
    },
    credential: {
      id: credentialId,
      tenantId: 'tenant-1',
      origin: LibraryRecordOrigin.NATIVE,
      organisationId: null,
      facilityId: null,
      productId: null,
      storageUri: `https://storage.example/${credentialId}`,
      digestMultibase: `z${credentialId}`,
      decryptionKey: null,
      statusCapture: CredentialStatusCapture.CAPTURED,
      statusCaptureError: null,
      statusCapturedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    checkRun: null,
  };
}

type JourneyItem = {
  id: string;
  batchId: string;
  tenantId: string;
  index: number;
  state: CredentialBatchItemState;
  request: ReturnType<typeof item>;
  credentialId: string | null;
  warning: unknown;
  errorClass: string | null;
  errorMessage: string | null;
  attemptToken: string | null;
  updatedAt: Date;
};

type JourneyBatch = {
  id: string;
  tenantId: string;
  correlationId: string;
  state: CredentialBatchState;
  itemCount: number;
  queuedCount: number;
  processingCount: number;
  issuedCount: number;
  failedCount: number;
  unknownCount: number;
  idempotencyKey: string;
  bodyDigest: string;
  createdAt: Date;
  settledAt: Date | null;
  expiresAt: Date | null;
  attemptToken: string | null;
  attemptStartedAt: Date | null;
  version: number;
  lastProgressAt: Date;
  items: JourneyItem[];
};

function context() {
  return {
    jobId: 'e2e-job',
    attempt: 1,
    isFinalAttempt: false,
    expireSeconds: 300,
    signal: new AbortController().signal,
  } as const;
}

function responseBody(response: unknown): Promise<Record<string, unknown>> {
  return (response as { json: () => Promise<Record<string, unknown>> }).json();
}

function batchRequest(body: unknown, key: string): Request {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(body)));
  let consumed = false;
  return {
    headers: {
      get: (name: string) =>
        ({
          'content-type': 'application/json',
          'idempotency-key': key,
        })[name.toLowerCase()] ?? null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) return { done: true };
          consumed = true;
          return { done: false, value: bytes };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Request;
}

function statusRequest(): Request {
  return { headers: { get: () => null } } as unknown as Request;
}

describe('bulk issuance end-to-end route journey', () => {
  let batch: JourneyBatch;
  let dependencies: CredentialBatchIssueDependencies;
  let issueCalls: unknown[];
  let issuedRecords: Map<string, ReturnType<typeof libraryRecordView>>;

  beforeEach(() => {
    jest.clearAllMocks();
    issueCalls = [];
    issuedRecords = new Map();
    batch = {
      id: 'batch-e2e',
      tenantId: 'tenant-1',
      correlationId: 'batch-e2e-correlation',
      state: CredentialBatchState.QUEUED,
      itemCount: 2,
      queuedCount: 2,
      processingCount: 0,
      issuedCount: 0,
      failedCount: 0,
      unknownCount: 0,
      idempotencyKey: 'journey-key',
      bodyDigest: 'digest',
      createdAt: new Date('2026-09-17T00:00:00.000Z'),
      settledAt: null,
      expiresAt: null,
      attemptToken: null,
      attemptStartedAt: null,
      version: 0,
      lastProgressAt: new Date('2026-09-17T00:00:00.000Z'),
      items: [
        {
          id: 'item-0',
          batchId: 'batch-e2e',
          tenantId: 'tenant-1',
          index: 0,
          state: CredentialBatchItemState.QUEUED,
          request: item(0),
          credentialId: null,
          warning: null,
          errorClass: null,
          errorMessage: null,
          attemptToken: null,
          updatedAt: new Date(),
        },
        {
          id: 'item-1',
          batchId: 'batch-e2e',
          tenantId: 'tenant-1',
          index: 1,
          state: CredentialBatchItemState.QUEUED,
          request: item(1),
          credentialId: null,
          warning: null,
          errorClass: null,
          errorMessage: null,
          attemptToken: null,
          updatedAt: new Date(),
        },
      ],
    };
    mockFindBatch.mockResolvedValue(null);
    mockCreateBatch.mockResolvedValue({ outcome: 'created', batchId: batch.id });
    mockStartJobQueue.mockResolvedValue({ queue: 'e2e' });
    mockGetBatch.mockImplementation(async () => batch);
    mockGetLibraryRecord.mockImplementation(async (id: string) => issuedRecords.get(id) ?? libraryRecordView(id));

    dependencies = {
      getBatch: async () => batch,
      transaction: async (callback: (tx: never) => Promise<unknown>) => callback({} as never),
      claimAttempt: async (_tx: never, input: { token: string }) => {
        if (batch.attemptToken !== null) return { applied: false };
        batch.attemptToken = input.token;
        batch.state = CredentialBatchState.RUNNING;
        batch.version += 1;
        return { applied: true };
      },
      claimNextItem: async () => {
        const next = batch.items.find((candidate) => candidate.state === CredentialBatchItemState.QUEUED);
        if (!next) return { outcome: 'empty' as const };
        next.state = CredentialBatchItemState.PROCESSING;
        next.attemptToken = batch.attemptToken;
        batch.queuedCount -= 1;
        batch.processingCount += 1;
        batch.version += 1;
        return { outcome: 'claimed' as const, item: { index: next.index, request: JSON.stringify(next.request) } };
      },
      issue: async ({ body }: { body: ReturnType<typeof item> }) => {
        issueCalls.push(body);
        return { status: 201 as const, body: { credentialId: `credential-${issueCalls.length - 1}` } };
      },
      decryptRequest: (request: string) => JSON.parse(request) as never,
      markIssued: async (_tx: never, input: { index: number; token: string; credentialId: string }) => {
        const current = batch.items[input.index];
        if (current.attemptToken !== input.token) return { outcome: 'superseded' as const };
        current.state = CredentialBatchItemState.ISSUED;
        current.credentialId = input.credentialId;
        issuedRecords.set(input.credentialId, libraryRecordView(input.credentialId));
        batch.processingCount -= 1;
        batch.issuedCount += 1;
        batch.version += 1;
        return { outcome: 'applied' as const };
      },
      markFailed: async () => ({ outcome: 'applied' as const }),
      releaseAttempt: async () => ({ applied: true }),
      settle: async () => {
        batch.state = CredentialBatchState.COMPLETED;
        batch.settledAt = new Date();
        batch.attemptToken = null;
        return { outcome: 'applied' as const, state: CredentialBatchState.COMPLETED };
      },
      checkpoint: async () => ({ outcome: 'superseded' as const }),
      now: () => new Date('2026-09-17T00:00:00.000Z'),
      queue: {} as never,
    } as unknown as CredentialBatchIssueDependencies;
  });

  it('submits, polls queued, runs the handler, polls completed and fetches a record by id', async () => {
    // Regression: the public journey must connect submission, worker outcomes and ordinary library retrieval.
    const body = { items: [item(0), item(1)] };
    const submitted = await submitBatch(batchRequest(body, 'journey-key'), { tenantId: 'tenant-1' } as never);
    expect(submitted.status).toBe(202);
    expect(await responseBody(submitted)).toEqual({
      batchId: 'batch-e2e',
      status: '/api/v1/credentials/batches/batch-e2e',
    });

    const queued = await getBatchStatus(statusRequest(), {
      tenantId: 'tenant-1',
      params: Promise.resolve({ id: 'batch-e2e' }),
    } as never);
    expect(queued.status).toBe(200);
    expect((await responseBody(queued)).state).toBe(CredentialBatchState.QUEUED);

    await credentialBatchIssueHandler(dependencies)({ batchId: 'batch-e2e', tenantId: 'tenant-1' }, context());

    const completed = await getBatchStatus(statusRequest(), {
      tenantId: 'tenant-1',
      params: Promise.resolve({ id: 'batch-e2e' }),
    } as never);
    const completedBody = await responseBody(completed);
    expect(completed.status).toBe(200);
    expect(completedBody).toMatchObject({
      state: CredentialBatchState.COMPLETED,
      counts: { total: 2, queued: 0, processing: 0, issued: 2, failed: 0 },
      items: [{ credentialId: 'credential-0' }, { credentialId: 'credential-1' }],
    });

    const record = await getLibraryRecord(statusRequest(), {
      tenantId: 'tenant-1',
      params: Promise.resolve({ id: 'credential-0' }),
    } as never);
    expect(record.status).toBe(200);
    expect(await responseBody(record)).toMatchObject({ id: 'credential-0', credential: { credentialType: 'DPP' } });
    expect(mockGetLibraryRecord).toHaveBeenCalledWith('credential-0', 'tenant-1');
    expect(issueCalls).toHaveLength(2);
  });
});
