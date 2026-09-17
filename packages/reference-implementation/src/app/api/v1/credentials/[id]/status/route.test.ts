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
const mockReconcile = jest.fn();
const mockRead = jest.fn();
jest.mock('@/lib/credentials/set-credential-status', () => ({
  setCredentialStatus: (...args: unknown[]) => mockSet(...args),
}));
jest.mock('@/lib/credentials/reconcile-credential-status', () => ({
  reconcileCredentialStatus: (...args: unknown[]) => mockReconcile(...args),
}));
jest.mock('@/lib/credentials/read-credential-status', () => ({
  readCredentialStatus: (...args: unknown[]) => mockRead(...args),
}));
import { GET } from './route';
import { PUT } from './[purpose]/route';
import { POST } from './[purpose]/reconcile/route';
import { CredentialStatusError } from '@/lib/credentials/credential-status-error';
import { ConflictError } from '@/lib/api/errors';
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
) {
  return {
    method,
    url,
    headers: new Headers({ 'If-Version': '1' }),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Request;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSet.mockResolvedValue(observation);
  mockReconcile.mockResolvedValue(observation);
  mockRead.mockResolvedValue(stored);
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
it('passes explicit provider-change acceptance to reconciliation', async () => {
  const response = await POST(request('POST', { acceptProviderChange: true, value: true }), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(observation);
  expect(mockReconcile).toHaveBeenCalledWith({
    recordId: 'credential',
    tenantId: 'tenant',
    purpose: 'suspension',
    ifVersion: '1',
    acceptProviderChange: true,
  });
});
it('rejects a coerced provider-change acknowledgement', async () => {
  const response = await POST(request('POST', { acceptProviderChange: 'true' }), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mockReconcile).not.toHaveBeenCalled();
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
it('maps corrupt stored descriptors to record errors rather than caller errors', async () => {
  mockSet.mockRejectedValue(new CredentialStatusError('RECORD_UNREADABLE', 'Contact the operator.', 500));
  const response = await PUT(request('PUT', { value: true }), context());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'RECORD_UNREADABLE' });
});
