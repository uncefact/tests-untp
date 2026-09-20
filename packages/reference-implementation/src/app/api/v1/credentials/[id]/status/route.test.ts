jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});
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
const mockSet = jest.fn();
const mockRead = jest.fn();
jest.mock('@/lib/credentials/set-credential-status', () => ({
  setCredentialStatus: (...args: unknown[]) => mockSet(...args),
}));
jest.mock('@/lib/credentials/read-credential-status', () => ({
  readCredentialStatus: (...args: unknown[]) => mockRead(...args),
}));
const mockRequireVisible = jest.fn();
jest.mock('@/lib/credentials/credential-status-context', () => ({
  requireStatusRecordVisible: (...args: unknown[]) => mockRequireVisible(...args),
}));
import { GET } from './route';
import { PUT } from './[purpose]/route';
import { CredentialStatusError } from '@/lib/credentials/credential-status-error';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

const observation = {
  entryId: 'entry',
  statusPurpose: 'suspension',
  value: false,
  observedAt: '2026-09-17T01:00:00.000Z',
  version: 2,
};
const stored = { capture: 'CAPTURED', statusCaptureError: null, attribution: null, entries: [] };
function context(purpose = 'suspension') {
  return { tenantId: 'tenant', params: Promise.resolve({ id: 'credential', purpose }) } as unknown as Parameters<
    typeof PUT
  >[1];
}
function request(
  method: string,
  body: unknown,
  url = 'http://localhost/api/v1/credentials/credential/status/suspension',
  ifVersion: string | null = '1',
) {
  const bytes = new Uint8Array(Buffer.from(body === undefined ? '' : JSON.stringify(body)));
  let delivered = false;
  return {
    method,
    url,
    headers: new Headers(ifVersion === null ? {} : { 'If-Version': ifVersion }),
    json: jest.fn().mockResolvedValue(body),
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
  mockSet.mockResolvedValue(observation);
  mockRead.mockResolvedValue(stored);
  mockRequireVisible.mockResolvedValue(undefined);
  delete process.env.MAX_REQUEST_BODY_BYTES;
});
it('passes the path purpose and entry version while stripping unrelated set body fields', async () => {
  const response = await PUT(request('PUT', { value: false, purpose: 'revocation', extra: true }), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(observation);
  expect(mockSet).toHaveBeenCalledWith({
    recordId: 'credential',
    tenantId: 'tenant',
    purpose: 'suspension',
    value: false,
    ifVersion: '1',
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it.each([{}, { value: 'false' }, { value: null }])(
  'rejects a non-boolean set body before calling the use case',
  async (body) => {
    const response = await PUT(request('PUT', body), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockSet).not.toHaveBeenCalled();
  },
);
it.each([null, 'abc'])(
  'publishes INVALID_IF_VERSION before PUT body and purpose validation for %s',
  async (ifVersion) => {
    const response = await PUT(
      request(
        'PUT',
        { value: 'not-a-boolean' },
        'http://localhost/api/v1/credentials/credential/status/suspension',
        ifVersion,
      ),
      context(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_IF_VERSION' });
    expect(mockSet).not.toHaveBeenCalled();
  },
);
it('answers 404 for a foreign record before validating a missing If-Version', async () => {
  // Regression: existence and tenant scoping must not be observable through a header error.
  mockRequireVisible.mockRejectedValueOnce(new NotFoundError('No such credential record.', 'NOT_FOUND'));
  const response = await PUT(
    request(
      'PUT',
      { value: 'not-a-boolean' },
      'http://localhost/api/v1/credentials/credential/status/suspension',
      null,
    ),
    context(),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'No such credential record.', code: 'NOT_FOUND' });
  expect(mockSet).not.toHaveBeenCalled();
});
it.each(['', 'bad\u0000purpose', 'x'.repeat(256)])('rejects invalid purpose path parameters', async (purpose) => {
  const response = await PUT(request('PUT', { value: true }), context(purpose));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mockSet).not.toHaveBeenCalled();
});
it('reclassifies an invalid If-Version from the use case as VALIDATION_FAILED', async () => {
  mockSet.mockRejectedValueOnce(new ValidationError('If-Version header is required.', { code: 'INVALID_IF_VERSION' }));
  const response = await PUT(request('PUT', { value: true }), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('does not decode an already decoded percent escape a second time', async () => {
  await PUT(request('PUT', { value: true }), context('custom%2Fpurpose'));
  expect(mockSet.mock.calls[0][0].purpose).toBe('custom%2Fpurpose');
});
it('maps irreversibility through the shared route mapper', async () => {
  mockSet.mockRejectedValue(new ConflictError('Revocation cannot be cleared.', 'STATUS_IRREVERSIBLE'));
  const response = await PUT(request('PUT', { value: false }), context('revocation'));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'STATUS_IRREVERSIBLE' });
});
it('returns the mismatching observation without exposing its underlying cause', async () => {
  mockSet.mockRejectedValue(
    new CredentialStatusError(
      'STATUS_OUTCOME_MISMATCH',
      'Pending intent retained.',
      503,
      new Error('private provider detail'),
      { value: true, observedAt: observation.observedAt },
    ),
  );
  const response = await PUT(request('PUT', { value: false }), context());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Pending intent retained.',
    code: 'STATUS_OUTCOME_MISMATCH',
    observed: { value: true, observedAt: observation.observedAt },
  });
});
it.each([
  ['', false],
  ['?fresh=true', true],
  ['?fresh=false', false],
])('passes the explicit fresh query without caching observations', async (query, fresh) => {
  const response = await GET(
    request('GET', undefined, `http://localhost/api/v1/credentials/credential/status${query}`),
    context(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(stored);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(mockRead).toHaveBeenCalledWith({ recordId: 'credential', tenantId: 'tenant', fresh });
});
it('rejects an ambiguous fresh query', async () => {
  const response = await GET(
    request('GET', undefined, 'http://localhost/api/v1/credentials/credential/status?fresh=1'),
    context(),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mockRead).not.toHaveBeenCalled();
});
it('rejects a repeated fresh query parameter', async () => {
  const response = await GET(
    request('GET', undefined, 'http://localhost/api/v1/credentials/credential/status?fresh=true&fresh=false'),
    context(),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'fresh: repeated query parameter', code: 'VALIDATION_FAILED' });
  expect(mockRead).not.toHaveBeenCalled();
});
it('rejects an oversized PUT body before parsing it', async () => {
  // Regression: the route must retain its documented 413 boundary when a real body-bearing Request is supplied.
  process.env.MAX_REQUEST_BODY_BYTES = '1024';
  const response = await PUT(request('PUT', { value: true, padding: 'x'.repeat(1100) }), context());
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({
    error: 'The request body exceeds the maximum of 1024 bytes.',
    code: 'REQUEST_BODY_TOO_LARGE',
  });
  expect(mockSet).not.toHaveBeenCalled();
});
it('maps corrupt stored descriptors to record errors rather than caller errors', async () => {
  mockSet.mockRejectedValue(new CredentialStatusError('RECORD_UNREADABLE', 'Contact the operator.', 500));
  const response = await PUT(request('PUT', { value: true }), context());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'RECORD_UNREADABLE' });
});
