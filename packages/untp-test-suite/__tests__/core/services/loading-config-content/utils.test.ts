import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readConfigContent, validateConfigContent } from '../../../../src/core/services/loading-config-content/utils';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

const currentPath = '/tests-untp/packages/untp-test-suite/src/config';
jest.mock('path', () => ({
  dirname: jest.fn(),
  resolve: jest.fn().mockReturnValue(currentPath),
}));

describe('readConfigContent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return credentials value', async () => {
    const mockCredentials = {
      dataPath: 'dataPath',
      type: 'schema',
      version: 'v1.0.0',
    };

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCredentials));
    const result = await readConfigContent();
    expect(result).toBe(JSON.stringify(mockCredentials));
  });

  it('should throw error when invalid config content', async () => {
    const mockCredentials = {
      dataPath: 'dataPath',
      type: 'schema',
      version: 'v1.0.0',
    };

    const error = new Error('Invalid config content');
    (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

    expect(readConfigContent()).rejects.toThrow('Invalid config content');
  });
});

describe('validateConfigContent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a valid value', () => {
    const mockCredentials = {
      credentials: [
        {
          dataPath: 'dataPath',
          type: 'schema',
          version: 'v1.0.0',
        },
      ],
    };

    const result = validateConfigContent(mockCredentials);
    expect(result).toBe(mockCredentials.credentials);
  });

  it('should throw error when invalid data', () => {
    const mockCredentials = {};
    // @ts-ignore
    expect(() => validateConfigContent(mockCredentials)).toThrow('Invalid data');
  });

  it('should throw error when invalid credentials', () => {
    const mockCredentials = {
      credentials: [],
    };

    expect(() => validateConfigContent(mockCredentials)).toThrow('Invalid credentials');
  });

  it('should throw error when invalid type', () => {
    const mockCredentials = {
      credentials: [
        {
          dataPath: 'dataPath',
          type: 'schema',
          version: 'v1.0.0',
        },
      ],
    };

    mockCredentials.credentials[0].type = '';
    expect(() => validateConfigContent(mockCredentials)).toThrow('Invalid type');
  });

  it('should throw error when invalid version', () => {
    const mockCredentials = {
      credentials: [
        {
          dataPath: 'dataPath',
          type: 'schema',
          version: 'v1.0.0',
        },
      ],
    };

    mockCredentials.credentials[0].version = '';
    expect(() => validateConfigContent(mockCredentials)).toThrow('Invalid version');
  });

  it('should throw error when invalid dataPath', () => {
    const mockCredentials = {
      credentials: [
        {
          dataPath: 'dataPath',
          type: 'schema',
          version: 'v1.0.0',
        },
      ],
    };

    mockCredentials.credentials[0].dataPath = '';
    expect(() => validateConfigContent(mockCredentials)).toThrow('Invalid dataPath');
  });
});
