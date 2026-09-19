import { generateOpenAPISchemas } from './schemas';
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
