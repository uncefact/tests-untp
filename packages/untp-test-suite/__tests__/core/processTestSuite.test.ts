import * as commonUtils from '../../src/core/utils/common';
import * as testRunner from '../../src/core/processTestSuite';
import * as templateUtils from '../../src/templates/utils';
import * as service from '../../src/core/services/dynamic-loading-schemas/loadingSchema.service';
import { TestSuiteMessageEnum, TestSuiteResultEnum } from '../../src/core/types';
import { hasErrors } from '../../src/core/services/json-schema/validator.service';

jest.mock('../../src/utils/path', () => ({
  getCurrentDirPath: jest.fn(() => '/test/data/data.json'),
  getCurrentFilePath: jest.fn(),
}));

jest.mock('../../src/core/utils/common');
jest.mock('../../src/core/services/dynamic-loading-schemas/loadingSchema.service');
jest.mock('../../src/core/services/json-schema/validator.service');

const credentialFileData = {
  credentials: [
    {
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
    },
  ],
};
const passFinalReport = {
  finalStatus: 'PASS',
  finalMessage: 'Your credentials are UNTP compliant',
};

describe('processTestSuiteForConfigPath with local credential type and version', () => {
  const credentialPath = 'src/config/credentials.json';

  beforeEach(() => {
    JSON.parse = jest.fn().mockImplementation((value) => {
      return value;
    });

    jest.spyOn(commonUtils, 'loadDataFromDataPath').mockResolvedValueOnce({
      data: {
        type: ['ProductPassport', 'VerifiableCredential'],
        id: 'https://example.com/product-passport/123456',
        manufacturedDate: '2023-06-15',
      },
    });

    jest.spyOn(service, 'dynamicLoadingSchemaService').mockResolvedValueOnce({
      type: ['ProductPassport', 'VerifiableCredential'],
      id: 'https://example.com/product-passport/123456',
      manufacturedDate: '2023-06-15',
    } as unknown as JSON);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should process the test suite and finalStatus PASS without url', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        url: '',
        errors: [],
      },
    ]);
    const mockHasErrors = hasErrors as jest.MockedFunction<typeof hasErrors>;
    mockHasErrors.mockReturnValue([]);
    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.PASS,
      },
    ]);
    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessageEnum.PASS,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: 'PASS',
        },
      ],
      ...passFinalReport,
    });
  });

  it('should process the test suite with an array of errors and finalStatus FAIL', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [],
      },
    ]);
    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.FAIL,
        errors: [
          {
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          },
        ],
        warnings: [],
      },
    ]);
    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.FAIL,
          errors: [
            {
              allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
              errorType: 'enum',
              fieldName: '/eventType',
              message: '/eventType field must be equal to one of the allowed values',
            },
          ],
          warnings: [],
        },
      ],
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('should process the test suite with an array of warnings and finalStatus WARN status', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [],
      },
    ]);
    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.WARN,
        errors: [],
        warnings: [
          {
            fieldName: 'additionalFieldTest',
            message: 'This schema must NOT have additional properties',
          },
        ],
      },
    ]);
    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.WARN,
      finalMessage: TestSuiteMessageEnum.WARN,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.WARN,
          errors: [],
          warnings: [
            {
              fieldName: 'additionalFieldTest',
              message: 'This schema must NOT have additional properties',
            },
          ],
        },
      ],
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    });
  });

  it('should process the test suite with an array of warnings and warnings, and finalStatus FAIL status', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [],
      },
    ]);
    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.WARN,
        errors: [
          {
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          },
        ],
        warnings: [
          {
            fieldName: 'additionalFieldTest',
            message: 'This schema must NOT have additional properties',
          },
        ],
      },
    ]);
    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.WARN,
          errors: [
            {
              fieldName: '/eventType',
              errorType: 'enum',
              allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
              message: '/eventType field must be equal to one of the allowed values',
            },
          ],
          warnings: [
            {
              fieldName: 'additionalFieldTest',
              message: 'This schema must NOT have additional properties',
            },
          ],
        },
      ],
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('should throw an error when validation of the credential configuration fails', async () => {
    try {
      const emptyCredentialPath = 'config/empty-credentials.json';
      jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce({});
      jest.spyOn(commonUtils, 'validateCredentialConfigs').mockImplementationOnce(() => {
        throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.');
      });

      await testRunner.processTestSuiteForConfigPath(emptyCredentialPath);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Credentials array cannot be empty. Please provide valid credentials to proceed.');
    }
  });
});

