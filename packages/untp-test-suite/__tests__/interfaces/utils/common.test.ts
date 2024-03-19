import fs from 'fs/promises';
import { generateFinalMessage, getTemplateName, readJsonFile } from '../../../src/interfaces/utils/common';
import { ErrorObject } from 'ajv';

describe('readJsonFile', () => {
  const credentialFilePath = 'config/credential.json';
  const dataFileJsonMock = JSON.stringify({
    credentials: [
      {
        type: 'aggregationEvent',
        version: 'v0.0.1',
        dataPath: '',
      },
    ],
  });

  it('should read JSON file successfully', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValueOnce(dataFileJsonMock);

    const fileData = await readJsonFile(credentialFilePath);

    expect(fileData).toEqual(JSON.parse(dataFileJsonMock));
  });

  it('should return null due to invalid file path', async () => {
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce('Invalid path');
    const invalidCredentialFilePath = 'invalid-path';

    const fileData = await readJsonFile(invalidCredentialFilePath);

    expect(fileData).toBeNull();
  });
});

describe('getTemplateName', () => {
  it('should return "pass" when there are no errors', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: null,
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('PASS');
  });

  it('should return "failed" when there are errors', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [
        {
          message: 'should have required property',
          keyword: 'required',
          dataPath: 'path/to/credentials',
          instancePath: 'type',
        },
      ],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('FAILED');
  });

  it('should return "warn" when there are errors with additional properties', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [
        {
          message: 'should NOT have additional properties',
          keyword: 'additionalProperties',
          dataPath: 'path/to/credentials',
          instancePath: 'type',
          params: {
            additionalProperty: 'additionalProperty',
          },
        },
      ],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('WARN');
  });

  it('should return "failed" when there are errors without additional properties', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('FAILED');
  });
});

describe('generateFinalMessage', () => {
  it('should return "Your credentials are UNTP compliant" when there are no errors', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'PASS',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'PASS',
      finalMessage: 'Your credentials are UNTP compliant',
    });
  });

  it('should return "Your credentials are not UNTP compliant" when there are errors', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'FAILED',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'FAILED',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('should return "Your credentials are UNTP compliant, but have extended the data model" when there are warnings', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'WARN',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    });
  });
});
