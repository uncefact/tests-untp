import fs from 'fs';
import { getSchemasName, getSchemasTypeAndVersion, getContentSchema } from '../../src/schemas';

jest.mock('fs', () => ({
  readdir: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));
jest.mock('path', () => ({
  dirname: jest.fn(),
  join: jest.fn(),
}));

jest.mock('url', () => ({
  fileURLToPath: jest.fn(),
  pathToFileURL: jest.fn().mockReturnValue(''),
}));

describe('schemas', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(() => {
    (fs.statSync as any).mockReturnValue({ isDirectory: () => true });
  });

  it('should return an empty array when only .ts files are present', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent.ts']);
    });
    const result = await getSchemasName();
    expect(result).toEqual([]);
  });

  it('should return an array do not contain .ts files', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent.ts', 'aggregationEvent']);
    });
    const result = await getSchemasName();
    expect(result).toEqual(['aggregationEvent']);
  });

  it('should get the names of the schemas', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent', 'aggregationEvent']);
    });
    const result = await getSchemasName();
    expect(result).toEqual(['objectEvent', 'aggregationEvent']);
  });

  it('should get the version of the schemas', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent', 'aggregationEvent']);
    });
    (fs.readdirSync as any).mockReturnValue(['v1.0.0', 'v1.0.1']);
    const result = await getSchemasTypeAndVersion();
    expect(result).toEqual({
      objectEvent: { version: ['v1.0.0', 'v1.0.1'] },
      aggregationEvent: { version: ['v1.0.0', 'v1.0.1'] },
    });
  });

  it('should get the content of the schema', async () => {
    (fs.readFileSync as any).mockReturnValue('content');
    (fs.promises.readFile as any).mockResolvedValue('content');
    const result = await getContentSchema('objectEvent', 'v1.0.0');
    expect(result).toEqual('content');
  });

  it('should reject when read file error in getSchemaNam function', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(new Error('error'), []);
    });
    await expect(getSchemasName()).rejects.toThrow('error');
  });

  it('should reject when read file error in getSchemaTypeAndVersion function', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(new Error('error'), []);
    });

    const result = await getSchemasTypeAndVersion();
    expect(result).toEqual({});
  });
});