describe('processTestSuiteForConfigPath with remote schema URL', () => {
  const credentialPath = 'src/config/credentials.json';

  beforeEach(() => {
    JSON.parse = jest.fn().mockImplementation((value) => {
      return value;
    });

    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);

    const mockData = {
      data: {
        type: ['ProductPassport', 'VerifiableCredential'],
        id: 'https://example.com/product-passport/123456',
        manufacturedDate: '2023-06-15',
      },
    };
    jest.spyOn(commonUtils, 'loadDataFromDataPath').mockResolvedValueOnce({
      data: mockData,
    });

    jest.spyOn(commonUtils, 'fetchData').mockResolvedValueOnce({
      data: mockData,
      error: '',
      success: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should process the test suite and finalStatus PASS with empty type and version', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: '',
        version: '',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      },
    ]);

    jest.spyOn(testRunner, 'processCheckDataBySchema').mockReturnValueOnce(
      Promise.resolve({
        type: '',
        version: '',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      }),
    );

    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: '',
        version: '',
        path: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        result: TestSuiteResultEnum.PASS,
      },
    ]);

    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessageEnum.PASS,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: '',
          version: '',
          path: 'data/productPassport.json',
          url: 'https://example.com/product-passport/schema.json',
          result: 'PASS',
        },
      ],
      ...passFinalReport,
    });
  });

  it('should process the test suite and finalStatus PASS with type, version and url', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      },
    ]);

    jest.spyOn(testRunner, 'processCheckDataBySchema').mockReturnValueOnce(
      Promise.resolve({
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      }),
    );

    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: '',
        version: '',
        path: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        result: TestSuiteResultEnum.PASS,
      },
    ]);

    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessageEnum.PASS,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: '',
          version: '',
          path: 'data/productPassport.json',
          url: 'https://example.com/product-passport/schema.json',
          result: 'PASS',
        },
      ],
      ...passFinalReport,
    });
  });

  it('should process the test suite with an array of errors and finalStatus FAIL', async () => {
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      },
      {
        type: 'productPassport',
        version: 'v0.0.2',
        dataPath: 'data/productPassport.json',
        url: 'invalid-url.com',
        errors: [
          {
            instancePath: 'url',
            message: 'The URL "invalid-url.com" must use http or https protocol.',
            keyword: 'format',
            dataPath: 'data/productPassport.json',
          },
        ],
      },
    ]);

    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        result: TestSuiteResultEnum.PASS,
      },
      {
        credentialType: 'productPassport',
        version: 'v0.0.2',
        path: 'data/productPassport.json',
        url: 'invalid-url.com',
        result: TestSuiteResultEnum.FAIL,
        errors: [
          {
            fieldName: 'url',
            message: 'The URL "invalid-url.com" must use http or https protocol.',
            errorType: 'format',
          },
        ],
      },
    ]);

    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);
    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          url: 'https://example.com/product-passport/schema.json',
          result: 'PASS',
        },
        {
          credentialType: 'productPassport',
          version: 'v0.0.2',
          path: 'data/productPassport.json',
          url: 'invalid-url.com',
          result: 'FAIL',
          errors: [
            {
              fieldName: 'url',
              message: 'The URL "invalid-url.com" must use http or https protocol.',
              errorType: 'format',
            },
          ],
        },
      ],
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('should process the test suite with an array of warnings and finalStatus WARN status', async () => {
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: '',
        version: '',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      },
    ]);
    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: '',
        version: '',
        path: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        result: TestSuiteResultEnum.WARN,
        errors: [],
        warnings: [
          {
            fieldName: 'additionalFieldTest',
            message: 'This schema must NOT have additional properties',
          },
        ],
      },
    ]);
    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.WARN,
      finalMessage: TestSuiteMessageEnum.WARN,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: '',
          version: '',
          path: 'data/productPassport.json',
          url: 'https://example.com/product-passport/schema.json',
          result: TestSuiteResultEnum.WARN,
          errors: [],
          warnings: [
            {
              fieldName: 'additionalFieldTest',
              message: 'This schema must NOT have additional properties',
            },
          ],
        },
      ],
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    });
  });

  it('should process the test suite with an array of FAIL when fetch data error', async () => {
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: '',
        version: '',
        dataPath: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        errors: [],
      },
    ]);
    jest.spyOn(commonUtils, 'fetchData').mockResolvedValueOnce({
      data: {},
      error: 'Failed to fetch data',
      success: false,
    });

    jest.spyOn(templateUtils, 'constructCredentialTestResults').mockResolvedValueOnce([
      {
        credentialType: '',
        version: '',
        path: 'data/productPassport.json',
        url: 'https://example.com/product-passport/schema.json',
        result: TestSuiteResultEnum.FAIL,
        errors: [
          {
            fieldName: 'url',
            message: 'Failed to fetch data',
            errorType: 'FetchError',
          },
        ],
      },
    ]);

    jest.spyOn(templateUtils, 'constructFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessageEnum.FAIL,
    });

    const result = await testRunner.processTestSuiteForConfigPath(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: '',
          version: '',
          path: 'data/productPassport.json',
          url: 'https://example.com/product-passport/schema.json',
          result: 'FAIL',
          errors: [
            {
              fieldName: 'url',
              message: 'Failed to fetch data',
              errorType: 'FetchError',
            },
          ],
        },
      ],
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });
});

