import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import semver from 'semver';

const SCHEMAS_PATH = 'src/schemas';
const CONFIG_PATH = 'src/config';

const getPath = (path) => {
  const __filename = fileURLToPath(new URL(import.meta.url));
  const __dirname = dirname(__filename);
  const parentDir = dirname(__dirname);
  return `${parentDir}/${path}`;
};

const getSchemaPath = () => getPath(SCHEMAS_PATH);
const getSchemaTypeName = () => {
  return new Promise((resolve, reject) => {
    fs.readdir(getSchemaPath(), (err, files) => {
      if (err) {
        console.error(`Error reading directory: ${err.toString()}`);
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
};

const getLastestSchemaVersion = async () => {
  const schemaPath = getSchemaPath();
  const versions = [];
  try {
    const files = await getSchemaTypeName();
    files.forEach((file) => {
      const schemaVersions = fs.readdirSync(`${schemaPath}/${String(file)}`);
      const latestVersion = semver.maxSatisfying(schemaVersions, '*');
      versions.push({ version: latestVersion });
    });
    return versions;
  } catch (err) {
    console.error(err);
    return [];
  }
};

const mapTypesAndVersions = async () => {
  try {
    const types = await getSchemaTypeName();
    const versions = await getLastestSchemaVersion();

    const mapped = types.map((type, index) => ({
      type: type,
      version: versions[index].version,
      dataPath: '',
    }));

    return mapped;
  } catch (err) {
    console.error(err);
    return [];
  }
};

const getConfigPath = () => getPath(CONFIG_PATH);

/**
 * Create a config file with the latest schema versions
 */
const createConfigFile = async () => {
  const config = await mapTypesAndVersions();
  const configData = JSON.stringify(config, null, 2);
  fs.writeFile(`${getConfigPath()}/credentials.json`, configData, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log('Config file created successfully');
    }
  });
};

createConfigFile();
