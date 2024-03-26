import * as commonUtils from '../../src/core/utils/common';
import * as testRunner from '../../src/core/processTestSuite';
import * as templateUtils from '../../src/templates/utils';
import { TestSuiteMessage, TestSuiteResultEnum } from '../../src/core/types';

jest.mock('../../src/utils/path', () => ({
  getCurrentDirPath: jest.fn(() => '/test/data/data.json'),
  getCurrentFilePath: jest.fn(),
}));

const credentialFileData = {
  credentials: [{
    type: 'productPassport',
    version: 'v0.0.1',
    dataPath: 'data/productPassport.json',
  }]
};
const passFinalReport = {
  finalStatus: 'PASS',
  finalMessage: 'Your credentials are UNTP compliant',
};

describe('processTestSuite', () => {
  const credentialPath = 'src/config/credentials.json';

  beforeEach(() => {
    JSON.parse = jest.fn().mockImplementation((value) => {
      return value;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should process the test suite and finalStatus PASS', async () => {
    jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);
    jest.spyOn(commonUtils, 'validateCredentialConfigs').mockReturnValueOnce([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [],
      },
    ]);
    jest.spyOn(testRunner, 'processCheckDataBySchema').mockResolvedValueOnce({
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      errors: [],
    });
    jest.spyOn(templateUtils, 'getCredentialResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.PASS,
      },
    ]);
    jest.spyOn(templateUtils, 'getFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.PASS,
      finalMessage: TestSuiteMessage.Pass,
    });

    const result = await testRunner.processTestSuite(credentialPath);

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
    jest.spyOn(templateUtils, 'getCredentialResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.FAIL,
        validationErrors: [
          {
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          },
        ],
        validationWarnings: [],
      },
    ]);
    jest.spyOn(templateUtils, 'getFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessage.Fail,
    });

    const result = await testRunner.processTestSuite(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.FAIL,
          validationErrors: [
            {
              allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
              errorType: 'enum',
              fieldName: '/eventType',
              message: '/eventType field must be equal to one of the allowed values',
            },
          ],
          validationWarnings: []
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
    jest.spyOn(templateUtils, 'getCredentialResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.WARN,
        validationErrors: [],
        validationWarnings: [{
          fieldName: 'additionalFieldTest',
          message: 'This schema must NOT have additional properties',
        }],
      },
    ]);
    jest.spyOn(templateUtils, 'getFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.WARN,
      finalMessage: TestSuiteMessage.Warning,
    });

    const result = await testRunner.processTestSuite(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.WARN,
          validationErrors: [],
          validationWarnings: [{
            fieldName: 'additionalFieldTest',
            message: 'This schema must NOT have additional properties',
          }]
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
    jest.spyOn(templateUtils, 'getCredentialResults').mockResolvedValueOnce([
      {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.WARN,
        validationErrors: [{
          fieldName: '/eventType',
          errorType: 'enum',
          allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
          message: '/eventType field must be equal to one of the allowed values',
        }],
        validationWarnings: [{
          fieldName: 'additionalFieldTest',
          message: 'This schema must NOT have additional properties',
        }],
      },
    ]);
    jest.spyOn(templateUtils, 'getFinalReport').mockResolvedValueOnce({
      finalStatus: TestSuiteResultEnum.FAIL,
      finalMessage: TestSuiteMessage.Fail,
    });

    const result = await testRunner.processTestSuite(credentialPath);

    expect(result).toEqual({
      credentials: [
        {
          credentialType: 'productPassport',
          version: 'v0.0.1',
          path: 'data/productPassport.json',
          result: TestSuiteResultEnum.WARN,
          validationErrors: [{
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          }],
          validationWarnings: [{
            fieldName: 'additionalFieldTest',
            message: 'This schema must NOT have additional properties',
          }]
        },
      ],
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('Should throw an error when validation of the credential configuration fails', async () => {
    try {
      const emptyCredentialPath = 'config/empty-credentials.json';
      jest.spyOn(commonUtils, 'readJsonFile').mockResolvedValueOnce({});
      jest.spyOn(commonUtils, 'validateCredentialConfigs').mockImplementationOnce(() => { throw new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.') });
  
  
      await testRunner.processTestSuite(emptyCredentialPath);
      
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Failed to run the test suite. Credentials array cannot be empty. Please provide valid credentials to proceed.');
    }
  });
});
