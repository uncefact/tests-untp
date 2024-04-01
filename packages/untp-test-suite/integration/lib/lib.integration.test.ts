import { jest } from '@jest/globals';
import { testCredentialHandler, testCredentialsHandler } from '../../src/interfaces/lib/testSuiteHandler';

describe('lib.integration.test.ts', () => {
  describe('Test suite for a credential', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });
    const credentialSchemaConfigMock = {
      type: 'objectEvent',
      version: 'v0.0.1',
    };

    const testDataMock = {
      eventID: '6d9f8c26-06d7-4c9c-b9d1-07ef02d9789d',
      eventType: 'aggregation',
      eventTime: '2024-03-08T12:00:00Z',
      actionCode: 'add',
      dispositionCode: 'active',
      businessStepCode: 'shipping',
      readPointId: 'https://example.com/readpoint/123',
      locationId: 'https://maps.google.com/pluscodes/ABCDE',
    };

    it('should return pass results when data validation', async () => {
      const result = await testCredentialHandler(credentialSchemaConfigMock, testDataMock);
      expect(result.result).toBe('PASS');
    });

    it('should return warn results when data have more field than schema', async () => {
      const newTestDataMock = {
        ...testDataMock,
        parentItem: { itemID: 'https://example.com/product/12345', name: 'Product A' },
      };
      const result = await testCredentialHandler(credentialSchemaConfigMock, newTestDataMock);

      expect(result.result).toBe('WARN');
      expect(result.warnings).toEqual([
        {
          fieldName: 'parentItem',
          message: "Additional property found: 'parentItem'.",
        },
      ]);
    });

    it('should return failed results while testData is an object empty', async () => {
      const result = await testCredentialHandler(credentialSchemaConfigMock, {});
      expect(result.result).toBe('FAIL');
    });

    it('should throw an error when the credential is contain all empty field', async () => {
      await expect(
        testCredentialHandler(
          {
            type: '',
            version: '',
          },
          testDataMock,
        ),
      ).rejects.toThrow('ENOENT: no such file or directory');
    });

    it('should throw an error when the credential is contain version empty', async () => {
      await expect(
        testCredentialHandler(
          {
            type: 'objectEvent',
            version: '',
          },
          testDataMock,
        ),
      ).rejects.toThrow('ENOENT: no such file or directory');
    });

    it('should throw an error when the credential is contain type empty', async () => {
      await expect(
        testCredentialHandler(
          {
            type: '',
            version: 'v0.0.1',
          },
          testDataMock,
        ),
      ).rejects.toThrow('Version not found for schema');
    });
  });

  describe('Test suite for credentials', () => {
    it('should return a PASS message when provided a configuration path', async () => {
      const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;
      const credentialFileName = 'credentialsExample.json';
      const result = await testCredentialsHandler(`${mockPath}/${credentialFileName}`);
      expect(result.finalStatus).toEqual('PASS');
    });

    it('should return a WARN message when provided a configuration path', async () => {
      const configMock = {
        credentials: [
          {
            type: 'objectEvent',
            version: 'v0.0.1',
            dataPath: 'integration/mock/untpTestWarn/data/objectEvent.json',
          },
          {
            type: 'transformationEvent',
            version: 'v0.0.1',
            dataPath: 'integration/mock/untpTestWarn/data/transformationEvent.json',
          },
        ],
      };

      const result = await testCredentialsHandler(configMock);

      expect(result.finalStatus).toEqual('WARN');
      expect(result.finalMessage).toEqual('Your credentials are UNTP compliant, but have extended the data model');
    });

    it('should return a FAIL message when provided a configuration path', async () => {
      const mockPath = `${process.cwd()}/integration/mock/untpTestFail`;
      const credentialFileName = 'credentialsExample.json';
      const result = await testCredentialsHandler(`${mockPath}/${credentialFileName}`);

      expect(result.finalStatus).toEqual('FAIL');
      expect(result.finalMessage).toEqual('Your credentials are not UNTP compliant');
      expect(result.credentials[1].errors).not.toBeNull();
      expect(result.credentials[1].errors).toEqual([
        { errorType: 'type', fieldName: '/certification', message: '/certification field must be array.' },
      ]);
    });

    it('should return a FAIL message when the result contain PASS, WARN and FAIL', async () => {
      const mockPath = `${process.cwd()}/integration/mock/untpTestFailuresAndWarnings`;
      const credentialFileName = 'credentialsExample.json';
      const result = await testCredentialsHandler(`${mockPath}/${credentialFileName}`);

      expect(result.finalStatus).toEqual('FAIL');
    });

    it('should return fail when credentials is an object array', async () => {
      const result = await testCredentialsHandler({
        credentials: [{} as any],
      });

      expect(result.finalStatus).toEqual('FAIL');
    });

    it('should throw an error when the credential file is empty', async () => {
      await expect(testCredentialsHandler('')).rejects.toThrow('ENOENT: no such file or directory');
    });

    it('should throw an error when the credential file is not found', async () => {
      await expect(testCredentialsHandler('notfound.json')).rejects.toThrow('ENOENT: no such file or directory');
    });

    it('should throw an error when `testCredentialsHandler` is called with an empty credentials array', async () => {
      await expect(
        testCredentialsHandler({
          credentials: [],
        }),
      ).rejects.toThrow('Credentials array cannot be empty. Please provide valid credentials to proceed.');
    });
  });
});
