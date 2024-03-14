import fs from 'fs/promises';
import { readJsonFile } from '../../src/interfaces/utils';

describe('readJsonFile', () => {
  const credentialFilePath = 'config/credential.json';
  const dataFileJsonMock = JSON.stringify({
    credentials: [{
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: ''
    }],
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
