import _ from 'lodash';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigCredentials } from '../../types/index.js';

export const readConfigContent = () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const CONFIG_PATH = path.resolve(__dirname, '../../../config'); // ../tests-untp/packages/untp-test-suite/src/config
  return fs.promises.readFile(`${CONFIG_PATH}/credentials.json`, 'utf-8');
};

export const validateConfigContent = (value: ConfigCredentials) => {
  if (_.isEmpty(value)) throw new Error('Invalid data');
  const data = value.credentials;
  if (_.isEmpty(data)) throw new Error('Invalid credentials');
  data.forEach((item) => {
    if (_.isEmpty(item.type)) throw new Error('Invalid type');
    if (_.isEmpty(item.version)) throw new Error('Invalid version');
    if (_.isEmpty(item.dataPath)) throw new Error('Invalid dataPath');
  });
  return data;
};
