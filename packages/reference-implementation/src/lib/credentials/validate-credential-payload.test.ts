import { ValidationError } from '@/lib/api/validation';

const mockValidateAgainstSchemas = jest.fn();
const mockValidateJsonLd = jest.fn();

jest.mock('@uncefact/untp-utils/validation', () => ({
  validateAgainstSchemas: (...args: unknown[]) => mockValidateAgainstSchemas(...args),
  validateJsonLd: (...args: unknown[]) => mockValidateJsonLd(...args),
}));

import { validateCredentialPayload } from './validate-credential-payload';

const payload = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['DigitalProductPassport'] };
const schemaUrls = ['https://example.com/schema.json'];

const emptyOutcome = { errors: [], warnings: [] };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateCredentialPayload', () => {
  it('calls schema validation then JSON-LD validation in order', async () => {
    const callOrder: string[] = [];
    mockValidateAgainstSchemas.mockImplementation(async () => {
      callOrder.push('schema');
      return emptyOutcome;
    });
    mockValidateJsonLd.mockImplementation(async () => {
      callOrder.push('jsonld');
      return emptyOutcome;
    });

    await validateCredentialPayload(payload, schemaUrls);

    expect(callOrder).toEqual(['schema', 'jsonld']);
    expect(mockValidateAgainstSchemas).toHaveBeenCalledWith(payload, schemaUrls);
    expect(mockValidateJsonLd).toHaveBeenCalledWith(payload);
  });

  it('does not throw when both validations return empty outcomes', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(emptyOutcome);
    mockValidateJsonLd.mockResolvedValue(emptyOutcome);

    await expect(validateCredentialPayload(payload, schemaUrls)).resolves.toBeUndefined();
  });

  it('throws ValidationError when schema validation surfaces errors', async () => {
    mockValidateAgainstSchemas.mockResolvedValue({
      errors: [{ code: 'schema.payload-invalid', message: 'Invalid against schema' }],
      warnings: [],
    });

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow(ValidationError);
    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Invalid against schema');
    expect(mockValidateJsonLd).not.toHaveBeenCalled();
  });

  it('throws ValidationError when JSON-LD validation surfaces errors', async () => {
    mockValidateAgainstSchemas.mockResolvedValue(emptyOutcome);
    mockValidateJsonLd.mockResolvedValue({
      errors: [{ code: 'jsonld.expansion-failed', message: 'Invalid JSON-LD context' }],
      warnings: [],
    });

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow(ValidationError);
    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Invalid JSON-LD context');
  });

  it('combines multiple schema errors into the thrown message', async () => {
    mockValidateAgainstSchemas.mockResolvedValue({
      errors: [
        { code: 'schema.payload-invalid', message: 'Missing required property "id"' },
        { code: 'schema.payload-invalid', message: 'Type must be array' },
      ],
      warnings: [],
    });

    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Missing required property "id"');
    await expect(validateCredentialPayload(payload, schemaUrls)).rejects.toThrow('Type must be array');
  });
});
