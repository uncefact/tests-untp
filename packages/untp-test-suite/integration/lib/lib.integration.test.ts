import { jest } from '@jest/globals';
import fs from 'fs';
import { testCredentialHandler, testCredentialsHandler } from '../../src/interfaces/lib/testSuiteHandler';

describe('lib.integration.test.ts', () => {
  describe('Test suite for a credential', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    const credentialsSchemaConfigMock = [
      {
        type: 'aggregationEvent',
        version: 'v0.0.1',
      },
      {
        type: 'conformityCredential',
        version: 'v0.0.1',
      },
      {
        type: 'objectEvent',
        version: 'v0.0.1',
      },
      {
        type: 'productPassport',
        version: 'v0.0.1',
      },
      {
        type: 'transactionEvent',
        version: 'v0.0.1',
      },
      {
        type: 'transformationEvent',
        version: 'v0.0.1',
      },
    ];

    credentialsSchemaConfigMock.map((item) => {
      it(`should return pass results when data validation for ${item.type}`, async () => {
        const fileContent = fs.promises.readFile(
          `${process.cwd()}/integration/mock/untpTestPass/data/${item.type}.json`,
          'utf-8',
        );
        const result = await testCredentialHandler(item, fileContent);

        expect(result).toHaveProperty('credentialType', item.type);
        expect(result).toHaveProperty('version', 'v0.0.1');
        expect(result).toHaveProperty('path', '');
        expect(result).toHaveProperty('result');
        expect(result.result).toEqual('PASS');
      });
    });

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

    it('should throw an error when the credential is contain version empty', async () => {
      const result = await testCredentialHandler(
        {
          type: 'objectEvent',
          version: '',
        },
        testDataMock,
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('ENOENT: no such file or directory'),
          }),
        ]),
      );
    });
  });

  describe('Test suite for credentials', () => {
    it('should return a PASS message when provided a configuration path', async () => {
      const mockPath = `${process.cwd()}/integration/mock/untpTestPass`;
      const credentialFileName = 'credentialsExample.json';
      const result = await testCredentialsHandler(`${mockPath}/${credentialFileName}`);
      expect(result).toHaveProperty('credentials');
      expect(result.credentials).toHaveLength(2);
      expect(result).toHaveProperty('finalStatus');
      expect(result.finalStatus).toEqual('PASS');
      expect(result).toHaveProperty('finalMessage');
      expect(result.finalMessage).toEqual('Your credentials are UNTP compliant');
    });

    it('should return fail when credentials is an object array empty', async () => {
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
