import * as fs from 'fs/promises';
import { readConfigFile, validateCredentialConfigs, readFile } from '../../../../src/core/utils/common';
import { resolve } from 'path';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('path', () => {
  return {
    resolve: jest.fn(),
  };
});

describe('readConfigFile', () => {
  const expectResult = {
    credentials: [
      {
        type: 'objectEvent',
        version: 'v0.0.1',
        dataPath: 'testPath',
      },
    ],
  };
  it('should read the config file', async () => {
    (resolve as jest.Mock).mockReturnValue('/untp-test-suite/src/config/credentials.json');

    jest.spyOn(fs, 'readFile' as any).mockResolvedValue(expectResult);
    JSON.parse = jest.fn().mockImplementation(() => {
      return expectResult;
    });
    const result = await readConfigFile();
    expect(result).toEqual(expectResult);
  });

  it('should throw an error when the config file is empty', async () => {
    (resolve as jest.Mock).mockReturnValue('/untp-test-suite/src/config/credentials.json');

    jest.spyOn(fs, 'readFile' as any).mockResolvedValue({});
    JSON.parse = jest.fn().mockImplementation(() => {
      return {};
    });
    try {
      await readConfigFile();
    } catch (error) {
      expect(error).toEqual(
        new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.'),
      );
    }
  });

  it('should throw an error when the credential object is missing required fields', async () => {
    (resolve as jest.Mock).mockReturnValue('/untp-test-suite/src/config/credentials.json');

    jest.spyOn(fs, 'readFile' as any).mockResolvedValue({
      credentials: [
        {
          type: 'objectEvent',
          version: 'v0.0.1',
        },
      ],
    });
    JSON.parse = jest.fn().mockImplementation(() => {
      return {
        credentials: [
          {
            type: 'objectEvent',
            version: 'v0.0.1',
          },
        ],
      };
    });
    try {
      await readConfigFile();
    } catch (error) {
      expect(error).toEqual(
        new Error(
          `Each credential object must contain 'type', 'version', and 'dataPath' fields. Please ensure all required fields are provided.`,
        ),
      );
    }
  });

  it('should throw an error when the config file is not found', async () => {
    (resolve as jest.Mock).mockReturnValue('/untp-test-suite/src/config/credentials.json');

    jest.spyOn(fs, 'readFile' as any).mockRejectedValue(new Error('File not found'));
    try {
      await readConfigFile();
    } catch (error) {
      expect(error).toEqual(new Error('File not found'));
    }
  });
});

describe('validateCredentialConfigs', () => {
  it('should throw an error when the credentialConfigs array is empty', () => {
    try {
      validateCredentialConfigs([]);
    } catch (error) {
      expect(error).toEqual(
        new Error('Credentials array cannot be empty. Please provide valid credentials to proceed.'),
      );
    }
  });

  it('should throw an error when the credential object is missing required fields', () => {
    try {
      validateCredentialConfigs([
        // @ts-ignore
        {
          type: 'objectEvent',
          version: 'v0.0.1',
        },
      ]);
    } catch (error) {
      expect(error).toEqual(
        new Error(
          `Each credential object must contain 'type', 'version', and 'dataPath' fields. Please ensure all required fields are provided.`,
        ),
      );
    }
  });
});

describe('readFile', () => {
  it('should read the file', async () => {
    jest.spyOn(fs, 'readFile' as any).mockResolvedValue('{"test": "test"}');
    JSON.parse = jest.fn().mockImplementation(() => {
      return {
        test: 'test',
      };
    });
    const result = await readFile('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual({ test: 'test' });
  });

  it('should throw an error when the file is not found', async () => {
    jest.spyOn(fs, 'readFile' as any).mockRejectedValue(new Error('File not found'));
    try {
      await readFile('/untp-test-suite/src/config/credentials.json');
    } catch (error) {
      expect(error).toEqual(new Error('File not found'));
    }
  });
});
