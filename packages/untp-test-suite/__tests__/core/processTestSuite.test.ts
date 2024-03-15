import { hasErrors } from '../../src/core/services/json-schema/validator.service';
import { readJsonFile, validateCredentialConfigs } from '../../src/core/utils/common';
import { dynamicLoadingSchemaService } from '../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import { processTestSuite } from '../../src/core/processTestSuite';

jest.mock('path', () => ({
  resolve: jest.fn(),
}));

jest.mock('../../src/core/services/json-schema/validator.service', () => ({
  hasErrors: jest.fn(),
}));

jest.mock('../../src/core/utils/common', () => ({
  readJsonFile: jest.fn().mockResolvedValue({}),
  validateCredentialConfigs: jest.fn(),
}));

jest.mock('../../src/core/services/dynamic-loading-schemas/loadingSchema.service', () => ({
  dynamicLoadingSchemaService: jest.fn(),
}));

describe('processTestSuite', () => {
  it('should process the test suite and return an array of null', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item-object.json',
        errors: null,
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
    ]);
    (dynamicLoadingSchemaService as jest.Mock).mockResolvedValue({
      type: 'object',
      additionalProperties: false,
      properties: {
        parentItem: {
          type: 'string',
          example: 'object',
          description:
            'The unique item identifier that is the result of this aggreation. Typcially a packaging ID used in shipments that represents a box/ pallet / container of contained items.',
        },
      },
    });

    (readJsonFile as jest.Mock).mockImplementation(async (filePath: string) => {
      if (filePath.includes('/untp-test-suite/src/config/credentials.json')) {
        return [
          {
            type: 'objectEvent',
            version: 'v0.0.1',
            dataPath: 'test-data/parent-item-object.json',
            errors: null,
          },
          {
            type: 'transactionEvent',
            version: 'v0.0.2',
            dataPath: 'test-data/parent-item-transaction.json',
            errors: null,
          },
        ];
      }

      return {
        parentItem: {
          itemID: 'https://example.com/product/12345',
          name: 'Product A',
        },
      };
    });

    (hasErrors as jest.Mock).mockReturnValue(null);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual([
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item-object.json',
        errors: null,
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
    ]);
  });

  it('should process the test suite and return an array of errors with Ajv errors', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item-object.json',
        errors: null,
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
    ]);

    (dynamicLoadingSchemaService as jest.Mock).mockImplementation(async (type, version) => {
      if (type === 'objectEvent') {
        return {
          type: 'object',
          additionalProperties: false,
          properties: {
            parentItem: {
              type: 'string',
              example: 'object',
              description:
                'The unique item identifier that is the result of this aggreation. Typcially a packaging ID used in shipments that represents a box/ pallet / container of contained items.',
            },
          },
        };
      }
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceParty: {
            $ref: '#/$defs/Party',
            description: 'The source party for this supply chain transaction - typcially the seller party',
          },
          destinationParty: {
            $ref: '#/$defs/Party',
            description: 'The destination party for this supply chain transaction - typcially the buyer party.',
          },
        },
      };
    });

    (readJsonFile as jest.Mock).mockImplementation(async (filePath: string) => {
      if (filePath.includes('/untp-test-suite/src/config/credentials.json')) {
        return [
          {
            type: 'objectEvent',
            version: 'v0.0.1',
            dataPath: 'test-data/parent-item-object.json',
          },
          {
            type: 'transactionEvent',
            version: 'v0.0.2',
            dataPath: 'test-data/parent-item-transaction.json',
          },
        ];
      }

      return {
        parentItem: {
          itemID: 'https://example.com/product/12345',
          name: 'Product A',
        },
      };
    });

    const expectedHasError = [
      {
        keyword: 'type',
        dataPath: '.parentItem',
        schemaPath: '#/$defs/Item/properties/itemID/type',
        params: {
          type: 'string',
        },
        message: 'should be string',
      },
    ];

    (hasErrors as jest.Mock).mockImplementation((schema, data) => {
      if (schema.properties.destinationParty) {
        return expectedHasError;
      }

      return null;
    });

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual([
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item-object.json',
        errors: null,
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: expectedHasError,
      },
    ]);
  });

  it('should process the test suite and return an array of errors with validation errors', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'objectEvent',
        version: '',
        dataPath: 'test-data/parent-item-object.json',
        errors: 'should have required property `version`',
      },
      {
        type: 'transformationEvent',
        version: 'v0.0.2',
        dataPath: '',
        errors: 'should have required property `dataPath`',
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
    ]);
    (dynamicLoadingSchemaService as jest.Mock).mockResolvedValue({
      type: 'object',
      additionalProperties: false,
      properties: {
        parentItem: {
          type: 'string',
          example: 'object',
          description:
            'The unique item identifier that is the result of this aggreation. Typcially a packaging ID used in shipments that represents a box/ pallet / container of contained items.',
        },
      },
    });
    (readJsonFile as jest.Mock).mockImplementation(async (filePath: string) => {
      if (filePath.includes('/untp-test-suite/src/config/credentials.json')) {
        return {
          credentials: [
            {
              type: 'objectEvent',
              version: 'v0.0.1',
              dataPath: 'test-data/parent-item.json',
            },
          ],
        };
      }

      return {
        parentItem: {
          itemID: 'https://example.com/product/12345',
          name: 'Product A',
        },
      };
    });

    (hasErrors as jest.Mock).mockReturnValue(null);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual([
      {
        type: 'transactionEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
      {
        type: 'objectEvent',
        version: '',
        dataPath: 'test-data/parent-item-object.json',
        errors: 'should have required property `version`',
      },
      {
        type: 'transformationEvent',
        version: 'v0.0.2',
        dataPath: '',
        errors: 'should have required property `dataPath`',
      },
    ]);
  });

  it.only('should process the test suite and return an array of errors with validation errors and hasError from Ajv', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'transactionEvent',
        version: '',
        dataPath: 'test-data/parent-item-object.json',
        errors: 'should have required property `version`',
      },
      {
        type: 'objectEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: null,
      },
    ]);

    (dynamicLoadingSchemaService as jest.Mock).mockImplementation(async (type) => {
      if (type === 'objectEvent') {
        return {
          type: 'object',
          additionalProperties: false,
          properties: {
            parentItem: {
              type: 'string',
              example: 'object',
              description:
                'The unique item identifier that is the result of this aggreation. Typcially a packaging ID used in shipments that represents a box/ pallet / container of contained items.',
            },
          },
        };
      }
      return {
        type: 'string',
        additionalProperties: false,
        describe: 'Test description',
      };
    });
    (readJsonFile as jest.Mock).mockImplementation(async (filePath: string) => {
      if (filePath.includes('/untp-test-suite/src/config/credentials.json')) {
        return {
          credentials: [
            {
              type: 'objectEvent',
              version: 'v0.0.1',
              dataPath: 'test-data/parent-item.json',
            },
          ],
        };
      }

      return {
        parentItem: {
          itemID: 'https://example.com/product/12345',
          name: 'Product A',
        },
      };
    });

    const hasErrorExpect = [
      {
        keyword: 'type',
        dataPath: '.parentItem',
        schemaPath: '#/$defs/Item/properties/itemID/type',
        params: {
          type: 'object',
        },
        message: 'should be `object`',
      },
    ];

    (hasErrors as jest.Mock).mockImplementation((schema) => {
      if (schema.type === 'object') {
        return hasErrorExpect;
      }

      return null;
    });
    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual([
      {
        type: 'objectEvent',
        version: 'v0.0.2',
        dataPath: 'test-data/parent-item-transaction.json',
        errors: hasErrorExpect,
      },
      {
        type: 'transactionEvent',
        version: '',
        dataPath: 'test-data/parent-item-object.json',
        errors: 'should have required property `version`',
      },
    ]);
  });

  it('should process the test suite and throw an error if the credentials array is empty', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([]);
    (readJsonFile as jest.Mock).mockResolvedValue({ credentials: [] });

    try {
      await processTestSuite('/untp-test-suite/src/config/credentials.json');
    } catch (error) {
      expect(error).toEqual(
        new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.'),
      );
    }
  });
});
