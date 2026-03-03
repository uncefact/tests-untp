jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import {
  NotFoundError,
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

  it('maps NotFoundError to 404', async () => {
    const res = handleRouteError(new NotFoundError('missing'));

    expect(res.status).toBe(404);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'missing' });
  });

  it('maps UnprocessableError to 422', async () => {
    const res = handleRouteError(new UnprocessableError('cannot process'));

    expect(res.status).toBe(422);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'cannot process' });
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
    const res = handleRouteError(new Error('kaboom'));

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'kaboom' });
  });

  it('maps a non-Error value to 500 with fallback message', async () => {
    const res = handleRouteError('string error');

    expect(res.status).toBe(500);
    const body = await (res as unknown as MockResponse).json();
    expect(body).toEqual({ error: 'An unexpected error has occurred.' });
  });
});
