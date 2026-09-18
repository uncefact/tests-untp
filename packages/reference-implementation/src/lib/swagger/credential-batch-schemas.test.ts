import {
  generateOpenAPISchemas,
  credentialBatchStatusSchema,
  credentialBatchCancelAcceptedResponseSchema,
  credentialBatchExpiredResponseSchema,
} from './schemas';
import { getApiDocs } from './swagger';
import { CredentialBatchItemState, CredentialBatchState } from '@/lib/prisma/generated';

describe('credential batch OpenAPI components', () => {
  it('documents the request and all durable status states', () => {
    const schemas = generateOpenAPISchemas();
    const request = schemas.CredentialBatchRequest as { properties: Record<string, unknown> };
    const singleRequest = schemas.CredentialIssueRequest as { properties: Record<string, unknown> };
    const status = schemas.CredentialBatchStatus as { properties: Record<string, unknown> };
    const item = (status.properties.items as { items: { properties: Record<string, unknown> } }).items;
    const requestItem = (request.properties.items as { items: { properties: Record<string, unknown> } }).items;

    expect(request.properties.items).toBeDefined();
    expect(requestItem.properties.reference).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: expect.stringContaining('Issuer-supplied item reference'),
      pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]*$',
    });
    // Regression: the published component must reject the control characters the route rejects at runtime.
    expect(singleRequest.properties).not.toHaveProperty('reference');
    expect(status.properties.state).toMatchObject({
      enum: Object.values(CredentialBatchState),
    });
    expect(item.properties.state).toMatchObject({ enum: Object.values(CredentialBatchItemState) });
    expect(item.properties).toEqual(
      expect.objectContaining({
        index: expect.any(Object),
        reference: expect.any(Object),
        state: expect.any(Object),
        credentialId: expect.any(Object),
        error: expect.any(Object),
      }),
    );
    expect(item.properties.reference).toMatchObject({
      type: 'string',
      description: expect.stringContaining('present when supplied'),
    });
    // Regression: the tenant-facing operator-confirmed failure contract must be discoverable in OpenAPI.
    expect(item.properties.error).toMatchObject({
      properties: {
        code: {
          description: expect.stringContaining('OPERATOR_CONFIRMED_FAILED'),
        },
        message: {
          description: expect.stringContaining('An operator confirmed this item was not issued.'),
        },
      },
    });
    expect(
      (item.properties.error as { properties: { code: { description: string } } }).properties.code.description,
    ).toContain('ITEM_ATTEMPTS_EXHAUSTED');
  });
});

describe('published batch cancellation contract', () => {
  type Response = { content?: { 'application/json'?: { examples?: Record<string, { value: unknown }> } } };
  type Operation = { requestBody?: unknown; responses: Record<string, Response> };
  let paths: Record<string, { get?: Operation; post?: Operation }>;
  beforeAll(async () => {
    paths = (await getApiDocs()).paths as typeof paths;
  });

  it('publishes a bodyless cancel operation with every refusal and the exact acceptance warning', () => {
    const operation = paths['/credentials/batches/{id}/cancel'].post!;
    expect(operation.requestBody).toBeUndefined();
    expect(Object.keys(operation.responses).sort()).toEqual([
      '202',
      '400',
      '401',
      '403',
      '404',
      '409',
      '410',
      '413',
      '500',
    ]);
    const accepted = operation.responses['202'].content!['application/json']!.examples!.processing.value;
    expect(credentialBatchCancelAcceptedResponseSchema.safeParse(accepted).success).toBe(true);
    expect(accepted).toMatchObject({
      state: 'RUNNING',
      counts: { processing: 1, cancelled: 4 },
      cancelRequestedAt: '2026-09-18T00:01:00.000Z',
      message:
        'Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.',
    });
    expect(operation.responses['400'].content!['application/json']!.examples!.bodyNotAllowed.value).toEqual({
      error: 'Send this request without a body.',
    });
    expect(operation.responses['404'].content!['application/json']!.examples!.notFound.value).toEqual({
      error: 'Credential batch not found.',
    });
    expect(operation.responses['409'].content!['application/json']!.examples!.notCancellable.value).toEqual({
      error: 'This credential batch cannot be cancelled because it has already settled.',
      code: 'BATCH_NOT_CANCELLABLE',
    });
    const expired = operation.responses['410'].content!['application/json']!.examples!.expired.value;
    expect(credentialBatchExpiredResponseSchema.safeParse(expired).success).toBe(true);
    expect(expired).toMatchObject({
      state: 'EXPIRED',
      items: [],
      counts: { cancelled: 4 },
      error: 'This credential batch has expired. Its credentials were not deleted.',
      code: 'BATCH_EXPIRED',
    });
  });

  it('requires the cancelled count and nullable timestamp on GET and cancellation projections', () => {
    const schemas = generateOpenAPISchemas();
    for (const name of [
      'CredentialBatchStatus',
      'CredentialBatchCancelAcceptedResponse',
      'CredentialBatchExpiredResponse',
    ]) {
      expect(schemas[name]).toMatchObject({
        required: expect.arrayContaining(['counts', 'cancelRequestedAt']),
        properties: {
          counts: {
            required: expect.arrayContaining(['cancelled']),
            properties: { cancelled: { type: 'integer', minimum: 0 } },
          },
          cancelRequestedAt: { type: 'string', nullable: true },
        },
      });
    }
    const example =
      paths['/credentials/batches/{id}'].get!.responses['200'].content!['application/json']!.examples!.cancelled.value;
    expect(credentialBatchStatusSchema.safeParse(example).success).toBe(true);
    expect(example).toMatchObject({
      state: 'CANCELLED',
      counts: { issued: 1, cancelled: 4 },
      cancelRequestedAt: '2026-09-18T00:01:00.000Z',
      items: expect.arrayContaining([
        { index: 0, state: 'ISSUED', credentialId: 'credential-1' },
        { index: 4, state: 'CANCELLED' },
      ]),
    });
  });
});
