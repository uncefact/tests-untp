jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: { get: (name: string) => init?.headers?.[name] ?? null },
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

jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => ({
  getCredentialBatchById: jest.fn(),
}));

import { GET } from './route';
import { buildCredentialBatchExpiredBody } from '@/lib/credentials/credential-batch-error';

const repository = jest.requireMock('@/lib/prisma/repositories/credential-batch.repository') as {
  getCredentialBatchById: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/credentials/batches/{id}', () => {
  it('returns 404 when the repository cannot find a tenant-owned batch', async () => {
    repository.getCredentialBatchById.mockResolvedValue(null);
    const response = (await GET(
      { url: 'http://localhost/api/v1/credentials/batches/batch-1' } as Request,
      { tenantId: 'tenant-1', params: Promise.resolve({ id: 'batch-1' }) } as never,
    )) as unknown as { status: number; json: () => Promise<unknown> };

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Credential batch not found.' });
    expect(repository.getCredentialBatchById).toHaveBeenCalledWith('batch-1', 'tenant-1');
  });

  it.each(['\0', 'abc\0def', '\0abc'])('returns 404 for a batch id containing a NUL byte: %j', async (id) => {
    const response = (await GET(
      { url: 'http://localhost/api/v1/credentials/batches/batch-with-nul' } as Request,
      { tenantId: 'tenant-1', params: Promise.resolve({ id }) } as never,
    )) as unknown as { status: number; json: () => Promise<unknown> };

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Credential batch not found.' });
    expect(repository.getCredentialBatchById).not.toHaveBeenCalled();
  });

  it('returns an expired tombstone with its counts and 410', async () => {
    repository.getCredentialBatchById.mockResolvedValue({
      id: 'batch-expired',
      state: 'EXPIRED',
      itemCount: 3,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 2,
      failedCount: 1,
      unknownCount: 0,
      cancelledCount: 0,
      cancelRequestedAt: null,
      createdAt: new Date('2026-09-17T00:00:00.000Z'),
      settledAt: new Date('2026-09-17T01:00:00.000Z'),
      items: [],
    });
    const response = (await GET(
      { url: 'http://localhost/api/v1/credentials/batches/batch-expired' } as Request,
      { tenantId: 'tenant-1', params: Promise.resolve({ id: 'batch-expired' }) } as never,
    )) as unknown as {
      status: number;
      headers: { get: (name: string) => string | null };
      json: () => Promise<Record<string, unknown>>;
    };

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      id: 'batch-expired',
      state: 'EXPIRED',
      counts: { total: 3, queued: 0, processing: 0, issued: 2, failed: 1, unknown: 0, cancelled: 0 },
      cancelRequestedAt: null,
      createdAt: '2026-09-17T00:00:00.000Z',
      settledAt: '2026-09-17T01:00:00.000Z',
      items: [],
      ...buildCredentialBatchExpiredBody(),
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns the complete projection for an active batch', async () => {
    repository.getCredentialBatchById.mockResolvedValue({
      id: 'batch-complete',
      state: 'COMPLETED',
      itemCount: 2,
      queuedCount: 0,
      processingCount: 0,
      issuedCount: 1,
      failedCount: 1,
      unknownCount: 0,
      cancelledCount: 0,
      cancelRequestedAt: null,
      createdAt: new Date('2026-09-17T00:00:00.000Z'),
      settledAt: new Date('2026-09-17T01:00:00.000Z'),
      items: [
        {
          index: 0,
          state: 'ISSUED',
          credentialId: 'credential-0',
          warning: { code: 'DETAILS_EXTRACTION_FAILED', message: 'warning' },
          errorClass: null,
          errorMessage: null,
        },
        {
          index: 1,
          state: 'FAILED',
          credentialId: null,
          warning: null,
          errorClass: 'ISSUER_INVALID',
          errorMessage: 'issuer is invalid',
        },
      ],
    });

    const response = (await GET(
      { url: 'http://localhost/api/v1/credentials/batches/batch-complete' } as Request,
      { tenantId: 'tenant-1', params: Promise.resolve({ id: 'batch-complete' }) } as never,
    )) as unknown as { status: number; headers: Headers; json: () => Promise<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'batch-complete',
      state: 'COMPLETED',
      counts: { total: 2, queued: 0, processing: 0, issued: 1, failed: 1, unknown: 0, cancelled: 0 },
      cancelRequestedAt: null,
      createdAt: '2026-09-17T00:00:00.000Z',
      settledAt: '2026-09-17T01:00:00.000Z',
      items: [
        {
          index: 0,
          state: 'ISSUED',
          credentialId: 'credential-0',
          warning: { code: 'DETAILS_EXTRACTION_FAILED', message: 'warning' },
        },
        { index: 1, state: 'FAILED', error: { code: 'ISSUER_INVALID', message: 'issuer is invalid' } },
      ],
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
