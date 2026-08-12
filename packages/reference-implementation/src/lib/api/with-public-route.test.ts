// Polyfill crypto.randomUUID for the test environment
if (!globalThis.crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...globalThis.crypto, randomUUID },
  });
}

const mockRunWithRequestContext = jest.fn((_correlationId: string, callback: () => unknown) => callback());

const mockLogger: Record<string, jest.Mock> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
};
mockLogger.child.mockReturnValue(mockLogger);

jest.mock('@uncefact/untp-ri-services/logging', () => ({
  // Real validator: the wrappers' reject-and-replace behaviour is the code under test.
  isValidCorrelationId: jest.requireActual('@uncefact/untp-ri-services/logging').isValidCorrelationId,
  runWithRequestContext: (correlationId: string, callback: () => unknown) =>
    mockRunWithRequestContext(correlationId, callback),
  createLogger: () => mockLogger,
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockHandleRouteError = jest.fn();
jest.mock('@/lib/api/handle-route-error', () => ({
  handleRouteError: (e: unknown) => mockHandleRouteError(e),
}));

import { withPublicRoute } from './with-public-route';

beforeEach(() => {
  jest.clearAllMocks();
  mockRunWithRequestContext.mockImplementation((_correlationId: string, callback: () => unknown) => callback());
});

function fakeRequest(method = 'GET', headers: Record<string, string> = {}): Request {
  const headersMap = new Map(Object.entries(headers));
  return {
    method,
    url: 'http://localhost/api/v1/credentials/verify',
    headers: {
      get: (key: string) => headersMap.get(key) ?? null,
    },
  } as unknown as Request;
}

describe('withPublicRoute', () => {
  it('calls handler and returns its response', async () => {
    const handlerResponse = { status: 200, json: async () => ({ valid: true }) };
    const handler = jest.fn().mockResolvedValue(handlerResponse);
    const wrapped = withPublicRoute(handler);

    const req = fakeRequest('POST');
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledWith(req);
    expect(res).toBe(handlerResponse);
  });

  it('extracts correlation ID from x-correlation-id header', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest('POST', { 'x-correlation-id': 'my-corr-id' }));

    expect(mockRunWithRequestContext).toHaveBeenCalledWith('my-corr-id', expect.any(Function));
  });

  it('generates UUID when no correlation ID header is present', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest());

    expect(mockRunWithRequestContext).toHaveBeenCalledTimes(1);
    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects correlation IDs with characters outside the allowed charset, warns without echoing them', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': 'Root=1-abc;Parent=def' }));

    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).not.toBe('Root=1-abc;Parent=def');
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('Root=1-abc;Parent=def');
  });

  it('ignores correlation IDs longer than 128 characters', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    const oversizedId = 'x'.repeat(200);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': oversizedId }));

    const correlationId = mockRunWithRequestContext.mock.calls[0][0];
    expect(correlationId).not.toBe(oversizedId);
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts correlation ID of exactly 128 characters', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    const exactId = 'a'.repeat(128);
    await wrapped(fakeRequest('GET', { 'x-correlation-id': exactId }));

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(exactId, expect.any(Function));
  });

  it('calls runWithRequestContext with the correlation ID', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest('POST', { 'x-correlation-id': 'test-123' }));

    expect(mockRunWithRequestContext).toHaveBeenCalledTimes(1);
    expect(mockRunWithRequestContext).toHaveBeenCalledWith('test-123', expect.any(Function));
  });

  it('logs request received and request completed on success', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 });
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest('POST'));

    expect(mockLogger.info).toHaveBeenCalledWith(
      { method: 'POST', path: '/api/v1/credentials/verify' },
      'Request received',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/credentials/verify',
        status: 200,
        durationMs: expect.any(Number),
      }),
      'Request completed',
    );
  });

  it('catches handler errors and delegates to handleRouteError', async () => {
    const error = new Error('boom');
    const errorResponse = { status: 500, json: async () => ({ error: 'boom' }) };
    mockHandleRouteError.mockReturnValue(errorResponse);

    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = withPublicRoute(handler);

    const res = await wrapped(fakeRequest('POST'));

    expect(mockHandleRouteError).toHaveBeenCalledWith(error);
    expect(res).toBe(errorResponse);
  });

  it('logs 4xx errors at warn level', async () => {
    const errorResponse = { status: 400, json: async () => ({ error: 'bad input' }) };
    mockHandleRouteError.mockReturnValue(errorResponse);

    const handler = jest.fn().mockRejectedValue(new Error('bad input'));
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest('POST'));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/credentials/verify',
        status: 400,
        durationMs: expect.any(Number),
      }),
      'Request completed with error',
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs 5xx errors at error level', async () => {
    const errorResponse = { status: 500, json: async () => ({ error: 'internal' }) };
    mockHandleRouteError.mockReturnValue(errorResponse);

    const handler = jest.fn().mockRejectedValue(new Error('internal'));
    const wrapped = withPublicRoute(handler);

    await wrapped(fakeRequest('POST'));

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/credentials/verify',
        status: 500,
        durationMs: expect.any(Number),
      }),
      'Request completed with error',
    );
  });
});
