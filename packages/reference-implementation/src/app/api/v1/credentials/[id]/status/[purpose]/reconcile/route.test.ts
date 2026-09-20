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
      (handler: (req: unknown, ctx: unknown) => Promise<Response>) => async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx);
        } catch (error) {
          return handleRouteError(error);
        }
      },
  };
});
jest.mock('@/lib/api/logger');
const mockReconcile = jest.fn();
jest.mock('@/lib/credentials/reconcile-credential-status', () => ({
  reconcileCredentialStatus: (...args: unknown[]) => mockReconcile(...args),
}));
const mockRequireVisible = jest.fn();
jest.mock('@/lib/credentials/credential-status-context', () => ({
  requireStatusRecordVisible: (...args: unknown[]) => mockRequireVisible(...args),
}));

import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { POST } from './route';

const observation = {
  entryId: 'entry',
  statusPurpose: 'suspension',
  value: false,
  observedAt: '2026-09-17T01:00:00.000Z',
  version: 2,
};

function context(purpose = 'suspension') {
  return { tenantId: 'tenant', params: Promise.resolve({ id: 'credential', purpose }) } as unknown as Parameters<
    typeof POST
  >[1];
}

function request(body: unknown, ifVersion: string | null = '1'): Request {
  const bytes = new Uint8Array(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  let delivered = false;
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/credentials/credential/status/suspension/reconcile',
    headers: new Headers(ifVersion === null ? {} : { 'If-Version': ifVersion }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockReconcile.mockResolvedValue(observation);
  mockRequireVisible.mockResolvedValue(undefined);
  delete process.env.MAX_REQUEST_BODY_BYTES;
});

it('passes explicit provider-change acceptance to reconciliation and disables caching', async () => {
  const response = await POST(request({ acceptProviderChange: true, value: true }), context());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(observation);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(mockReconcile).toHaveBeenCalledWith({
    recordId: 'credential',
    tenantId: 'tenant',
    purpose: 'suspension',
    ifVersion: '1',
    acceptProviderChange: true,
  });
});

it('records the default no-pending-change observation from an empty object', async () => {
  const response = await POST(request({}), context());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(observation);
  expect(mockReconcile).toHaveBeenCalledWith({
    recordId: 'credential',
    tenantId: 'tenant',
    purpose: 'suspension',
    ifVersion: '1',
  });
});

it('rejects a coerced provider-change acknowledgement', async () => {
  const response = await POST(request({ acceptProviderChange: 'true' }), context());

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mockReconcile).not.toHaveBeenCalled();
});

it.each(['', 'bad\u0000purpose', 'x'.repeat(256)])('rejects an invalid purpose path parameter: %j', async (purpose) => {
  const response = await POST(request({}), context(purpose));

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mockReconcile).not.toHaveBeenCalled();
});

it('reclassifies a validation error raised by reconciliation as VALIDATION_FAILED', async () => {
  mockReconcile.mockRejectedValueOnce(
    new ValidationError('If-Version header is required.', { code: 'INVALID_IF_VERSION' }),
  );

  const response = await POST(request({}), context());

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'If-Version header is required.', code: 'VALIDATION_FAILED' });
});

it.each([null, 'abc'])('publishes INVALID_IF_VERSION before body and purpose validation for %s', async (ifVersion) => {
  const response = await POST(request({ acceptProviderChange: 'true' }, ifVersion), context());

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'INVALID_IF_VERSION' });
  expect(mockReconcile).not.toHaveBeenCalled();
});

it('answers 404 for a foreign record before validating a missing If-Version', async () => {
  // Regression: existence and tenant scoping must not be observable through a header error.
  mockRequireVisible.mockRejectedValueOnce(new NotFoundError('No such credential record.', 'NOT_FOUND'));

  const response = await POST(request({ acceptProviderChange: 'true' }, null), context());

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  expect(mockReconcile).not.toHaveBeenCalled();
});

it('rejects an oversized POST body before parsing it', async () => {
  // Regression: the route must retain its documented 413 boundary when a real body-bearing Request is supplied.
  process.env.MAX_REQUEST_BODY_BYTES = '1024';

  const response = await POST(request({ padding: 'x'.repeat(1100) }), context());

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error: 'The request body exceeds the maximum of 1024 bytes.',
    code: 'REQUEST_BODY_TOO_LARGE',
  });
  expect(mockReconcile).not.toHaveBeenCalled();
});
