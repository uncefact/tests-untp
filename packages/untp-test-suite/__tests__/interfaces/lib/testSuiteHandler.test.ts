import * as testSuiteCore from '../../../src/core/processTestSuite';
import * as commonUtils from '../../../src/interfaces/utils/common';
import * as templateMapperUtils from '../../../src/templates/mapper';
import * as loadingSchemaService from '../../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import * as validatorService from '../../../src/core/services/json-schema/validator.service';
import { testCredentialsHandler, testCredentialHandler } from '../../../src/interfaces/lib/testSuiteHandler';
import { TestSuiteResultEnum, TestSuiteMessageEnum } from '../../../src/core/types';
import schema from '../../../src/schemas/aggregationEvent/v0.0.1/schema.json';

jest.mock('../../../src/utils/path', () => ({
  getCurrentDirPath: jest.fn(() => 'test/data'),
  getCurrentFilePath: jest.fn(() => 'test/data/test.ts'),
}));

describe('testCredentialsHandler', () => {
  it('should test based on credential configs return a PASS message when provided a CredentialConfigs object', async () => {
    const configCredentials = {
      credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }],
    };
    jest.spyOn(testSuiteCore, 'processTestSuiteForConfigPath').mockResolvedValue({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.PASS,
        },
      ],
      finalMessage: TestSuiteMessageEnum.PASS,
      finalStatus: TestSuiteResultEnum.PASS,
    });
    jest.spyOn(testSuiteCore, 'processTestSuite').mockResolvedValue({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.PASS,
        },
      ],
      finalMessage: TestSuiteMessageEnum.PASS,
      finalStatus: TestSuiteResultEnum.PASS,
    });

    const result = await testCredentialsHandler(configCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.PASS,
        },
      ],
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessageEnum.PASS,
    });
  });

  it('should test a single credential return a warning message when provided a CredentialConfigs object have a additional field', async () => {
    const warningConfigCredentials = {
      credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }],
    };
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
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: TestSuiteResultEnum.WARN,
        finalMessage: TestSuiteMessageEnum.WARN,
      }),
    );

    const result = await testCredentialsHandler(warningConfigCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.WARN,
          warnings: [
            JSON.stringify({
              fieldName: 'testProperty',
              message: 'This schema should NOT have additional properties',
            }),
          ],
        },
      ],
      finalStatus: TestSuiteResultEnum.WARN,
      finalMessage: TestSuiteMessageEnum.WARN,
    });
  });

  it('should test a single credential return a FAIL message when provided a invalid CredentialConfigs object', async () => {
    const invalidConfigCredentials = {
      credentials: [{ type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' }],
    };
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockResolvedValue({
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '/data/aggregationEvent.json',
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
    });
    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: TestSuiteResultEnum.FAIL,
        finalMessage: TestSuiteMessageEnum.FAIL,
      }),
    );

    const result = await testCredentialsHandler(invalidConfigCredentials);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.FAIL,
          warnings: [
            JSON.stringify({
              fieldName: 'test',
              message: 'test field must be equal to one of the allowed values',
            }),
          ],
        },
      ],
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });
  });

  it('should test multiple credentials return a PASS message when provided a path to a valid credentials file', async () => {
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

    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: TestSuiteResultEnum.PASS,
        finalMessage: TestSuiteMessageEnum.PASS,
      }),
    );

    const result = await testCredentialsHandler(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.PASS,
        },
        {
          credentialType: 'conformityEvent',
          version: 'v0.0.1',
          path: '/data/conformityEvent.json',
          result: TestSuiteResultEnum.PASS,
        },
      ],
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessageEnum.PASS,
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
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockImplementationOnce((credential) =>
      Promise.resolve({
        ...credential,
        errors: [
          {
            keyword: 'additionalProperties',
            instancePath: '/test',
            schemaPath: 'type',
            params: {
              additionalProperty: 'additionalProperty',
            },
            message: 'should NOT have additional properties',
          },
        ],
      }),
    );

    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: TestSuiteResultEnum.WARN,
        finalMessage: TestSuiteMessageEnum.WARN,
      }),
    );

    const result = await testCredentialsHandler(credentialHaveAdditionalFieldPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.WARN,
        },
        {
          credentialType: 'conformityEvent',
          version: 'v0.0.1',
          path: '/data/conformityEvent.json',
          result: TestSuiteResultEnum.WARN,
        },
      ],
      finalStatus: TestSuiteResultEnum.WARN,
      finalMessage: TestSuiteMessageEnum.WARN,
    });
  });

  it('should test multiple credentials return a FAIL message when provided a path to a invalid credentials file', async () => {
    const invalidCredentialPath = 'test/path/to/invalid.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue({
      credentials: [
        { type: 'aggregationEvent', version: 'v0.0.1', dataPath: '/data/aggregationEvent.json' },
        { type: 'conformityEvent', version: 'v0.0.1', dataPath: '/data/conformityEvent.json' },
      ],
    });
    jest.spyOn(testSuiteCore, 'processCheckDataBySchema').mockImplementationOnce((credential) =>
      Promise.resolve({
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

    jest.spyOn(templateMapperUtils, 'templateMapper').mockResolvedValue(
      JSON.stringify({
        finalStatus: TestSuiteResultEnum.FAIL,
        finalMessage: TestSuiteMessageEnum.FAIL,
      }),
    );

    const result = await testCredentialsHandler(invalidCredentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'aggregationEvent',
          version: 'v0.0.1',
          path: '/data/aggregationEvent.json',
          result: TestSuiteResultEnum.FAIL,
        },
        {
          credentialType: 'conformityEvent',
          version: 'v0.0.1',
          path: '/data/conformityEvent.json',
          result: TestSuiteResultEnum.FAIL,
        },
      ],
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });
  });

  it('should throw an error when provided an invalid path to a credentials file', async () => {
    const invalidCredentialPath = '/path/to/nonexistent/invalid.json';
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValue(null);

    await expect(testCredentialsHandler(invalidCredentialPath)).rejects.toThrow(
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

  it('should return a PASS result when schema type, version, and valid test data are provided', async () => {
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce(null);

    const result = await testCredentialHandler({ type: 'testEvent', version: 'v0.0.1' }, testData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: TestSuiteResultEnum.PASS,
      errors: null,
    });
  });

  it('should return a warning result when schema type, version, and test data are provided, but the test data have a additional field', async () => {
    const additionFieldTestData = { ...testData, test: 1 };
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([
      {
        keyword: 'additionalProperties',
        instancePath: '/test',
        schemaPath: 'type',
        params: {
          additionalProperty: 'additionalProperty',
        },
        message: 'should NOT have additional properties',
      },
    ]);

    const result = await testCredentialHandler({ type: 'testEvent', version: 'v0.0.1' }, additionFieldTestData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: TestSuiteResultEnum.WARN,
      errors: [
        {
          keyword: 'additionalProperties',
          instancePath: '/test',
          schemaPath: 'type',
          params: {
            additionalProperty: 'additionalProperty',
          },
          message: 'should NOT have additional properties',
        },
      ],
    });
  });

  it('should return a FAIL result when schema type, version, and invalid test data are provided', async () => {
    const invalidTestData = { ...testData, test: 'invalid' };
    jest.spyOn(loadingSchemaService, 'dynamicLoadingSchemaService').mockResolvedValueOnce(JSON);
    jest.spyOn(validatorService, 'hasErrors').mockReturnValueOnce([
      {
        keyword: 'enum',
        instancePath: '/test',
        schemaPath: '/',
        params: {
          allowedValues: ['test1', 'test2', 'test3'],
        },
        message: 'must be equal to one of the allowed values',
      },
    ]);

    const result = await testCredentialHandler({ type: 'testEvent', version: 'v0.0.1' }, invalidTestData);

    expect(result).toEqual({
      credentialType: 'testEvent',
      version: 'v0.0.1',
      result: TestSuiteResultEnum.FAIL,
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
    });
  });

  it('should throw an error when schema type, version, and test data are provided, but the dynamic schema loading service fails', async () => {
    jest
      .spyOn(loadingSchemaService, 'dynamicLoadingSchemaService')
      .mockRejectedValue(new Error('Failed to load schema'));

    await expect(testCredentialHandler({ type: 'testEvent', version: 'v0.0.1' }, testData)).rejects.toThrow(
      'Failed to load schema',
    );
  });
});
