jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/api/with-tenant-auth', () => {
  const { handleRouteError } = jest.requireActual('@/lib/api/handle-route-error');
  return {
    withTenantAuth:
      (handler: (req: unknown, context: unknown) => Promise<unknown>) => async (req: unknown, context: unknown) => {
        try {
          return await handler(req, context);
        } catch (error) {
          return handleRouteError(error);
        }
      },
  };
});
jest.mock('@/lib/api/logger');
jest.mock('@/lib/prisma/prisma', () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => ({
  cancelCredentialBatch: jest.fn(),
  getCredentialBatchById: jest.fn(),
}));

import { POST } from './route';
import { GET } from '../route';
import { prisma } from '@/lib/prisma/prisma';
import { cancelCredentialBatch, getCredentialBatchById } from '@/lib/prisma/repositories/credential-batch.repository';
import { unexpectedErrorMessage } from '@/lib/api/errors';
import { runWithRequestContext } from '@uncefact/untp-ri-services/logging';
import {
  CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE,
  CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE,
  CredentialBatchCounterDriftError,
} from '@/lib/credentials/credential-batch-error';

const cancel = jest.mocked(cancelCredentialBatch);
const getBatch = jest.mocked(getCredentialBatchById);
const transaction = jest.mocked(prisma.$transaction);
const logger = jest.requireMock('@/lib/api/logger').apiLogger as Record<string, jest.Mock>;
const tx = Object.freeze({});
const context = { tenantId: 'tenant-1', params: Promise.resolve({ id: 'batch-1' }) };
const message = CREDENTIAL_BATCH_CANCEL_ACCEPTED_MESSAGE;

function batch(state = 'RUNNING', reference?: string) {
  const isQueued = state === 'QUEUED';
  const isRunning = state === 'RUNNING';
  const isExpired = state === 'EXPIRED';
  return {
    id: 'batch-1',
    tenantId: 'tenant-1',
    correlationId: 'batch-correlation',
    version: 7,
    state,
    itemCount: 5,
    queuedCount: 0,
    processingCount: isRunning ? 1 : 0,
    issuedCount: isRunning || isQueued ? 0 : 1,
    failedCount: 0,
    unknownCount: 0,
    cancelledCount: isQueued ? 5 : 4,
    cancelRequestedAt: new Date('2026-09-18T00:01:00.000Z'),
    createdAt: new Date('2026-09-18T00:00:00.000Z'),
    settledAt: isRunning || isQueued ? null : new Date('2026-09-18T00:02:00.000Z'),
    items: isExpired
      ? []
      : isQueued
        ? [0, 1, 2, 3, 4].map((index) => ({
            index,
            ...(index === 0 && reference !== undefined ? { reference } : {}),
            state: 'CANCELLED',
            credentialId: null,
            warning: null,
            errorClass: null,
            errorMessage: null,
          }))
        : [0, 1, 2, 3, 4].map((index) => ({
            index,
            ...(index === 0 && reference !== undefined ? { reference } : {}),
            state: index === 0 ? (isRunning ? 'PROCESSING' : 'ISSUED') : 'CANCELLED',
            credentialId: index === 0 && !isRunning ? 'credential-1' : null,
            warning: null,
            errorClass: null,
            errorMessage: null,
          })),
  };
}

function request(body?: string, contentLength?: string): Request {
  let delivered = false;
  return {
    headers: new Headers(contentLength === undefined ? {} : { 'Content-Length': contentLength }),
    body:
      body === undefined
        ? null
        : {
            getReader: () => ({
              read: async () => {
                if (delivered) return { done: true, value: undefined };
                delivered = true;
                return { done: false, value: new Uint8Array(Buffer.from(body)) };
              },
              cancel: async () => undefined,
            }),
          },
  } as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(async (callback) => (callback as (client: unknown) => Promise<unknown>)(tx));
});

