import {
  RequestBodyUnreadableError,
  ServiceInstanceNotFoundError,
  ServiceRegistryError,
  UnprocessableError,
} from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import { ServiceError } from '@uncefact/untp-ri-services';
import { mapRouteError } from './route-error-mapping';

describe('mapRouteError', () => {
  it.each([
    [new RequestBodyUnreadableError(), { status: 400, message: 'Could not read the request body' }],
    [
      new ValidationError('invalid issuer', { code: 'ISSUER_REQUIRED' }),
      { status: 400, code: 'ISSUER_REQUIRED', message: 'invalid issuer' },
    ],
    [
      new ServiceInstanceNotFoundError('svc-1'),
      { status: 404, code: 'SERVICE_INSTANCE_NOT_FOUND', message: 'Service instance not found: svc-1' },
    ],
    [new ServiceRegistryError('registry failed'), { status: 500, message: 'registry failed' }],
    [
      new UnprocessableError('body differs', 'IDEMPOTENCY_KEY_MISMATCH'),
      { status: 422, code: 'IDEMPOTENCY_KEY_MISMATCH', message: 'body differs' },
    ],
    [
      new ServiceError('upstream failed', 'UPSTREAM_FAILED', 502),
      { status: 502, code: 'UPSTREAM_FAILED', message: 'upstream failed' },
    ],
  ])('maps %s to the route fields', (error, expected) => {
    expect(mapRouteError(error)).toEqual(expected);
  });

  it('maps a database failure to a sanitised message with its correlation id', async () => {
    const { runWithRequestContext } = await import('@uncefact/untp-ri-services/logging');
    const databaseError = Object.assign(new Error('database detail'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2021',
      clientVersion: '6.0.0',
    });

    const result = await runWithRequestContext('corr-map-1', async () => mapRouteError(databaseError));

    expect(result).toEqual({
      status: 500,
      message: expect.stringContaining('"corr-map-1"'),
    });
    expect(result?.message).not.toContain('database detail');
  });

  it('returns no mapping for an ordinary Error so callers can choose their fallback', () => {
    expect(mapRouteError(new Error('ordinary failure'))).toBeUndefined();
  });
});
