import { ValidationError } from '@/lib/api/validation';

const mockValidateAgainstSchemas = jest.fn();
const mockValidateJsonLd = jest.fn();

class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

class JsonLdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLdValidationError';
  }
}

jest.mock('@uncefact/untp-ri-services', () => ({
  validateAgainstSchemas: (...args: unknown[]) => mockValidateAgainstSchemas(...args),
  validateJsonLd: (...args: unknown[]) => mockValidateJsonLd(...args),
  SchemaValidationError,
  JsonLdValidationError,
}));

import { validateCredentialPayload } from './validate-credential-payload';

const payload = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['DigitalProductPassport'] };
const schemaUrls = ['https://example.com/schema.json'];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateCredentialPayload', () => {
  it('calls schema validation then JSON-LD validation in order', async () => {
    const callOrder: string[] = [];
    mockValidateAgainstSchemas.mockImplementation(async () => {
      callOrder.push('schema');
    });
    mockValidateJsonLd.mockImplementation(async () => {
      callOrder.push('jsonld');
    });

    await validateCredentialPayload(payload, schemaUrls);

    expect(callOrder).toEqual(['schema', 'jsonld']);
    expect(mockValidateAgainstSchemas).toHaveBeenCalledWith(payload, schemaUrls);
    expect(mockValidateJsonLd).toHaveBeenCalledWith(payload);
  });

  it('does not throw when both validations pass', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockResolvedValue(undefined);

    await expect(validateCredentialPayload(payload, schemaUrls)).resolves.toBeUndefined();
  });

  it('throws ValidationError when schema validation fails', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(new SchemaValidationError('Invalid against schema'));

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow(ValidationError);
    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Invalid against schema');
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('throws ValidationError when JSON-LD validation fails', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockRejectedValue(new JsonLdValidationError('Invalid JSON-LD context'));

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow(ValidationError);
    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Invalid JSON-LD context');
  });

  it('preserves original error message in ValidationError', async () => {
    const originalMessage = 'Property "id" does not match schema constraint';
    mockValidateAgainstSchemas.mockRejectedValue(new SchemaValidationError(originalMessage));

    try {
      await validateCredentialPayload(payload, schemaUrls);
      fail('Expected validateCredentialPayload to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(originalMessage);
      expect((error as ValidationError).name).toBe('ValidationError');
    }
  });

  it('propagates non-SchemaValidationError from schema validation without wrapping', async () => {
    mockValidateAgainstSchemas.mockRejectedValue(new Error('Network timeout'));

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Network timeout');

    try {
      await validateCredentialPayload(payload, schemaUrls);
    } catch (error) {
      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('propagates non-JsonLdValidationError from JSON-LD validation without wrapping', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(undefined);
    mockValidateJsonLd.mockRejectedValue(new Error('Module not found'));

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Module not found');

    try {
      await validateCredentialPayload(payload, schemaUrls);
    } catch (error) {
      expect(error).not.toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
