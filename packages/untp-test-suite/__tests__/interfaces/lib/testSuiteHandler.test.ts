import * as testSuiteCore from '../../../src/core/processTestSuite';
import { testCredentialsHandler, testCredentialHandler } from '../../../src/interfaces/lib/testSuiteHandler';
import { TestSuiteResultEnum, TestSuiteMessageEnum } from '../../../src/core/types';

jest.mock('../../../src/utils/path', () => ({
  getCurrentDirPath: jest.fn(() => 'test/data'),
  getCurrentFilePath: jest.fn(() => 'test/data/test.ts'),
}));

describe('testCredentialsHandler', () => {
  it('should return a PASS message when provided a CredentialConfigs object', async () => {
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

  it('should return a PASS message when provided a configuration path', async () => {
    const configPath = 'credentials.json';
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

    const result = await testCredentialsHandler(configPath);

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
});

describe('testCredentialHandler', () => {
  const testData = {
    parentItem: { itemID: 'https://example.com/product/12345', name: 'Product A' },
    childItems: [{ itemID: 'https://example.com/product/67890', name: 'Product B' }],
    childQuantityList: [{ productClass: 'https://example.com/class/98765', quantity: '100', uom: 'Kg' }],
    eventID: '6d9f8c26-06d7-4c9c-b9d1-07ef02d9789d',
    eventType: 'aggregation',
    eventTime: '2024-03-08T12:00:00Z',
    actionCode: 'add',
    dispositionCode: 'active',
    businessStepCode: 'shipping',
    readPointId: 'https://example.com/readpoint/123',
    locationId: 'https://maps.google.com/pluscodes/ABCDE',
  };

  it('should return a PASS result when schema type, version, and valid test data are provided', async () => {
    jest.spyOn(testSuiteCore, 'processTestSuiteForCredential').mockResolvedValueOnce({
      credentialType: 'aggregationEvent',
      version: 'v0.0.1',
      path: '',
      result: TestSuiteResultEnum.PASS,
    });

    const result = await testCredentialHandler({ type: 'aggregationEvent', version: 'v0.0.1' }, testData);

    expect(result).toEqual({
      credentialType: 'aggregationEvent',
      version: 'v0.0.1',
      path: '',
      result: TestSuiteResultEnum.PASS,
    });
  });
});
