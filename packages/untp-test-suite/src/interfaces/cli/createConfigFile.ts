import fs from 'fs';
import semver from 'semver';

const SCHEMAS_PATH = 'src/schemas';

const getPath = (path: string) => {
  const parentDir = process.cwd();
  return `${parentDir}/${path}`;
};

const getSchemaPath = () => getPath(SCHEMAS_PATH);
const getSchemaTypeName = (): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    fs.readdir(getSchemaPath(), (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
};

const getLastestSchemaVersion = (type: string) => {
  const schemaPath = getSchemaPath();
  try {
    const schemaVersions = fs.readdirSync(`${schemaPath}/${String(type)}`);
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

    const mapped = types.map((type) => ({
      type: type,
      version: getLastestSchemaVersion(type),
      dataPath: '',
    }));

    return mapped;
  } catch (err) {
    console.error(err);
    return [];
  }
};

/**
 * Create a config file with the latest schema versions
 * @returns Promise<void> - A promise that resolves when the file is created
 */
const createConfigFile = async (configFilePath = './credentials.json'): Promise<void> => {
  const config = await mapTypesAndVersions();
  const configData = JSON.stringify(config, null, 2);
  return new Promise((resolve, reject) => {
    fs.writeFile(configFilePath, configData, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

export { createConfigFile };
