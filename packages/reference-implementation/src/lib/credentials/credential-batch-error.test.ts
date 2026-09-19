import { ValidationError } from '@/lib/api/validation';
import { StorageStoreError, VcSignError } from '@uncefact/untp-ri-services';
import { ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { mapRouteError } from '@/lib/api/route-error-mapping';
import { projectCredentialBatchError } from './credential-batch-error';

describe('projectCredentialBatchError', () => {
  it('keeps the stable route code and message for a validation failure', () => {
    expect(
      projectCredentialBatchError(new ValidationError('issuer is required', { code: 'ISSUER_REQUIRED' }), 'batch_0'),
    ).toEqual({ code: 'ISSUER_REQUIRED', message: 'issuer is required' });
  });

  it('projects an unmapped provider fault without exposing its hostname to the tenant', () => {
    const projected = projectCredentialBatchError(new Error('TLS failure at provider.example.test'), 'batch_7');

    expect(projected).toEqual({
      code: 'UNEXPECTED',
      message:
        'The item could not be issued because the issuing service faulted; ask your operator to search the logs for correlation id batch_7.',
    });
    expect(projected.message).not.toContain('provider.example.test');
  });

  it('projects a missing service instance with a stable classification code', () => {
    expect(projectCredentialBatchError(new ServiceInstanceNotFoundError('storage-missing'), 'batch_0')).toEqual({
      code: 'SERVICE_INSTANCE_NOT_FOUND',
      message: 'Service instance not found: storage-missing',
    });
  });

  it.each([new ValidationError('invalid issuer', { code: 'ISSUER_REQUIRED' })])(
    'keeps the stored fields identical to the shared route mapping for %s',
    (error) => {
      const mapped = mapRouteError(error);
      expect(mapped).toBeDefined();
      const projected = projectCredentialBatchError(error, 'batch_0');
      expect(projected).toEqual(
        mapped && mapped.code === undefined
          ? { message: mapped.message }
          : {
              code: mapped?.code,
              message: mapped?.message,
            },
      );
    },
  );

  it.each([new VcSignError('provider busy', 429), new StorageStoreError(429, 'provider busy')])(
    'projects an adapter 429 with a tenant-safe fault message without making it a refusal',
    (error) => {
      expect(projectCredentialBatchError(error, 'batch_0')).toEqual({
        code: 'UNEXPECTED',
        message:
          'The item could not be issued because the issuing service faulted; ask your operator to search the logs for correlation id batch_0.',
      });
    },
  );
});