describe('processTestSuiteForCredential', () => {
  const mockData = {
    data: {
      type: ['ProductPassport', 'VerifiableCredential'],
      id: 'https://example.com/product-passport/123456',
      manufacturedDate: '2023-06-15',
    },
  };

  beforeEach(() => {
    jest.spyOn(commonUtils, 'loadDataFromDataPath').mockResolvedValueOnce({
      data: mockData,
    });
  });

  afterEach(() => {
    jest.clearAllMocks(); // Clear mock state between tests
  });

  it('should fetch schema from URL when configContent.url is provided', async () => {
    jest.spyOn(commonUtils, 'fetchData').mockResolvedValueOnce({
      data: mockData,
      error: '',
      success: true,
    });

    const configContent = {
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      url: 'https://example.com/product-passport/schema.json',
    };
    jest.spyOn(commonUtils, 'fetchData').mockResolvedValueOnce({
      data: {
        id: 'https://example.com/product-passport/123456',
        manufacturedDate: '2023-06-15',
      },
      error: '',
      success: true,
    });

    const execptedResult = {
      credentialType: 'productPassport',
      version: 'v0.0.1',
      path: 'data/productPassport.json',
      result: TestSuiteResultEnum.PASS,
    };
    jest.spyOn(templateUtils, 'constructCredentialTestResult').mockResolvedValueOnce(execptedResult);

    const result = await testRunner.processTestSuiteForCredential(configContent);

    expect(result).toEqual(execptedResult);
  });

  it('should load schema from dynamicLoadingSchemaService when configContent.url is not provided', async () => {
    const configContent = {
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      url: '',
    };
    jest.spyOn(service, 'dynamicLoadingSchemaService').mockResolvedValueOnce(mockData as unknown as JSON);

    const execptedResult = {
      credentialType: 'productPassport',
      version: 'v0.0.1',
      url: '',
      dataPath: 'data/productPassport.json',
      result: TestSuiteResultEnum.PASS,
    };

    jest.spyOn(templateUtils, 'constructCredentialTestResult').mockResolvedValueOnce(execptedResult);
    const result = await testRunner.processTestSuiteForCredential(configContent);

    expect(result).toEqual(execptedResult);
  });
});
