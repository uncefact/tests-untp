import * as testSuiteCore from '../../../src/core/processTestSuite';
import * as commonUtils from '../../../src/interfaces/utils/common';
import * as templateMapperUtils from '../../../src/templates/mapper';
import * as loadingSchemaService from '../../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import * as validatorService from '../../../src/core/services/json-schema/validator.service';
import { testMultiCredentialHandler, testCredentialHandler } from '../../../src/interfaces/lib/testSuiteHandler';
import { FinalStatus, TestSuiteMessage } from '../../../src/core/types';
import schema from '../../../src/schemas/aggregationEvent/v0.0.1/schema.json';

jest.mock('../../../src/utils/path', () => ({
  getCurrentDirPath: jest.fn(() => 'test/data'),
  getCurrentFilePath: jest.fn(() => 'test/data/test.ts'),
}));

describe('testMultiCredentialHandler', () => {
  it('should test a single credential return a pass message when provided a ConfigCredentials object', async () => {
    const configCredentials = {
      credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }],
    };
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockResolvedValue({
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '/data/aggregationEvent.json',
      errors: null,
    });
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '/data/aggregationEvent.json',
        result: FinalStatus.pass,
      },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.pass,
        finalMessage: TestSuiteMessage.Pass,
      }),
    );

    const result = await testMultiCredentialHandler(configCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: FinalStatus.pass,
        },
      ],
      finalStatus: FinalStatus.pass,
      finalMessage: TestSuiteMessage.Pass,
    });
  });

  it('should test a single credential return a warning message when provided a ConfigCredentials object have a additional field', async () => {
    const warningConfigCredentials = { credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }] };
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockResolvedValue({
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '/data/aggregationEvent.json',
      errors: [
        {
          keyword: 'additionalProperties',
          instancePath: '/test',
          schemaPath: '/',
          message: 'should NOT have additional properties',
          params: {
            additionalProperty: 'testProperty',
          },
        },
      ],
    });
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '/data/aggregationEvent.json',
        result: FinalStatus.warn,
        warnings: [
          JSON.stringify({
            fieldName: 'testProperty',
            message: 'This schema should NOT have additional properties',
          }),
        ],
      },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.warn,
        finalMessage: TestSuiteMessage.Warning,
      }),
    );

    const result = await testMultiCredentialHandler(warningConfigCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: FinalStatus.warn,
          warnings: [
            JSON.stringify({
              fieldName: 'testProperty',
              message: 'This schema should NOT have additional properties',
            }),
          ],
        },
      ],
      finalStatus: FinalStatus.warn,
      finalMessage: TestSuiteMessage.Warning,
    });
  });

  it('should test a single credential return a fail message when provided a invalid ConfigCredentials object', async () => {
    const invalidConfigCredentials = { credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }] };
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockResolvedValue({
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '/data/aggregationEvent.json',
      errors: [{
        keyword: 'enum',
        instancePath: '/test',
        schemaPath: '/',
        params: {
          allowedValues: ['test1', 'test2', 'test3'],
        },
        message: 'must be equal to one of the allowed values',
      }],
    });
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '/data/aggregationEvent.json',
        result: FinalStatus.fail,
        warnings: [
          JSON.stringify({
            fieldName: 'test',
            message: 'test field must be equal to one of the allowed values',
          }),
        ],
      },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.fail,
        finalMessage: TestSuiteMessage.Fail,
      }),
    );

    const result = await testMultiCredentialHandler(invalidConfigCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: FinalStatus.fail,
          warnings: [
            JSON.stringify({
              fieldName: 'test',
              message: 'test field must be equal to one of the allowed values',
            }),
          ],
        },
      ],
      finalStatus: FinalStatus.fail,
      finalMessage: TestSuiteMessage.Fail,
    });
  });

  it('should test multiple credentials return a pass message when provided a path to a valid credentials file', async () => {
    const credentialPath = 'test/path/to/credentials.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue({
      credentials: [
        { type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' },
        { type: 'conformityEvent', version: 'v0.0.1', dataPath: '/data/conformityEvent.json' },
      ],
    });
    jest
      .spyOn(testSuiteCore, 'processCheckDataBySchema')
      .mockImplementationOnce((credential) => Promise.resolve({ ...credential, errors: null }));
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '/data/aggregationEvent.json',
        result: FinalStatus.pass,
      },
      {
        credentialType: 'conformityEvent',
        version: 'v0.0.1',
        path: '/data/conformityEvent.json',
        result: FinalStatus.pass,
      },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.pass,
        finalMessage: TestSuiteMessage.Pass,
      }),
    );

    const result = await testMultiCredentialHandler(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: FinalStatus.pass,
        },
        {
          credentialType: 'conformityEvent',
          version: 'v0.0.1',
          path: '/data/conformityEvent.json',
          result: FinalStatus.pass,
        },
      ],
      finalStatus: FinalStatus.pass,
      finalMessage: TestSuiteMessage.Pass,
    });
  });

  it('should test multiple credentials return a warning message when provided a path to a credentials file have a additional field', async () => {
    const credentialHaveAdditionalFieldPath = 'test/path/to/invalid.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue({
      credentials: [
        { type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' },
        { type: 'conformityEvent', version: 'v0.0.1', dataPath: '/data/conformityEvent.json' },
      ],
    });
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockImplementationOnce((credential) => Promise.resolve({
        ...credential,
        errors: [{
          keyword: 'additionalProperties',
          instancePath: '/test',
          schemaPath: 'type',
          params: {
            additionalProperty: 'additionalProperty',
          },
          message: 'should NOT have additional properties',
        }],
      }),
    );
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      { credentialType: 'aggregationEvent', version: 'v0.0.1', path: '/data/aggregationEvent.json', result: FinalStatus.warn },
      { credentialType: 'conformityEvent', version: 'v0.0.1', path: '/data/conformityEvent.json', result: FinalStatus.warn },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.warn,
        finalMessage: TestSuiteMessage.Warning,
      }),
    );

    const result = await testMultiCredentialHandler(credentialHaveAdditionalFieldPath);

    expect(result).toEqual({
      credentials: [
        { credentialType: 'aggregationEvent', version: 'v0.0.1', path: '/data/aggregationEvent.json', result: FinalStatus.warn },
        { credentialType: 'conformityEvent', version: 'v0.0.1', path: '/data/conformityEvent.json', result: FinalStatus.warn },
      ],
      finalStatus: FinalStatus.warn,
      finalMessage: TestSuiteMessage.Warning,
    });
  });

  it('should test multiple credentials return a fail message when provided a path to a invalid credentials file', async () => {
    const invalidCredentialPath = 'test/path/to/invalid.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue({
      credentials: [
        { type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' },
        { type: 'conformityEvent', version: 'v0.0.1', dataPath: '/data/conformityEvent.json' },
      ],
    });
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockImplementationOnce((credential) => Promise.resolve({
        ...credential,
        errors: [
          {
            keyword: 'enum',
            instancePath: '/test',
            schemaPath: '/',
            params: {
              allowedValues: ['test1', 'test2', 'test3'],
            },
            message: 'must be equal to one of the allowed values',
          },
        ],
      }),
    );
    jest.spyOn(testSuiteCore, 'generateTestSuiteResultByTemplate').mockResolvedValue([
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '/data/aggregationEvent.json',
        result: FinalStatus.fail,
      },
      {
        credentialType: 'conformityEvent',
        version: 'v0.0.1',
        path: '/data/conformityEvent.json',
        result: FinalStatus.fail,
      },
    ]);
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: FinalStatus.fail,
        finalMessage: TestSuiteMessage.Fail,
      }),
    );

    const result = await testMultiCredentialHandler(invalidCredentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: FinalStatus.fail,
        },
        {
          credentialType: 'conformityEvent',
          version: 'v0.0.1',
          path: '/data/conformityEvent.json',
          result: FinalStatus.fail,
        },
      ],
      finalStatus: FinalStatus.fail,
      finalMessage: TestSuiteMessage.Fail,
    });
  });

  it('should throw an error when provided an invalid path to a credentials file', async () => {
    const invalidCredentialPath = '/path/to/nonexistent/invalid.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue(null);

    await expect(testMultiCredentialHandler(invalidCredentialPath)).rejects.toThrow(
      `Cannot read the credentials file with ${invalidCredentialPath} path.`,
    );
  });
});

