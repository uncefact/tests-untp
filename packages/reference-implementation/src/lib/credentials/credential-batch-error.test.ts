import { ValidationError } from '@/lib/api/validation';
import { ServiceError, StorageStoreError, VcSignError } from '@uncefact/untp-ri-services';
import { ServiceInstanceNotFoundError, ServiceRegistryError } from '@/lib/api/errors';
import { mapRouteError } from '@/lib/api/route-error-mapping';
import { projectCredentialBatchError } from './credential-batch-error';

describe('projectCredentialBatchError', () => {
  it('keeps the stable route code and message for a validation failure', () => {
    expect(projectCredentialBatchError(new ValidationError('issuer is required', { code: 'ISSUER_REQUIRED' }))).toEqual(
      { code: 'ISSUER_REQUIRED', message: 'issuer is required' },
    );
  });

  it('keeps an untyped worker fault cause for operator diagnosis', () => {
    expect(projectCredentialBatchError(new Error('secret storage connection'))).toEqual({
      code: 'UNEXPECTED',
      message: 'secret storage connection',
    });
  });

  it('projects a missing service instance with a stable classification code', () => {
    expect(projectCredentialBatchError(new ServiceInstanceNotFoundError('storage-missing'))).toEqual({
      code: 'SERVICE_INSTANCE_NOT_FOUND',
      message: 'Service instance not found: storage-missing',
    });
  });

  it.each([
    new ValidationError('invalid issuer', { code: 'ISSUER_REQUIRED' }),
    new ServiceRegistryError('registry failed'),
    new ServiceError('upstream failed', 'UPSTREAM_FAILED', 502),
  ])('keeps the stored fields identical to the shared route mapping for %s', (error) => {
    const mapped = mapRouteError(error);
    expect(mapped).toBeDefined();
    const projected = projectCredentialBatchError(error);
    expect(projected).toEqual(
      mapped && mapped.code === undefined
        ? { message: mapped.message }
        : {
            code: mapped?.code,
            message: mapped?.message,
          },
    );
  });

  it.each([new VcSignError('provider busy', 429), new StorageStoreError(429, 'provider busy')])(
    'projects an adapter 429 with the same fields as its route mapping without making it a refusal',
    (error) => {
      const mapped = mapRouteError(error);
      expect(projectCredentialBatchError(error)).toEqual({ code: mapped?.code, message: mapped?.message });
    },
  );
});
