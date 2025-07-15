import * as fs from 'fs/promises';
import {
  validateCredentialConfigs,
  readJsonFile,
  validateUrlField,
  fetchData,
  loadDataFromDataPath,
  extractVersionFromContext,
  extractCredentialType,
} from '../../../src/core/utils/common';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('path', () => {
  return {
    resolve: jest.fn(),
  };
});

describe('validateCredentialConfigs', () => {
  const credentialConfigsPath = 'path/to/credentials';

  it('should throw an error when the array of credential configurations is empty', () => {
    expect(() => {
      validateCredentialConfigs([], credentialConfigsPath);
    }).toThrow('Credentials array cannot be empty. Please provide valid credentials to proceed.');
  });

  it('should return an array of errors when the credential configurations are invalid', () => {
    const credentialConfigs = [
      {
        type: '',
        version: '',
        dataPath: 'path/to/data',
      },
      {
        type: 'objectEvent',
        version: 'v1.0',
        dataPath: 'path/to/data',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: '',
        version: '',
        dataPath: 'path/to/data',
        errors: [],
      },
      {
        type: 'objectEvent',
        version: 'v1.0',
        dataPath: 'path/to/data',
        errors: [],
      },
    ]);
  });

  it('should validate a local schema with valid type and version', () => {
    const credentialConfigs = [
      {
        type: 'objectEvent',
        version: 'v1.0',
        url: '',
        dataPath: 'path/to/data',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: 'objectEvent',
        version: 'v1.0',
        url: '',
        dataPath: 'path/to/data',
        errors: [],
      },
    ]);
  });

  it('should validate a remote schema with a valid URL', () => {
    const credentialConfigs = [
      {
        type: '',
        version: '',
        url: 'https://example.com',
        dataPath: 'path/to/data',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: '',
        version: '',
        url: 'https://example.com',
        dataPath: 'path/to/data',
        errors: [],
      },
    ]);
  });

  it('should validate a remote schema with an invalid URL', () => {
    const credentialConfigs = [
      {
        type: '',
        version: '',
        url: 'example.com',
        dataPath: 'path/to/data',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: '',
        version: '',
        url: 'example.com',
        dataPath: 'path/to/data',
        errors: [
          {
            message: 'The URL "example.com" is not a valid URL.',
            keyword: 'format',
            dataPath: 'path/to/credentials',
            instancePath: 'url',
          },
        ],
      },
    ]);
  });

  it('should throw an error when dataPath is missing', () => {
    const credentialConfigs = [
      {
        type: 'objectEvent',
        version: 'v1.0',
        url: '',
        dataPath: '',
      },
    ];

    const result = validateCredentialConfigs(credentialConfigs, credentialConfigsPath);

    expect(result).toEqual([
      {
        type: 'objectEvent',
        version: 'v1.0',
        url: '',
        dataPath: '',
        errors: [
          {
            message: 'should have required property',
            keyword: 'required',
            dataPath: 'path/to/credentials',
            instancePath: 'dataPath',
          },
        ],
      },
    ]);
  });
});

describe('readFile', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('should read the file', async () => {
    jest.spyOn(fs, 'readFile' as any).mockResolvedValue('{"test": "test"}');
    JSON.parse = jest.fn().mockImplementation(() => {
      return {
        test: 'test',
      };
    });
    const result = await readJsonFile('/untp-test-suite/src/config/credentials.json');
    expect(result).toEqual({ test: 'test' });
  });

  it('should throw an error when the file is not found', async () => {
    jest.spyOn(fs, 'readFile' as any).mockRejectedValue(new Error('File not found'));
    try {
      await readJsonFile('/untp-test-suite/src/config/credentials.json');
    } catch (error) {
      expect(error).toEqual(new Error('File not found'));
    }
  });
});

describe('extractVersionFromContext', () => {
  it('should extract version from DPP context URL', () => {
    const credentialData = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/'],
    };

    expect(extractVersionFromContext(credentialData)).toBe('v0.5.0');
  });

  it('should extract version from DTE context URL', () => {
    const credentialData = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dte/0.4.2/'],
    };

    expect(extractVersionFromContext(credentialData)).toBe('v0.4.2');
  });

  it('should handle context as a single string', () => {
    const credentialData = {
      '@context': 'https://test.uncefact.org/vocabulary/untp/dpp/0.5.0/',
    };

    expect(extractVersionFromContext(credentialData)).toBe('v0.5.0');
  });

  it('should return null when no UNTP context is found', () => {
    const credentialData = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
    };

    expect(extractVersionFromContext(credentialData)).toBe(null);
  });

  it('should return null when context is missing', () => {
    const credentialData = {
      type: ['DigitalProductPassport', 'VerifiableCredential'],
    };

    expect(extractVersionFromContext(credentialData)).toBe(null);
  });

  it('should return null when credentialData is null', () => {
    expect(extractVersionFromContext(null)).toBe(null);
  });
});

