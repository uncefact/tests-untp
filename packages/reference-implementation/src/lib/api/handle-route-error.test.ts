jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => mockLogger },
}));

import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  PayloadTooLargeError,
  UnprocessableError,
  ServiceRegistryError,
  ServiceInstanceNotFoundError,
  ServiceResolutionError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';
import { handleRouteError } from './handle-route-error';

interface MockResponse {
  json: () => Promise<{ error: string; code?: string }>;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handleRouteError', () => {
  it('maps ValidationError to 400', async () => {
    const res = handleRouteError(new ValidationError('bad input'));

    expect(res.status).toBe(400);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'bad input' });
  });

  it('includes the ValidationError code in the 400 body when present', async () => {
    const res = handleRouteError(new ValidationError('context fetch failed', { code: 'JSONLD_CONTEXT_FETCH_FAILED' }));

    expect(res.status).toBe(400);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'context fetch failed', code: 'JSONLD_CONTEXT_FETCH_FAILED' });
  });

  it('maps ForbiddenError to 403', async () => {
    const res = handleRouteError(new ForbiddenError('not allowed'));

    expect(res.status).toBe(403);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'not allowed' });
  });

  it('maps NotFoundError to 404', async () => {
    const res = handleRouteError(new NotFoundError('missing'));

    expect(res.status).toBe(404);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'missing' });
  });

  it('maps ConflictError to 409', async () => {
    const res = handleRouteError(new ConflictError('already exists'));

    expect(res.status).toBe(409);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'already exists' });
  });

  it('includes the ConflictError code in the 409 body when present', async () => {
    const res = handleRouteError(new ConflictError('still running', 'IDEMPOTENCY_KEY_IN_FLIGHT'));

    expect(res.status).toBe(409);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'still running', code: 'IDEMPOTENCY_KEY_IN_FLIGHT' });
  });

  it('maps PayloadTooLargeError to 413', async () => {
    const res = handleRouteError(new PayloadTooLargeError('too big'));

    expect(res.status).toBe(413);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'too big' });
  });

  it('includes the PayloadTooLargeError code in the 413 body when present', async () => {
    const res = handleRouteError(new PayloadTooLargeError('too big', 'REQUEST_BODY_TOO_LARGE'));

    expect(res.status).toBe(413);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'too big', code: 'REQUEST_BODY_TOO_LARGE' });
  });

  it('maps UnprocessableError to 422', async () => {
    const res = handleRouteError(new UnprocessableError('cannot process'));

    expect(res.status).toBe(422);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'cannot process' });
  });

  it('includes the UnprocessableError code in the 422 body when present', async () => {
    const res = handleRouteError(new UnprocessableError('body differs', 'IDEMPOTENCY_KEY_MISMATCH'));

    expect(res.status).toBe(422);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'body differs', code: 'IDEMPOTENCY_KEY_MISMATCH' });
  });

  // --- ServiceRegistryError sub-types ---

  it('maps ServiceInstanceNotFoundError to 404', async () => {
    const res = handleRouteError(new ServiceInstanceNotFoundError('inst-42'));

    expect(res.status).toBe(404);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'Service instance not found: inst-42' });
  });

  it('maps ServiceResolutionError to 500', async () => {
    const res = handleRouteError(new ServiceResolutionError('idr', 'tenant-1'));

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toContain('No service instance available');
  });

  it('maps ConfigDecryptionError to 500', async () => {
    const res = handleRouteError(new ConfigDecryptionError('inst-7'));

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toContain('Failed to decrypt');
  });

  it('maps ConfigValidationError to 500', async () => {
    const res = handleRouteError(new ConfigValidationError('inst-7', 'missing field'));

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body.error).toContain('Configuration validation failed');
  });

  it('maps generic ServiceRegistryError to 500', async () => {
    const res = handleRouteError(new ServiceRegistryError('config bad'));

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'config bad' });
  });

  // --- ServiceError ---

  it('maps ServiceError to its statusCode with code in body', async () => {
    const res = handleRouteError(new ServiceError('upstream fail', 'TEST_ERR', 502));

    expect(res.status).toBe(502);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'upstream fail', code: 'TEST_ERR' });
  });

  // --- Generic / unknown errors ---

  it('maps a generic Error to 500', async () => {
    const error = new Error('kaboom');
    const res = handleRouteError(error);

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'kaboom' });
    expect(mockLogger.error).toHaveBeenCalledWith({ err: error }, 'Unexpected error');
  });

  it('maps a non-Error value to 500 with fallback message', async () => {
    const res = handleRouteError('string error');

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
  });

  // --- Database errors (sanitised backstop) ---

  it('quotes the correlation id so the caller has something to give support', async () => {
    const { handlePipelineError } = await import('./handle-route-error');
    const { runWithRequestContext } = await import('@uncefact/untp-ri-services/logging');

    const res = await runWithRequestContext('corr-abc-123', async () =>
      handlePipelineError(new Error('session decode failed')),
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toContain('An unexpected error has occurred.');
    expect(body.error).toContain('contact support');
    // Quoted so the id is unambiguous when pasted into a support ticket.
    expect(body.error).toContain('"corr-abc-123"');
    // Still nothing of the underlying failure.
    expect(body.error).not.toContain('session decode failed');
  });

  it('quotes the correlation id on a sanitised database failure too', async () => {
    const { handleRouteError } = await import('./handle-route-error');
    const { runWithRequestContext } = await import('@uncefact/untp-ri-services/logging');
    const prismaError = Object.assign(new Error('Invalid `prisma.tenant.findUnique()` invocation'), {
      code: 'P2021',
      clientVersion: '5.0.0',
      name: 'PrismaClientKnownRequestError',
    });

    const res = await runWithRequestContext('corr-db-9', async () => handleRouteError(prismaError));
    const body = (await res.json()) as { error: string };

    expect(body.error).toContain('"corr-db-9"');
    expect(body.error).not.toContain('prisma.tenant.findUnique');
  });

  it('omits the support guidance when there is no request context to quote', async () => {
    const { handlePipelineError } = await import('./handle-route-error');

    const res = handlePipelineError(new Error('boom'));
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe('An unexpected error has occurred.');
    expect(body.error).not.toContain('contact support');
  });

  it('redacts an unmapped error through the pipeline entry point, leaving the default contract alone', async () => {
    const { handleRouteError, handlePipelineError } = await import('./handle-route-error');

    const redacted = handlePipelineError(new Error('session decode failed for issuer https://idp.internal'));
    expect(redacted.status).toBe(500);
    expect(await redacted.json()).toEqual({ error: 'An unexpected error has occurred.' });

    const defaulted = handleRouteError(new Error('session decode failed for issuer https://idp.internal'));
    expect(await defaulted.json()).toEqual({ error: 'session decode failed for issuer https://idp.internal' });
  });

  it('still maps a typed error normally through the pipeline entry point', async () => {
    const { handlePipelineError } = await import('./handle-route-error');
    const { NotFoundError } = await import('./errors');

    const res = handlePipelineError(new NotFoundError('Scheme not found'));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Scheme not found' });
  });

  it('sanitises an unhandled Prisma known request error to a generic 500', async () => {
    const dbError = new Error('Unique constraint failed on the fields: (`schemeId`,`value`,`tenantId`)');
    dbError.name = 'PrismaClientKnownRequestError';
    Object.assign(dbError, { code: 'P2002', clientVersion: '6.0.0' });

    const res = handleRouteError(dbError);

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(mockLogger.error).toHaveBeenCalledWith({ err: dbError }, 'Unhandled database error');
  });

  it('sanitises a Prisma client validation error to a generic 500', async () => {
    const dbError = new Error('Argument `id`: Invalid value provided. Expected StringFilter or String, provided Int.');
    dbError.name = 'PrismaClientValidationError';

    const res = handleRouteError(dbError);

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
    expect(mockLogger.error).toHaveBeenCalledWith({ err: dbError }, 'Unhandled database error');
  });
});
