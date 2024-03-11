import { readConfigContent, validateConfigContent } from '../../../../src/core/services/loading-config-content/utils';
import {
  loadingConfigContentServices,
  loadingDataPath,
} from '../../../../src/core/services/loading-config-content/loadingConfigContent.service';
import * as fs from 'fs';

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('../../../../src/core/services/loading-config-content/utils', () => ({
  readConfigContent: jest.fn(),
  validateConfigContent: jest.fn(),
}));

describe('loadingConfigContentServices', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockCredentials = {
    dataPath: 'dataPath',
    type: 'schema',
    version: 'v1.0.0',
  };

  it('should return credentials value', async () => {
    JSON.parse = jest.fn().mockImplementation(() => {
      return mockCredentials;
    });
    (readConfigContent as jest.Mock).mockResolvedValue(mockCredentials);
    (validateConfigContent as jest.Mock).mockReturnValue(mockCredentials);

    const result = await loadingConfigContentServices();

    expect(result).toBe(mockCredentials);
  });

  it('should throw error when invalid config file', async () => {
    const error = new Error('Invalid config file');
    (readConfigContent as jest.Mock).mockRejectedValue(error);

    try {
      await loadingConfigContentServices();
    } catch (e) {
      expect(e.message).toBe('Invalid config file');
    }
  });

  it('should throw error when invalid config content', async () => {
    (readConfigContent as jest.Mock).mockResolvedValue(mockCredentials);
    JSON.parse = jest.fn().mockImplementation(() => {
      return mockCredentials;
    });
    const error = new Error('Invalid config content');

    (validateConfigContent as jest.Mock).mockReturnValue(error);
    const result = await loadingConfigContentServices();
    expect(result).toBe(error);
  });
});

describe('loadingDataPath', () => {
  it('should return content with data path when call loadingDataPath()', async () => {
    const mockContent = { content: 'content' };
    (fs.promises.readFile as jest.Mock).mockResolvedValue(mockContent);
    const result = await loadingDataPath('/data/value.json');

    expect(result).toBe(mockContent);
  });

  it('should throw error when invalid data path', async () => {
    const error = new Error('Invalid data path');
    (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

    try {
      await loadingDataPath('/data/value.json');
    } catch (e) {
      expect(e.message).toBe('Invalid data path');
    }
  });
});
