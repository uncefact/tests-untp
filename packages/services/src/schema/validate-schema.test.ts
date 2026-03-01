import { validateAgainstSchemas, SchemaValidationError } from './validate-schema';
import { fetchSchema } from './schema-cache.service';

jest.mock('./schema-cache.service', () => ({
  fetchSchema: jest.fn(),
}));

const mockFetchSchema = fetchSchema as jest.MockedFunction<typeof fetchSchema>;

describe('validateAgainstSchemas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not throw when payload conforms to schema', async () => {
    mockFetchSchema.mockResolvedValue({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });

    await expect(
      validateAgainstSchemas({ name: 'test' }, ['https://example.com/schema.json']),
    ).resolves.toBeUndefined();

    expect(mockFetchSchema).toHaveBeenCalledWith('https://example.com/schema.json');
  });

  it('throws SchemaValidationError when payload violates schema', async () => {
    mockFetchSchema.mockResolvedValue({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });

    await expect(validateAgainstSchemas({}, ['https://example.com/schema.json'])).rejects.toThrow(
      SchemaValidationError,
    );
  });

  it('includes schema URL and error details in the message', async () => {
    mockFetchSchema.mockResolvedValue({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });

    try {
      await validateAgainstSchemas({}, ['https://example.com/schema.json']);
      fail('Expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const schemaError = error as SchemaValidationError;
      expect(schemaError.message).toContain('https://example.com/schema.json');
      expect(schemaError.message).toContain('name');
      expect(schemaError.errors).toBeDefined();
      expect(schemaError.errors!.length).toBeGreaterThan(0);
    }
  });

  it('validates against multiple schemas in order', async () => {
    const coreSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    const extSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' }, extra: { type: 'number' } },
      required: ['name', 'extra'],
    };

    mockFetchSchema.mockResolvedValueOnce(coreSchema).mockResolvedValueOnce(extSchema);

    await expect(
      validateAgainstSchemas({ name: 'test', extra: 42 }, [
        'https://example.com/core.json',
        'https://example.com/ext.json',
      ]),
    ).resolves.toBeUndefined();

    expect(mockFetchSchema).toHaveBeenCalledTimes(2);
    expect(mockFetchSchema).toHaveBeenCalledWith('https://example.com/core.json');
    expect(mockFetchSchema).toHaveBeenCalledWith('https://example.com/ext.json');
  });

  it('fails on the first schema that rejects the payload', async () => {
    const coreSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    mockFetchSchema.mockResolvedValue(coreSchema);

    try {
      await validateAgainstSchemas({}, ['https://example.com/core.json', 'https://example.com/ext.json']);
      fail('Expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as SchemaValidationError).message).toContain('core.json');
      // Should not have fetched the second schema
      expect(mockFetchSchema).toHaveBeenCalledTimes(1);
    }
  });
});