describe('testCredentialHandler', () => {
  const testData = {
    parentItem: { itemID: 'https://example.com/product/12345', name: 'Product A' },
    childItems: [{ itemID: 'https://example.com/product/67890', name: 'Product B' }],
    childQuantityList: [{ productClass: 'https://example.com/class/98765', quantity: '100', uom: 'Kg' }],
    eventID: '6d9f8c26-06d7-4c9c-b9d1-07ef02d9789d',
    eventType: 'aggregationn',
    eventTime: '2024-03-08T12:00:00Z',
    actionCode: 'add',
    dispositionCode: 'active',
    businessStepCode: 'shipping',
    readPointId: 'https://example.com/readpoint/123',
    locationId: 'https://maps.google.com/pluscodes/ABCDE',
  };

  it('should return a pass result when no errors are found in the provided schema and test data', async () => {
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce(null);

    const result = await testCredentialHandler(schema, testData);

    expect(result).toEqual({
      result: FinalStatus.pass,
      errors: null
    });
  });

  it('should return a warning result when errors are found in the provided schema and test data have a additional field', async () => {
    const testDataHaveAdditionField = {  ...testData,  test: 1 };
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([{
      keyword: 'additionalProperties',
      instancePath: '/test',
      schemaPath: '/',
      params: {
        additionalProperty: 'additionalProperty',
      },
      message: 'should NOT have additional properties',
    }]);

    const result = await testCredentialHandler(schema, testDataHaveAdditionField);

    expect(result).toEqual({
      result: FinalStatus.warn,
      errors: [{
        keyword: 'additionalProperties',
        instancePath: '/test',
        schemaPath: '/',
        params: {
          additionalProperty: 'additionalProperty',
        },
        message: 'should NOT have additional properties',
      }]
    });
  });

  it('should return a fail result when errors are found in the provided schema and test data', async () => {
    const invalidTestData = {  ...testData,  test: 'invalid' };
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([{
      keyword: 'enum',
      instancePath: '/test',
      schemaPath: '/',
      params: {
        allowedValues: ['test1', 'test2', 'test3'],
      },
      message: 'must be equal to one of the allowed values',
    }]);

    const result = await testCredentialHandler(schema, invalidTestData);

    expect(result).toEqual({
      result: FinalStatus.fail,
      errors: [{
        keyword: 'enum',
        instancePath: '/test',
        schemaPath: '/',
        params: {
          allowedValues: ['test1', 'test2', 'test3'],
        },
        message: 'must be equal to one of the allowed values',
      }]
    });
  });

  it('should return a pass result when schema type, version, and valid test data are provided', async () => {
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce(null);

    const result = await testCredentialHandler('testEvent', 'v0.0.1', testData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: FinalStatus.pass,
      errors: null
    });
  });

  it('should return a warning result when schema type, version, and test data are provided, but the test data have a additional field', async () => {
    const additionFieldTestData = { ...testData, test: 1 };
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([{
      keyword: 'additionalProperties',
      instancePath: '/test',
      schemaPath: 'type',
      params: {
        additionalProperty: 'additionalProperty',
      },
      message: 'should NOT have additional properties',
    }]);

    const result = await testCredentialHandler('testEvent', 'v0.0.1', additionFieldTestData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: FinalStatus.warn,
      errors: [{
        keyword: 'additionalProperties',
        instancePath: '/test',
        schemaPath: 'type',
        params: {
          additionalProperty: 'additionalProperty',
        },
        message: 'should NOT have additional properties',
      }]
    });
  });

  it('should return a fail result when schema type, version, and invalid test data are provided', async () => {
    const invalidTestData = { ...testData, test: 'invalid' };
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([{
      keyword: 'enum',
      instancePath: '/test',
      schemaPath: '/',
      params: {
        allowedValues: ['test1', 'test2', 'test3'],
      },
      message: 'must be equal to one of the allowed values',
    }]);

    const result = await testCredentialHandler('testEvent', 'v0.0.1', invalidTestData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: FinalStatus.fail,
      errors: [{
        keyword: 'enum',
        instancePath: '/test',
        schemaPath: '/',
        params: {
          allowedValues: ['test1', 'test2', 'test3'],
        },
        message: 'must be equal to one of the allowed values',
      }]
    });
  });

  it('should throw an error when schema type, version, and test data are provided, but the dynamic schema loading service fails', async () => {
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockRejectedValue(new Error('Failed to load schema'));

    await expect(testCredentialHandler('testEvent', 'v0.0.1', testData)).rejects.toThrow('Failed to load schema');
  });
});
