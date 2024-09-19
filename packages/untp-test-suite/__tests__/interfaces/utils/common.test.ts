import fs from 'fs/promises';

import { readJsonFile, truncateString } from '../../../src/interfaces/utils/common';

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

describe('truncateString', () => {
  it('should return the original string if it is shorter than the maxLength', () => {
    const result = truncateString('Short text', 20);
    expect(result).toBe('Short text');
  });

  it('should return the original string if its length is equal to the maxLength', () => {
    const result = truncateString('Exact length', 12);
    expect(result).toBe('Exact length');
  });

  it('should return the truncated string with "..." if it exceeds the maxLength', () => {
    const result = truncateString('This is a very long string', 10);
    expect(result).toBe('This is a ...');
  });

  it('should return an empty string if an empty string is provided', () => {
    const result = truncateString('', 10);
    expect(result).toBe('');
  });

  it('should handle a very short maxLength and still return a truncated string with "..."', () => {
    const result = truncateString('Hello World', 3);
    expect(result).toBe('Hel...');
  });

  it('should return the original string if maxLength is greater than string length', () => {
    const result = truncateString('Hello', 10);
    expect(result).toBe('Hello');
  });
});
