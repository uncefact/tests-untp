import fs from 'fs';
import { createConfigFile } from '../../build/interfaces/cli/createConfigFile';

jest.mock('fs', () => ({
  writeFile: jest.fn(),
  readdir: jest.fn(),
  readdirSync: jest.fn(),
}));

describe('createConfigFile', () => {
  it('should call createConfigFile successful', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent', 'productPassport']);
    });

    (fs.readdirSync as any).mockImplementation(() => ['v0.0.2', 'v0.0.2']);

    (fs.writeFile as any).mockImplementationOnce((_path, _data, callback) => {
      callback(null);
    });
    await createConfigFile();

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('should show errors when fs.writeFile return error', async () => {
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent', 'productPassport']);
    });

    (fs.readdirSync as any).mockImplementation(() => ['v0.0.2', 'v0.0.2']);

    const error = new Error('writeFile error');
    (fs.writeFile as any).mockImplementationOnce((_path: any, _data: any, callback: (arg0: Error) => any) =>
      callback(error),
    );

    createConfigFile().catch((error) => {
      expect(error).not.toBeNull();
      expect(error.message).toBe('writeFile error');
    });
  });

  it('should show errors when fs.readdir in getSchemaTypeName() catch error', async () => {
    const error = new Error('readdir error');
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(error, null);
    });

    createConfigFile().catch((error) => {
      expect(error).not.toBeNull();
    });
  });

  it('should show errors when fs.readdirSync in getLastestSchemaVersion() catch error', async () => {
    const error = new Error('readdirSync error');
    (fs.readdir as any).mockImplementation((_path, callback) => {
      callback(null, ['objectEvent', 'productPassport']);
    });

    (fs.readdirSync as any).mockImplementation(() => {
      throw error;
    });

    createConfigFile().catch((error) => {
      expect(error).not.toBeNull();
    });
  });
});
