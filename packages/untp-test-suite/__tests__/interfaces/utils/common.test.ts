import fs from 'fs/promises';

import { createClickableUrl, readJsonFile, truncateString } from '../../../src/interfaces/utils/common';

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

describe('createClickableUrl', () => {
  it('should return an empty string if the fullUrl is empty', () => {
    const result = createClickableUrl('', 'Click Here');
    expect(result).toBe('');
  });

  it('should replace "&#x3D;" with "=" in the URL', () => {
    const urlWithEncodedEqualSign = 'https://example.com/?param&#x3D;value';
    const result = createClickableUrl(urlWithEncodedEqualSign, 'Click Here');
    const expectedUrl = `\u001b]8;;https://example.com/?param=value\u0007Click Here\u001b]8;;\u0007`;
    expect(result).toBe(expectedUrl);
  });

  it('should return a clickable URL string for the terminal with display text', () => {
    const fullUrl = 'https://example.com/';
    const displayText = 'Click Here';
    const result = createClickableUrl(fullUrl, displayText);
    const expectedUrl = `\u001b]8;;https://example.com/\u0007${displayText}\u001b]8;;\u0007`;
    expect(result).toBe(expectedUrl);
  });

  it('should handle a URL without encoded "&#x3D;" correctly', () => {
    const fullUrl = 'https://example.com/?param=value';
    const result = createClickableUrl(fullUrl, 'Click Here');
    const expectedUrl = `\u001b]8;;https://example.com/?param=value\u0007Click Here\u001b]8;;\u0007`;
    expect(result).toBe(expectedUrl);
  });
});