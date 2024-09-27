import { readdir, writeFile } from 'fs/promises';
import path from 'path';
import semver from 'semver';
import { getCurrentDirPath, getCurrentFilePath } from '../../utils/path.js';

export interface ICredentialFileData {
  credentials: {
    type: string;
    version: string | null;
    dataPath: string;
  }[];
}

export const getLastestVersionFolder = async (schemasPath: string, eventType: string) => {
  const versionFolders = await readdir(`${schemasPath}/${eventType}`);
  const latestVersionFolder = semver.maxSatisfying(versionFolders, '*');

  return latestVersionFolder;
};

export const getLatestCredentialVersions = async (schemasPath: string) => {
  const eventTypeFolders = await readdir(schemasPath);

  const latestCredentialPromises = eventTypeFolders.map(async (eventType) => {
    const latestVersion = await getLastestVersionFolder(schemasPath, eventType);

    return {
      type: eventType,
      version: latestVersion,
      dataPath: '',
    };
  });

  const latestCredentials = await Promise.all(latestCredentialPromises);
  return latestCredentials;
};

export const generateCredentialFile = async (storePath: string): Promise<ICredentialFileData> => {
  const currentDirPath = getCurrentDirPath(getCurrentFilePath());
  const schemasPath = path.resolve(currentDirPath, '../../src/schemas');
  const latestCredentials = await getLatestCredentialVersions(schemasPath);
  const credentialFileData = {
    credentials: latestCredentials,
  };

  const credentialFileDataJson = JSON.stringify(credentialFileData, null, 2);
  await writeFile(storePath, credentialFileDataJson);

  return credentialFileData;
};
