import { ValidationError } from '@/lib/api/validation';
import {
  SchemaPayloadError,
  SchemaFetchFailedError,
  JsonLdExpansionFailedError,
} from '@uncefact/untp-utils/validation';
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';

const mockValidateAgainstSchemas = jest.fn();
const mockValidateJsonLd = jest.fn();

jest.mock('@uncefact/untp-utils/validation', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/validation');
  return {
    ...actual,
    validateAgainstSchemas: (...args: unknown[]) => mockValidateAgainstSchemas(...args),
    validateJsonLd: (...args: unknown[]) => mockValidateJsonLd(...args),
  };
});

import { validateCredentialPayload } from './validate-credential-payload';

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
    expect(mockValidateJsonLd).toHaveBeenCalledWith(payload);
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
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('translates other SchemaValidationError subclasses (fetch / compile) into ValidationError', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(
      new SchemaFetchFailedError('https://example.com/schema.json', new Error('connection refused')),
    );

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/Could not load schema/);
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('translates JsonLdValidationError into ValidationError', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockRejectedValue(new JsonLdExpansionFailedError(new Error('Undefined term: foo')));

    const error = await validateCredentialPayload(payload, schemaUrls, loader).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain('JSON-LD validation failed');
  });

  it('rethrows non-validation errors unchanged', async () => {
    const unexpected = new Error('something else broke');
    mockValidateAgainstSchemas.mockRejectedValue(unexpected);

    await expect(validateCredentialPayload(payload, schemaUrls, loader)).rejects.toBe(unexpected);
  });
});
