import { getApiDocs } from './swagger';
import { oneLine } from './published-document';

type Response = {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: { $ref?: string }; examples?: Record<string, { value?: unknown }> }>;
};
type Operation = {
  operationId?: string;
  description?: string;
  parameters?: Array<{ $ref?: string }>;
  requestBody?: unknown;
  responses?: Record<string, Response>;
};
type Spec = { paths?: Record<string, Record<string, Operation>> };

describe('published DELETE /library/{id} contract', () => {
  let operation: Operation;

  beforeAll(async () => {
    const spec = (await getApiDocs()) as Spec;
    operation = spec.paths?.['/library/{id}']?.delete as Operation;
  });

  it('publishes the operation id and opaque path parameter without a request body', () => {
    expect(operation.operationId).toBe('deleteLibraryRecord');
    expect(operation.parameters).toEqual([{ $ref: '#/components/parameters/LibraryRecordId' }]);
    expect(operation.requestBody).toBeUndefined();
  });

  it('publishes exactly the four settled response statuses and an empty 204', () => {
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual(['204', '401', '403', '500']);
    expect(operation.responses?.['204']?.content).toBeUndefined();
    expect(operation.responses?.['401']?.$ref).toBe('#/components/responses/UnauthorisedResponse');
  });

  it('publishes the four idempotent success cases and non-revocation contract', () => {
    const description = oneLine(operation.description);
    for (const phrase of [
      'record that was deleted',
      'record already deleted',
      'no record with this id at all',
      'exists only in another tenant',
      'never revokes',
      'cleanup failure does not change the 204 response',
    ]) {
      expect(description).toContain(phrase);
    }
  });

  it('publishes both meanings of the inline 403 and the native error body', () => {
    const response = operation.responses?.['403'];
    expect(response?.description).toContain('no resolvable tenant assignment');
    expect(response?.description).toContain('cannot be removed from the library');
    expect(response?.description).toContain('foreign');
    expect(response?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ErrorResponse');
    expect(response?.content?.['application/json']?.examples?.nativeNotDeletable?.value).toEqual({
      error: 'This is a native credential record; it cannot be removed from the library.',
      code: 'NATIVE_CREDENTIAL_NOT_DELETABLE',
    });
  });

  it('publishes best-effort cleanup and sanitised repeatable transaction failure', () => {
    const description = oneLine(operation.responses?.['500']?.description);
    expect(description).toContain('transaction failed');
    expect(description).toContain('safe to repeat');
    expect(description).toContain('never reaches this response');
    expect(operation.responses?.['500']?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/ErrorResponse',
    );
  });
});
