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
import { CredentialBatchState } from '@/lib/prisma/generated';

const jobQueue = jest.requireMock('@/lib/jobs/app-job-queue') as { startJobQueue: jest.Mock };
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
  version: '0.7.0',
  credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
};

const oversizedItem = {
  ...item,
  credentialPayload: {
    ...item.credentialPayload,
    oversized: 'x'.repeat(3000),
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MAX_BATCH_ITEMS;
  delete process.env.MAX_BATCH_REQUEST_BODY_BYTES;
  delete process.env.MAX_REQUEST_BODY_BYTES;
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

  it('accepts ordinary non-ASCII reference text', async () => {
    // Regression: the widened control-character guard must not reject ordinary non-ASCII reference text.
    const reference = 'Ref-ä-日本';
    const response = await POST(request({ items: [{ ...item, reference }] }, 'non-ascii-reference-key'), {
      tenantId: 'tenant-1',
    } as never);

    expect(response.status).toBe(202);
    expect(repository.createCredentialBatch).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ reference })] }),
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

  it('rejects a later duplicate reference after accepting distinct references', async () => {
    const distinctItems = [
      { ...item, reference: 'PO-1' },
      { ...item, reference: 'PO-2' },
    ];
    const accepted = await POST(request({ items: distinctItems }, 'distinct-key'), { tenantId: 'tenant-1' } as never);

    expect(accepted.status).toBe(202);
    expect(repository.createCredentialBatch).toHaveBeenCalledTimes(1);

    repository.createCredentialBatch.mockClear();
    jobQueue.startJobQueue.mockClear();
    const response = await POST(
      request(
        {
          items: [
            { ...item, reference: 'PO-1' },
            { ...item, reference: 'PO-2' },
            { ...item, reference: 'PO-1' },
          ],
        },
        'duplicate-key',
      ),
      { tenantId: 'tenant-1' } as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'items[2].reference: must be unique within the batch; duplicates items[0].reference',
      code: 'VALIDATION_FAILED',
    });
    expect(jobQueue.startJobQueue).not.toHaveBeenCalled();
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('reports a duplicate reference before an oversized later item', async () => {
    // Regression: duplicate-reference validation must run before item-size validation when both reject the same item.
    process.env.MAX_REQUEST_BODY_BYTES = '2048';

    const response = await POST(
      request(
        {
          items: [
            { ...item, reference: 'PO-1' },
            { ...oversizedItem, reference: 'PO-1' },
          ],
        },
        'duplicate-and-oversized-key',
      ),
      { tenantId: 'tenant-1' } as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'items[1].reference: must be unique within the batch; duplicates items[0].reference',
      code: 'VALIDATION_FAILED',
    });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('rejects a replay when only an item reference changes', async () => {
    const originalBody = { items: [{ ...item, reference: 'PO-1' }] };
    const changedBody = { items: [{ ...item, reference: 'PO-2' }] };
    const digest = await (
      await import('@/lib/api/idempotency')
    ).digestRequestBody(new Uint8Array(Buffer.from(JSON.stringify(originalBody))));
    repository.findCredentialBatchSubmission.mockResolvedValue({ id: 'batch-existing', bodyDigest: digest });

    const response = await POST(request(changedBody, 'key-1'), { tenantId: 'tenant-1' } as never);

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it.each(['', 'a'.repeat(201), 'a\u0000b', 'a\u0085b', 'a\u009Fb'])(
    'rejects an invalid reference with its indexed pointer: %j',
    async (reference) => {
      // Regression: a batch item validation error must identify the reference field at its zero-based item index.
      const response = await POST(request({ items: [{ ...item, reference }] }, 'invalid-reference-key'), {
        tenantId: 'tenant-1',
      } as never);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/^items\[0\]\.reference:/);
      expect(repository.createCredentialBatch).not.toHaveBeenCalled();
    },
  );

  it('rejects a batch over MAX_BATCH_ITEMS before checking item sizes', async () => {
    // Regression: BATCH_TOO_LARGE must win over an oversized item instead of exposing the wrong refusal.
    process.env.MAX_BATCH_ITEMS = '2';
    process.env.MAX_REQUEST_BODY_BYTES = '2048';

    const response = await POST(request({ items: [item, oversizedItem, item] }, 'key-1'), {
      tenantId: 'tenant-1',
    } as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'items: batch contains 3 items but MAX_BATCH_ITEMS is 2.',
      code: 'BATCH_TOO_LARGE',
    });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('rejects an oversized item with its zero-based item pointer', async () => {
    // Regression: an implementation that reports the first item would hide which item breached the cap.
    process.env.MAX_REQUEST_BODY_BYTES = '2048';

    const response = await POST(request({ items: [item, oversizedItem] }, 'key-1'), { tenantId: 'tenant-1' } as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'items[1]: item is 3139 bytes but MAX_REQUEST_BODY_BYTES is 2048.',
      code: 'VALIDATION_FAILED',
    });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('rejects a streamed raw body over MAX_BATCH_REQUEST_BODY_BYTES before parsing it', async () => {
    // Regression: a route that parses or buffers the body before applying the batch cap can miss the 413 boundary.
    process.env.MAX_REQUEST_BODY_BYTES = '1024';
    process.env.MAX_BATCH_REQUEST_BODY_BYTES = '1024';

    const response = await POST(request({ items: [oversizedItem] }, 'key-1'), { tenantId: 'tenant-1' } as never);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({
      error: 'The request body exceeds MAX_BATCH_REQUEST_BODY_BYTES of 1024 bytes.',
      code: 'REQUEST_BODY_TOO_LARGE',
    });
    expect(repository.findCredentialBatchSubmission).not.toHaveBeenCalled();
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('rewrites an item schema failure to bracket notation without changing its message', async () => {
    // Regression: a dotted Zod path would not identify the consumer's third item as items[2].
    const response = await POST(
      request(
        {
          items: [item, item, { ...item, credentialPayload: 'not-an-object' }],
        },
        'key-1',
      ),
      { tenantId: 'tenant-1' } as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('items[2].credentialPayload: Expected object, received string');
    expect(body.code).toBeUndefined();
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('leaves a top-level batch schema failure at its top-level pointer', async () => {
    // Regression: applying item-pointer rewriting to a top-level failure would publish a false item location.
    const response = await POST(request({ items: [] }, 'key-1'), { tenantId: 'tenant-1' } as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('items: must contain at least one item');
    expect(body.code).toBeUndefined();
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });

  it('returns the expired batch body before checking a replay digest mismatch', async () => {
    // Regression: an expired replay must not become 422 or create a second batch when its body has changed.
    repository.findCredentialBatchSubmission.mockResolvedValue({
      id: 'batch-expired',
      state: CredentialBatchState.EXPIRED,
      bodyDigest: 'different',
    });

    const response = await POST(request({ items: [item] }, 'key-1'), { tenantId: 'tenant-1' } as never);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: 'This credential batch has expired. Its credentials were not deleted.',
      code: 'BATCH_EXPIRED',
      batchId: 'batch-expired',
    });
    expect(repository.createCredentialBatch).not.toHaveBeenCalled();
  });
});
