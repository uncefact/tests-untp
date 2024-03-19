import { hasErrors } from '../../src/core/services/json-schema/validator.service';
import { readJsonFile, validateCredentialConfigs } from '../../src/core/utils/common';
import { dynamicLoadingSchemaService } from '../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import {
  generateTestSuiteResultByTemplate,
  processCheckDataBySchema,
  processTestSuite,
} from '../../src/core/processTestSuite';
import { templateMapper } from '../../src/templates/mapper';
import { getTemplateName, generateFinalMessage } from '../../src/interfaces/utils/common';

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

jest.mock('../../src/templates/mapper', () => ({
  templateMapper: jest.fn(),
}));

jest.mock('../../src/interfaces/utils/common', () => ({
  getTemplateName: jest.fn(),
  generateFinalMessage: jest.fn(),
}));

describe('processTestSuite', () => {
  beforeEach(() => {
    JSON.parse = jest.fn().mockImplementation((value) => {
      return value;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should process the test suite and return PASS', async () => {
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

    (hasErrors as jest.Mock).mockReturnValue(null);

    (getTemplateName as jest.Mock).mockReturnValue('PASS');

    const finalReport = {
      finalStatus: 'PASS',
      finalMessage: 'Your credentials are UNTP compliant',
    };
    (generateFinalMessage as jest.Mock).mockReturnValue(finalReport);

    (templateMapper as jest.Mock).mockImplementation((templateName, value) => {
      if (templateName === 'finalReport') {
        return finalReport;
      }

      return {
        credentialType: `${value.type}`,
        version: `${value.version}`,
        path: `${value.dataPath}`,
        result: 'PASS',
      };
    });

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'objectEvent',
          version: 'v0.0.1',
          path: 'test-data/parent-item-object.json',
          result: 'PASS',
        },
        {
          credentialType: 'transactionEvent',
          version: 'v0.0.2',
          path: 'test-data/parent-item-transaction.json',
          result: 'PASS',
        },
      ],
      ...finalReport,
    });
  });

  it('should process the test suite with an array of errors with Ajv errors and return FAILED', async () => {
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

    (hasErrors as jest.Mock).mockImplementation((schema) => {
      return schema.properties.destinationParty ? expectedHasError : null;
    });

    (getTemplateName as jest.Mock).mockImplementation((testSuiteResult) => {
      return !testSuiteResult.errors ? 'PASS' : 'FAILED';
    });

    const finalReport = {
      finalStatus: 'FAILED',
      finalMessage: 'Your credentials are not UNTP compliant',
    };

    (templateMapper as jest.Mock).mockImplementation((templateName, value) => {
      if (templateName === 'finalReport') {
        return finalReport;
      }

      const returnValue = {
        credentialType: value.type,
        version: value.version,
        path: value.dataPath,
        result: templateName,
        error: value.errors,
      } as any;

      if (templateName !== 'FAILED') {
        delete returnValue.error;
      }

      return returnValue;
    });

    (generateFinalMessage as jest.Mock).mockReturnValue(finalReport);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'objectEvent',
          version: 'v0.0.1',
          path: 'test-data/parent-item-object.json',
          result: 'PASS',
        },
        {
          credentialType: 'transactionEvent',
          version: 'v0.0.2',
          path: 'test-data/parent-item-transaction.json',
          result: 'FAILED',
          error: expectedHasError,
        },
      ],
      ...finalReport,
    });
  });

  it('should process the test suite with an array of errors with validation errors and return FAILED', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'objectEvent',
        version: '',
        dataPath: 'test-data/parent-item-object.json',
        errors: [
          {
            message: "should have required property 'version'",
            keyword: 'required',
            dataPath: 'path/to/credentials',
          },
        ],
      },
      {
        type: 'transformationEvent',
        version: 'v0.0.2',
        dataPath: '',
        errors: [
          {
            message: "should have required property 'dataPath'",
            keyword: 'required',
            dataPath: 'path/to/credentials',
          },
        ],
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

    (getTemplateName as jest.Mock).mockImplementation((testSuiteResult) => {
      return !testSuiteResult.errors ? 'PASS' : 'FAILED';
    });

    const finalReport = {
      finalStatus: 'FAILED',
      finalMessage: 'Your credentials are not UNTP compliant',
    };

    (templateMapper as jest.Mock).mockImplementation((templateName, value) => {
      if (templateName === 'finalReport') {
        return finalReport;
      }

      const returnValue = {
        credentialType: `${value.type}`,
        version: `${value.version}`,
        path: `${value.dataPath}`,
        result: templateName,
        error: value.errors,
      } as any;

      if (templateName !== 'FAILED') {
        delete returnValue.error;
      }

      return returnValue;
    });

    (generateFinalMessage as jest.Mock).mockReturnValue(finalReport);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'transactionEvent',
          version: 'v0.0.2',
          path: 'test-data/parent-item-transaction.json',
          result: 'PASS',
        },
        {
          credentialType: 'objectEvent',
          version: '',
          path: 'test-data/parent-item-object.json',
          result: 'FAILED',
          error: [
            {
              message: "should have required property 'version'",
              keyword: 'required',
              dataPath: 'path/to/credentials',
            },
          ],
        },
        {
          credentialType: 'transformationEvent',
          version: 'v0.0.2',
          path: '',
          result: 'FAILED',
          error: [
            {
              message: "should have required property 'dataPath'",
              keyword: 'required',
              dataPath: 'path/to/credentials',
            },
          ],
        },
      ],
      ...finalReport,
    });
  });

  it('should process the test suite with return an array of errors with validation errors, hasError from Ajv and return FAILED', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'transactionEvent',
        version: '',
        dataPath: '',
        errors: [
          {
            message: "should have required property 'version'",
            keyword: 'required',
            dataPath: 'path/to/credentials',
          },
          {
            message: "should have required property 'dataPath'",
            keyword: 'required',
            dataPath: 'path/to/credentials',
          },
        ],
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
      return schema.type === 'object' ? hasErrorExpect : null;
    });

    (getTemplateName as jest.Mock).mockImplementation((testSuiteResult) => {
      return !testSuiteResult.errors ? 'PASS' : 'FAILED';
    });

    const finalReport = {
      finalStatus: 'FAILED',
      finalMessage: 'Your credentials are not UNTP compliant',
    };

    (templateMapper as jest.Mock).mockImplementation((templateName, value) => {
      if (templateName === 'finalReport') {
        return finalReport;
      }

      const returnValue = {
        credentialType: `${value.type}`,
        version: `${value.version}`,
        path: `${value.dataPath}`,
        result: templateName,
        error: value.errors,
      } as any;

      if (templateName !== 'FAILED') {
        delete returnValue.error;
      }

      return returnValue;
    });

    (generateFinalMessage as jest.Mock).mockReturnValue(finalReport);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'objectEvent',
          version: 'v0.0.2',
          path: 'test-data/parent-item-transaction.json',
          result: 'FAILED',
          error: [...hasErrorExpect],
        },
        {
          credentialType: 'transactionEvent',
          version: '',
          path: '',
          result: 'FAILED',
          error: [
            {
              message: "should have required property 'version'",
              keyword: 'required',
              dataPath: 'path/to/credentials',
            },
            {
              message: "should have required property 'dataPath'",
              keyword: 'required',
              dataPath: 'path/to/credentials',
            },
          ],
        },
      ],
      ...finalReport,
    });
  });

  it('should process the test suite and return the WARN', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'test-data/parent-item-object.json',
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
              dataPath: 'test-data/parent-item-object.json',
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
          additionalProperty: 'itemID',
        },
        message: 'should be `object`',
      },
    ];

    (hasErrors as jest.Mock).mockReturnValue(hasErrorExpect);

    (getTemplateName as jest.Mock).mockReturnValue('WARN');

    const finalReport = {
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    };

    (templateMapper as jest.Mock).mockImplementation((templateName, value) => {
      if (templateName === 'finalReport') {
        return finalReport;
      }

      return {
        credentialType: `${value.type}`,
        version: `${value.version}`,
        path: `${value.dataPath}`,
        result: value.errors && value.errors.length > 0 ? 'WARN' : 'PASS',
        warnings: {
          fieldName: value.errors[0].params.additionalProperty,
          message: value.errors[0].message,
        },
      };
    });

    (generateFinalMessage as jest.Mock).mockReturnValue(finalReport);

    const result = await processTestSuite('/untp-test-suite/src/config/credentials.json');

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'objectEvent',
          version: 'v0.0.1',
          path: 'test-data/parent-item-object.json',
          result: 'WARN',
          warnings: {
            fieldName: 'itemID',
            message: 'should be `object`',
          },
        },
      ],
      ...finalReport,
    });
  });

  it('should process the test suite and throw an error if the credentials array is empty', async () => {
    (validateCredentialConfigs as jest.Mock).mockReturnValue([]);
    (readJsonFile as jest.Mock).mockResolvedValue({ credentials: [] });

    await expect(processTestSuite('/untp-test-suite/src/config/credentials.json')).rejects.toThrow(
      'Failed to run the test suite',
    );
  });
});

describe('Error when call processCheckDataBySchema()', () => {
  it('should process the check data by schema and return the validated credentials', async () => {
    const mockCredentialConfig = {
      type: 'testType',
      version: 'testVersion',
      dataPath: 'testDataPath',
    };

    const mockError = new Error('Test error');
    (dynamicLoadingSchemaService as jest.Mock).mockRejectedValue(mockError);

    await expect(processCheckDataBySchema(mockCredentialConfig)).rejects.toThrow(
      `Failed to process check data by schema. ${mockError.message}`,
    );
  });
});

describe('Error when call generateTestSuiteResultByTemplate()', () => {
  it('should generate test suite result by template and return the credentials template', async () => {
    const mockTestSuiteResultAjv = [
      {
        type: 'testType',
        version: 'testVersion',
        dataPath: 'testDataPath',
        errors: [],
      },
    ];

    const mockError = new Error('Test error');
    (templateMapper as jest.Mock).mockRejectedValue(mockError);

    await expect(generateTestSuiteResultByTemplate(mockTestSuiteResultAjv)).rejects.toThrow(
      `Failed to generate test suite result by template. ${mockError.message}`,
    );
  });
});
