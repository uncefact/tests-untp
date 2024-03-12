import fs from 'fs';
import path from 'path';

import {
  checkSchemaExists,
  checkSchemaVersionExists,
  getSchemaContent,
} from '../../../../src/core/services/dynamic-loading-schemas/utils';

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('path', () => ({
  dirname: jest.fn(),
  resolve: jest.fn().mockReturnValue('/tests-untp/packages/untp-test-suite/src/schemas'),
}));

describe('utils dynamic loading schema', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const schemaName = 'event';
  const currentPath = '/tests-untp/packages/untp-test-suite/src/schemas';

  it('should check if a schema exists', async () => {
    const expectedPath = `${currentPath}/${schemaName}`;
    const accessSpy = jest.spyOn(fs.promises, 'access').mockResolvedValue();
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);

    const result = await checkSchemaExists(schemaName);

    expect(result).toBe(true);
    expect(accessSpy).toHaveBeenCalledWith(`${expectedPath}`);
  });

  const version = 'v1.0.0';
  it('should check if a schema version exists', async () => {
    const expectedPath = `${currentPath}/${schemaName}/${version}`;
    const accessSpy = jest.spyOn(fs.promises, 'access').mockResolvedValue();
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);

    const result = await checkSchemaVersionExists(schemaName, version);

    expect(result).toBe(true);
    expect(accessSpy).toHaveBeenCalledWith(`${expectedPath}`);
  });

  it('should get the content of a schema', async () => {
    const content = 'content';
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);
    jest.spyOn(fs.promises, 'access').mockResolvedValue();
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(content);

    const result = await getSchemaContent(schemaName, version);

    expect(result).toBe(content);
  });

  it('should throw an error if the schema file does not exist', async () => {
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);
    jest.spyOn(fs.promises, 'access').mockRejectedValue(new Error('File not found'));

    const result = await checkSchemaExists(schemaName);
    expect(result).toBe(false);
  });

  it('should throw an error if the version file does not exist', async () => {
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);
    jest.spyOn(fs.promises, 'access').mockRejectedValue(new Error('File not found'));

    const result = await checkSchemaVersionExists(schemaName, version);
    expect(result).toBe(false);
  });

  it('should throw an error if the schema content does not exist', async () => {
    jest.spyOn(path, 'dirname').mockReturnValue(currentPath);
    jest.spyOn(fs.promises, 'access').mockResolvedValue();
    jest.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('File not found'));

    await expect(getSchemaContent(schemaName, version)).rejects.toThrow('File not found');
  });
});
