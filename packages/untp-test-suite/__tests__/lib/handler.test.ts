import fs from 'fs';
import path from 'path';
import * as handler from '../../src/interfaces/lib/handler';
import * as credentials from '../../src/interfaces/utils/credentials';
import * as utils from '../../src/interfaces/utils/common';

jest.mock('chalk', () => ({
  yellow: jest.fn((text: string) => text),
  bgGreen: {
    white: {
      bold: jest.fn((text: string) => text),
    },
  },
  bgRed: {
    white: {
      bold: jest.fn((text: string) => text),
    },
  },
  red: jest.fn((text: string) => text),
}));

console.log = jest.fn();

describe('testSuiteHandler', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully execute with non configuration path', async () => {
    const nonConfigs = {};

    await handler.testSuiteHandler(nonConfigs);

    expect(console.log).toHaveBeenCalledWith('Untp test suites are running......');
    expect(console.log).toHaveBeenCalledWith('Untp test suites have completed successfully!');
  });

  it('should successfully execute with custom configuration path', async () => {
    const configs = { config: '/test/path.json' };

    await handler.testSuiteHandler(configs);

    expect(console.log).toHaveBeenCalledWith('Untp test suites are running......');
    expect(console.log).toHaveBeenCalledWith('Untp test suites have completed successfully!');
  });

  it('should handle error invalid configuration path', async () => {
    jest.spyOn(path, 'resolve').mockImplementationOnce(() => {
      throw new Error('Invalid configuration path!');
    });
    const invalidOptions = { config: 'invalid-path' };

    await handler.testSuiteHandler(invalidOptions);

    expect(console.log).toHaveBeenCalledWith('Untp test suites are running......');
    expect(console.log).toHaveBeenCalledWith('Run Untp test suites failed');
    expect(console.log).toHaveBeenCalledWith(Error('Invalid configuration path!'));
  });
});

describe('generateCredentialFile', () => {
  const storePath = `${process.cwd()}/credentials.json`;
  const schemasPath = `${process.cwd()}/src/schemas`;
  const credentialFileData = {
    credentials: [
      {
        type: 'aggregationEvent',
        version: 'v0.0.1',
        dataPath: '/data/aggregationEvent',
      },
    ],
  };

  it('should generate credential file successfully', async () => {
    jest.spyOn(utils, 'readJsonFile').mockResolvedValueOnce(null);
    jest.spyOn(credentials, 'generateCredentialFile').mockResolvedValueOnce(credentialFileData);

    await handler.generateCredentialFileHandler(storePath, schemasPath);

    expect(console.log).toHaveBeenCalledWith(`Credential file 'credentials.json' generated successfully!`);
  });

  it('should handle existing credential file', async () => {
    jest.spyOn(utils, 'readJsonFile').mockResolvedValueOnce(credentialFileData);

    await handler.generateCredentialFileHandler(storePath, schemasPath);

    expect(console.log).toHaveBeenCalledWith(`Credential file 'credentials.json' already exists!`);
  });

  it('should handle error when failed to create config file', async () => {
    jest.spyOn(utils, 'readJsonFile').mockResolvedValueOnce(null);
    jest.spyOn(credentials, 'generateCredentialFile').mockRejectedValueOnce('Failed to write file');

    await handler.generateCredentialFileHandler(storePath, schemasPath);

    expect(console.log).toHaveBeenCalledWith('Generate the credentials file failed!');
    expect(console.log).toHaveBeenCalledWith('Failed to write file');
  });
});
