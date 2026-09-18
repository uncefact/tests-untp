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
      (handler: (request: unknown, context: unknown) => Promise<unknown>) =>
      async (request: unknown, context: unknown) => {
        try {
          return await handler(request, context);
        } catch (error) {
          return handleRouteError(error);
        }
      },
  };
});

jest.mock('@/lib/jobs/app-job-queue', () => ({ startJobQueue: jest.fn(async () => ({ queue: true })) }));
jest.mock('@/lib/prisma/repositories/credential-batch.repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/prisma/repositories/credential-batch.repository')>(
    '@/lib/prisma/repositories/credential-batch.repository',
  );
  return {
    ...actual,
    createCredentialBatch: jest.fn(),
    findCredentialBatchSubmission: jest.fn(),
  };
});

import { POST } from './route';

const repository = jest.requireMock('@/lib/prisma/repositories/credential-batch.repository') as {
  classifySubmission: jest.Mock;
  createCredentialBatch: jest.Mock;
  findCredentialBatchSubmission: jest.Mock;
};

function request(body: unknown, key?: string): Request {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(body)));
  let delivered = false;
  return {
    headers: { get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key ?? null : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (delivered) return { done: true as const, value: undefined };
          delivered = true;
          return { done: false as const, value: bytes };
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Request;
}

const item = {
  credentialType: 'DigitalProductPassport',
  version: '0.6.0',
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MAX_BATCH_ITEMS;
  delete process.env.MAX_BATCH_REQUEST_BODY_BYTES;
  repository.findCredentialBatchSubmission.mockResolvedValue(null);
  repository.createCredentialBatch.mockResolvedValue({ outcome: 'created', batchId: 'batch-1' });
});

describe('POST /api/v1/credentials/batches', () => {
  it('accepts an ordered batch and returns its status location', async () => {
    const response = await POST(request({ items: [item] }, 'key-1'), { tenantId: 'tenant-1' } as never);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      batchId: 'batch-1',
      status: '/api/v1/credentials/batches/batch-1',
    });
    expect(repository.createCredentialBatch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', idempotencyKey: 'key-1' }),
    );
  });

  it('refuses a submission without an idempotency key', async () => {
    const response = await POST(request({ items: [item] }), { tenantId: 'tenant-1' } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Idempotency-Key is required', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('returns the stored batch when the key is replayed', async () => {
    repository.findCredentialBatchSubmission.mockResolvedValue({ id: 'batch-existing', bodyDigest: 'digest' });
    repository.createCredentialBatch.mockResolvedValue({ outcome: 'created', batchId: 'unused' });

    const body = { items: [item] };
    const digest = await (
      await import('@/lib/api/idempotency')
    ).digestRequestBody(new Uint8Array(Buffer.from(JSON.stringify(body))));
    repository.findCredentialBatchSubmission.mockResolvedValue({ id: 'batch-existing', bodyDigest: digest });

    const response = await POST(request(body, 'key-1'), { tenantId: 'tenant-1' } as never);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      batchId: 'batch-existing',
      status: '/api/v1/credentials/batches/batch-existing',
    });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('maps a mismatching reused key to 422', async () => {
    repository.findCredentialBatchSubmission.mockResolvedValue({ id: 'batch-existing', bodyDigest: 'different' });

    const response = await POST(request({ items: [item] }, 'key-1'), { tenantId: 'tenant-1' } as never);

    expect(response.status).toBe(422);
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });
});