describe('POST /api/v1/credentials/batches/{id}/cancel', () => {
  it.each(['RUNNING', 'CANCELLED'])(
    'returns 202 with the repository projection after applied cancellation: %s',
    async (state) => {
      const stored = batch(state);
      cancel.mockResolvedValue({ outcome: 'applied', batch: stored } as never);
      const response = await POST(request(undefined, '0'), context as never);
      const body = await response.json();
      expect(response.status).toBe(202);
      expect(body).toEqual({
        id: 'batch-1',
        state,
        counts: {
          total: 5,
          queued: 0,
          processing: state === 'RUNNING' ? 1 : 0,
          issued: state === 'RUNNING' ? 0 : 1,
          failed: 0,
          unknown: 0,
          cancelled: 4,
        },
        createdAt: '2026-09-18T00:00:00.000Z',
        settledAt: state === 'RUNNING' ? null : '2026-09-18T00:02:00.000Z',
        cancelRequestedAt: '2026-09-18T00:01:00.000Z',
        items: [
          state === 'RUNNING'
            ? { index: 0, state: 'PROCESSING' }
            : { index: 0, state: 'ISSUED', credentialId: 'credential-1' },
          ...[1, 2, 3, 4].map((index) => ({ index, state: 'CANCELLED' })),
        ],
        message,
      });
      expect(body.code).toBeUndefined();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 15_000 });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith(tx, { batchId: 'batch-1', tenantId: 'tenant-1' });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cancel',
          batchId: 'batch-1',
          tenantId: 'tenant-1',
          batchCorrelationId: 'batch-correlation',
          cancelledCount: 4,
          outcome: 'applied',
          at: expect.any(String),
        }),
        'Credential batch operator audit',
      );
      expect((logger.warn.mock.calls[0] as unknown[])[0]).not.toHaveProperty('actor');
    },
  );

  it('redacts counter drift from the caller and returns the request correlation id', async () => {
    // Regression: counter drift must not expose tenant identifiers or internal counter names through the 500 body.
    cancel.mockRejectedValue(
      new CredentialBatchCounterDriftError({
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        batchCorrelationId: 'batch-correlation',
        cancelledRows: 1,
        queuedCount: 2,
      }),
    );
    logger.error.mockClear();

    const response = await runWithRequestContext('request-correlation', () =>
      POST(request(undefined, '0'), context as never),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: unexpectedErrorMessage('request-correlation') });
    expect(JSON.stringify(body)).not.toContain('tenant-1');
    expect(JSON.stringify(body)).not.toContain('queuedCount');
    expect(logger.error).toHaveBeenCalledWith(
      {
        correlationId: 'request-correlation',
        batchCorrelationId: 'batch-correlation',
        batchId: 'batch-1',
        tenantId: 'tenant-1',
        cancelledRows: 1,
        queuedCount: 2,
      },
      'Credential batch cancellation counter drift',
    );
  });

  it('rethrows a non-drift transaction failure to the shared database mapping', async () => {
    // Regression: an ordinary transaction failure must not be logged as counter drift with missing identifiers.
    const databaseError = Object.assign(new Error('database host and table details'), {
      name: 'PrismaClientKnownRequestError',
      clientVersion: '6.19.2',
    });
    cancel.mockRejectedValue(databaseError);
    logger.error.mockClear();

    const response = await POST(request(undefined, '0'), context as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(JSON.stringify(body)).not.toContain('database host');
    expect(logger.error.mock.calls.some((call) => call[1] === 'Credential batch cancellation counter drift')).toBe(
      false,
    );
  });

  // Regression: cancellation must retain the caller's reference on the projected cancelled item.
  it('preserves a caller-supplied reference when cancellation marks the item cancelled', async () => {
    const stored = batch('QUEUED', 'PO-1');
    cancel.mockResolvedValue({ outcome: 'applied', batch: stored } as never);

    const response = await POST(request(undefined, '0'), context as never);

    expect(response.status).toBe(202);
    expect((await response.json()).items[0]).toEqual(
      expect.objectContaining({ reference: 'PO-1', state: 'CANCELLED' }),
    );
  });

  it.each(['\0', 'abc\0def', '\0abc'])('returns 404 for a batch id containing a NUL byte: %j', async (id) => {
    const response = await POST(request(), {
      tenantId: 'tenant-1',
      params: Promise.resolve({ id }),
    } as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Credential batch not found.' });
    expect(transaction).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['RUNNING', 'QUEUED'])('returns an unchanged 202 for an already-requested %s batch', async (state) => {
    const stored = batch(state);
    const before = JSON.stringify(stored);
    cancel.mockResolvedValue({ outcome: 'already-requested', batch: stored } as never);
    getBatch.mockResolvedValue(stored as never);
    const current = await GET(request(), context as never);
    const first = await POST(request(), context as never);
    const repeat = await POST(request(), context as never);
    expect(first.status).toBe(202);
    expect(repeat.status).toBe(202);
    expect(await first.json()).toEqual({ ...(await current.json()), message });
    expect(await repeat.json()).toEqual(await first.json());
    expect((await repeat.json()).code).toBeUndefined();
    expect(stored.version).toBe(7);
    expect(JSON.stringify(stored)).toBe(before);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['{}', ' ', 'null', '{'])('rejects non-empty body %j before a transaction', async (body) => {
    const stored = batch();
    cancel.mockResolvedValue({ outcome: 'applied', batch: stored } as never);
    const response = await POST(request(body), context as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Send this request without a body.' });
    expect(stored.version).toBe(7);
    expect(transaction).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('preserves the bounded reader unreadable-body refusal', async () => {
    const req = request();
    Object.defineProperty(req, 'body', {
      value: {
        getReader: () => {
          throw new Error('connection lost');
        },
      },
    });
    const response = await POST(req, context as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Could not read the request body' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('preserves the bounded reader oversized-body refusal', async () => {
    const { readMaxRequestBodyBytes } = await import('@/lib/config/request-body-limit.config');
    const limit = readMaxRequestBodyBytes();
    const response = await POST(request(undefined, String(limit + 1)), context as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: `The request body exceeds the maximum of ${limit} bytes.`,
      code: 'REQUEST_BODY_TOO_LARGE',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['tenant-1', 'foreign-tenant'])('matches GET for an id missing from tenant %s', async (tenantId) => {
    const scoped = { ...context, tenantId };
    cancel.mockResolvedValue({ outcome: 'missing' });
    getBatch.mockResolvedValue(null);
    const response = await POST(request(), scoped as never);
    const read = await GET(request(), scoped as never);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Credential batch not found.' });
    expect(await response.json()).toEqual(await read.json());
    expect(cancel).toHaveBeenCalledWith(tx, { batchId: 'batch-1', tenantId });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['COMPLETED', 'NEEDS_ATTENTION', 'CANCELLED'])(
    'refuses settled %s with 409 without changing the version',
    async (state) => {
      const stored = batch(state);
      const before = JSON.stringify(stored);
      cancel.mockResolvedValue({ outcome: 'not-cancellable', batch: stored } as never);
      const response = await POST(request(), context as never);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: CREDENTIAL_BATCH_NOT_CANCELLABLE_MESSAGE,
        code: 'BATCH_NOT_CANCELLABLE',
      });
      expect(stored.version).toBe(7);
      expect(JSON.stringify(stored)).toBe(before);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls.filter((call) => call[1] === 'Credential batch operator audit')).toHaveLength(0);
    },
  );

  it('returns the same 410 tombstone as GET without changing the version', async () => {
    const stored = batch('EXPIRED');
    const before = JSON.stringify(stored);
    cancel.mockResolvedValue({ outcome: 'expired', batch: stored } as never);
    getBatch.mockResolvedValue(stored as never);
    const response = await POST(request(), context as never);
    const read = await GET(request(), context as never);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      id: 'batch-1',
      state: 'EXPIRED',
      counts: { total: 5, queued: 0, processing: 0, issued: 1, failed: 0, unknown: 0, cancelled: 4 },
      createdAt: '2026-09-18T00:00:00.000Z',
      settledAt: '2026-09-18T00:02:00.000Z',
      cancelRequestedAt: '2026-09-18T00:01:00.000Z',
      items: [],
      error: 'This credential batch has expired. Its credentials were not deleted.',
      code: 'BATCH_EXPIRED',
    });
    expect(await response.json()).toEqual(await read.json());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(stored.version).toBe(7);
    expect(JSON.stringify(stored)).toBe(before);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
