import _ from 'lodash';
import * as fs from 'fs';
import { ConfigCredentials } from '../../types/index.js';
import { goUpLevels } from '../../utils/common.js';

export const readConfigContent = () => {
  const targetPath = goUpLevels(process.cwd(), 3);
  return fs.promises.readFile(`${targetPath}/config/credentials.json`, 'utf-8');
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
