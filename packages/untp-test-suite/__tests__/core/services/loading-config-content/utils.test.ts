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

describe('loading content utils', () => {
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
});
