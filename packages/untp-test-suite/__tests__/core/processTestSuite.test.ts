import { hasErrors } from '../../src/core/services/json-schema/validator.service';
import { readJsonFile } from '../../src/core/utils/common';
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
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item.json',
        errors: null,
      },
    ]);
  });

  it('should process the test suite and return an array of errors', async () => {
    (dynamicLoadingSchemaService as jest.Mock).mockResolvedValue({
      type: 'object',
      additionalProperties: false,
      properties: {
        parentItem: {
          $ref: '#/$defs/Item',
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

    (hasErrors as jest.Mock).mockReturnValue({
      keyword: 'type',
      dataPath: '.parentItem',
      schemaPath: '#/$defs/Item/properties/itemID/type',
      params: {
        type: 'string',
      },
      message: 'should be string',
    });

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual([
      {
        dataPath: 'test-data/parent-item.json',
        type: 'objectEvent',
        version: 'v0.0.1',
        errors: {
          keyword: 'type',
          dataPath: '.parentItem',
          schemaPath: '#/$defs/Item/properties/itemID/type',
          params: {
            type: 'string',
          },
          message: 'should be string',
        },
      },
    ]);
  });
});