describe('extractCredentialType', () => {
  it('should extract credential type from array of types', () => {
    const credentialData = {
      type: ['DigitalProductPassport', 'VerifiableCredential'],
    };

    expect(extractCredentialType(credentialData)).toBe('DigitalProductPassport');
  });

  it('should extract credential type from single type', () => {
    const credentialData = {
      type: 'DigitalTraceabilityEvent',
    };

    expect(extractCredentialType(credentialData)).toBe('DigitalTraceabilityEvent');
  });

  it('should return null when only VerifiableCredential type is present', () => {
    const credentialData = {
      type: ['VerifiableCredential'],
    };

    expect(extractCredentialType(credentialData)).toBe(null);
  });

  it('should return null when type is missing', () => {
    const credentialData = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
    };

    expect(extractCredentialType(credentialData)).toBe(null);
  });

  it('should return null when credentialData is null', () => {
    expect(extractCredentialType(null)).toBe(null);
  });
});

describe('validUrlField', () => {
  it('should return valid: false and error message if obj is not an object', () => {
    const obj = 'test';
    // @ts-ignore
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: false, errorMessage: 'The provided object is invalid.' });
  });

  it('should return valid: false and error message if field is missing or not a string', () => {
    const obj = {};
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: false, errorMessage: 'The field "url" is missing or not a valid string.' });
  });

  it('should return valid: false and error message if the URL is invalid', () => {
    const obj = { url: 'invalid-url' };
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: false, errorMessage: 'The URL "invalid-url" is not a valid URL.' });
  });

  it('should return valid: false and error message if field is an empty string', () => {
    const obj = { url: '' };
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: false, errorMessage: 'The field "url" is missing or not a valid string.' });
  });

  it('should return valid: false and error message if URL does not use http or https protocol', () => {
    const obj = { url: 'ftp://example.com' };
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({
      valid: false,
      errorMessage: 'The URL "ftp://example.com" must use http or https protocol.',
    });
  });

  it('should return valid: true if URL is valid and uses http protocol', () => {
    const obj = { url: 'http://example.com' };
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: true });
  });

  it('should return valid: true if URL is valid and uses https protocol', () => {
    const obj = { url: 'https://example.com' };
    const result = validateUrlField(obj, 'url');
    expect(result).toEqual({ valid: true });
  });
});

describe('fetchData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an error when the URL is invalid', async () => {
    const result = await fetchData('');

    expect(result).toEqual({
      data: null,
      error: 'Invalid URL provided.',
      success: false,
    });
  });

  it('should return an error if URL is not a string', async () => {
    const result = await fetchData('');

    expect(result).toEqual({
      data: null,
      error: 'Invalid URL provided.',
      success: false,
    });
  });

  it('should fetch data successfully with a valid URL', async () => {
    const mockData = { test: 'test' };
    const response = {
      json: jest.fn().mockResolvedValue(mockData),
    };

    global.fetch = jest.fn().mockResolvedValue(response);

    const result = await fetchData('https://example.com');
    expect(result).toEqual({
      data: mockData,
      error: null,
      success: true,
    });
  });

  it('should throw an error when fetching data fails', async () => {
    const mockError = new Error('Network error');

    global.fetch = jest.fn().mockRejectedValue(mockError);

    const result = await fetchData('https://example.com/data');

    expect(result).toEqual({
      data: null,
      error: 'Failed to fetch data from the URL: https://example.com/data.',
      success: false,
    });
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/data');
  });
});

describe('loadDataFromDataPath', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('should load data from dataPath using readJsonFile', async () => {
    const credentialConfig = {
      type: 'objectEvent',
      version: 'v1.0',
      url: '',
      dataPath: 'path/to/data.json',
    };
    const mockData = { name: 'John Doe' };
    JSON.parse = jest.fn().mockImplementation(() => {
      return mockData;
    });
    jest.spyOn(fs, 'readFile' as any).mockResolvedValue(JSON.stringify(mockData));

    const result = await loadDataFromDataPath(credentialConfig);

    expect(fs.readFile).toHaveBeenCalledWith('path/to/data.json', 'utf-8');
    expect(result).toEqual({ data: mockData });
  });

  it('should return provided data when data is provided and dataPath is not provided', async () => {
    const credentialConfig = {
      type: 'objectEvent',
      version: 'v1.0',
      url: '',
      dataPath: '',
    };
    const data = { name: 'John Doe' };
    const result = await loadDataFromDataPath(credentialConfig, data);

    expect(fs.readFile).not.toHaveBeenCalled(); // Ensure readJsonFile is not called
    expect(result).toEqual({ data });
  });

  it('should throw an error when data and dataPath are missing', async () => {
    try {
      // @ts-ignore
      await loadDataFromDataPath({});
    } catch (error) {
      expect(error).toEqual(new Error('Must provide either data or dataPath to check data by schema.'));
    }
  });
});
