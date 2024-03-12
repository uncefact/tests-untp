import { readdir, writeFile } from 'fs/promises';
import semver from 'semver';

const SCHEMAS_PATH = 'src/schemas';

const getPath = (path: string) => {
  const parentDir = process.cwd();
  return `${parentDir}/${path}`;
};

const getSchemaPath = () => getPath(SCHEMAS_PATH);
const getSchemaTypeName = (): Promise<string[]> => {
  return readdir(getSchemaPath());
};

const getLastestSchemaVersion = async (type: string) => {
  const schemaPath = getSchemaPath();
  try {
    const schemaVersions = await readdir(`${schemaPath}/${type}`);
    const latestVersion = semver.maxSatisfying(schemaVersions, '*');
    return latestVersion;
  } catch (err) {
    console.error(err);
    return '';
  }
};

const mapTypesAndVersions = async () => {
  try {
    const types = await getSchemaTypeName();

    const mapped = types.map(async (type) => ({
      type: type,
      version: await getLastestSchemaVersion(type),
      dataPath: '',
    }));

    return Promise.all(mapped);
  } catch (err) {
    console.error(err);
    return [];
  }
};

/**
 * Create a config file with the latest schema versions
 * @returns Promise<void> - A promise that resolves when the file is created
 */
const createConfigFile = async (configFilePath: string): Promise<void> => {
  const config = await mapTypesAndVersions();
  const configData = JSON.stringify(config, null, 2);
  await writeFile(configFilePath, configData);
};

export { createConfigFile };
