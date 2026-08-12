import { ValidationError } from '@/lib/api/validation';
import {
  SchemaPayloadError,
  SchemaFetchFailedError,
  SchemaCompilationFailedError,
  JsonLdExpansionFailedError,
} from '@uncefact/untp-utils/validation';
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';

const mockValidateAgainstSchemas = jest.fn();
const mockValidateJsonLd = jest.fn();
// Classification itself (cause-chain walking, typed-error matching) is
// unit-tested in untp-utils; here it is mocked so these tests pin only what
// this module owns: the kind-to-code mapping and message composition.
const mockDescribeJsonLdFailure = jest.fn();

jest.mock('@uncefact/untp-utils/validation', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/validation');
  return {
    ...actual,
    validateAgainstSchemas: (...args: unknown[]) => mockValidateAgainstSchemas(...args),
    validateJsonLd: (...args: unknown[]) => mockValidateJsonLd(...args),
    describeJsonLdFailure: (...args: unknown[]) => mockDescribeJsonLdFailure(...args),
  };
});

import { validateCredentialPayload } from './validate-credential-payload';
import { contextCache } from './context-cache';

const payload = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['DigitalProductPassport'] };
const schemaUrls = ['https://example.com/schema.json'];
const loader: SchemaLoader = { load: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateCredentialPayload', () => {
  it('calls schema validation then JSON-LD validation in order, with the supplied loader', async () => {
    const callOrder: string[] = [];
    mockValidateAgainstSchemas.mockImplementation(async () => {
      callOrder.push('schema');
    });
    mockValidateJsonLd.mockImplementation(async () => {
      callOrder.push('jsonld');
    });

    await validateCredentialPayload(payload, schemaUrls, loader);

    expect(callOrder).toEqual(['schema', 'jsonld']);
    expect(mockValidateAgainstSchemas).toHaveBeenCalledWith(payload, schemaUrls, loader);
    expect(mockValidateJsonLd).toHaveBeenCalledWith(payload, { contextCache });
  });

  it('passes the same shared context cache on every call, so repeated validations reuse fetched contexts', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockResolvedValue(undefined);

    await validateCredentialPayload(payload, schemaUrls, loader);
    await validateCredentialPayload(payload, schemaUrls, loader);

    const caches = mockValidateJsonLd.mock.calls.map((call) => (call[1] as { contextCache: unknown }).contextCache);
    expect(caches[0]).toBe(contextCache);
    expect(caches[1]).toBe(contextCache);
  });

  it('does not throw when both validations resolve', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockResolvedValue(undefined);

    await expect(validateCredentialPayload(payload, schemaUrls, loader)).resolves.toBeUndefined();
  });

  it('translates SchemaPayloadError into ValidationError, joining every failure message', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(
      new SchemaPayloadError([
        { code: 'schema.payload-invalid', message: 'Missing required property "id"' },
        { code: 'schema.payload-invalid', message: 'Type must be array' },
      ]),
    );

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain('Missing required property "id"');
    expect((error as Error).message).toContain('Type must be array');
    expect((error as ValidationError).code).toBe('SCHEMA_DOCUMENT_INVALID');
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('translates other SchemaValidationError subclasses (fetch / compile) into ValidationError', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(
      new SchemaFetchFailedError('https://example.com/schema.json', new Error('connection refused')),
    );

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/Could not load schema/);
    expect((error as ValidationError).code).toBe('SCHEMA_FETCH_FAILED');
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('maps a schema compilation failure to SCHEMA_FETCH_FAILED too (deliberate: both mean the schema could not be used)', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(
      new SchemaCompilationFailedError('https://example.com/schema.json', new Error('duplicate $id')),
    );

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('SCHEMA_FETCH_FAILED');
  });

  it('translates a document-level JSON-LD failure with the classifier detail, the document code, and the cause', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    const wrapped = new JsonLdExpansionFailedError(new Error('Undefined term: foo'));
    mockValidateJsonLd.mockRejectedValue(wrapped);
    mockDescribeJsonLdFailure.mockReturnValue({ kind: 'document', detail: 'Undefined term: foo' });

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(mockDescribeJsonLdFailure).toHaveBeenCalledWith(wrapped);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain('JSON-LD validation failed');
    expect((error as ValidationError).message).toContain('Undefined term: foo');
    expect((error as ValidationError).code).toBe('JSONLD_DOCUMENT_INVALID');
    expect((error as Error).cause).toBe(wrapped);
  });

  it('translates a context-fetch JSON-LD failure with the fetch code and the classifier detail in the message', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    const wrapped = new JsonLdExpansionFailedError(new Error('wrapped'));
    mockValidateJsonLd.mockRejectedValue(wrapped);
    mockDescribeJsonLdFailure.mockReturnValue({
      kind: 'context-fetch',
      detail: 'could not fetch a remote @context: https://www.w3.org/ns/credentials/v2 returned status 429.',
    });

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('JSONLD_CONTEXT_FETCH_FAILED');
    expect((error as ValidationError).message).toContain('https://www.w3.org/ns/credentials/v2');
    expect((error as ValidationError).message).toContain('429');
    expect((error as Error).cause).toBe(wrapped);
  });

  it('attaches the schema failure as the cause of the mapped ValidationError', async () => {
    const schemaError = new SchemaPayloadError([{ code: 'schema.payload-invalid', message: 'Missing "id"' }]);
    mockValidateAgainstSchemas.mockRejectedValue(schemaError);

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).cause).toBe(schemaError);
  });

  it('rethrows non-validation errors unchanged', async () => {
    const unexpected = new Error('something else broke');
    mockValidateAgainstSchemas.mockRejectedValue(unexpected);

    await expect(validateCredentialPayload(payload, schemaUrls, loader)).rejects.toBe(unexpected);
  });
});
