import * as fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { readConfigContent, validateConfigContent } from './utils';
import { ConfigContent } from '../../types';

export const loadingConfigContentServices = async (): Promise<ConfigContent[]> => {
  const content = await readConfigContent();
  const validateContent = validateConfigContent(JSON.parse(content));
  if (!validateContent) throw new Error(validateContent);

  return validateContent;
};

export const loadingDataPath = async (path: string) => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const DATA_PATH = resolve(__dirname, '../../../../'); // ../tests-untp/packages/untp-test-suite
  return fs.promises.readFile(`${DATA_PATH}/${path}`, 'utf-8');
};
