import * as fs from 'fs';
import { readConfigContent, validateConfigContent } from './utils';
import { ConfigContent } from '../../types';
import { goUpLevels } from '../../utils/common';

export const loadingConfigContentServices = async (): Promise<ConfigContent[]> => {
  try {
    const content = await readConfigContent();
    const validateContent = validateConfigContent(JSON.parse(content));
    if (!validateContent) throw new Error(validateContent);

    return validateContent;
  } catch (e) {
    const error = e as Error;
    throw new Error(error.message ?? 'Invalid config file');
  }
};

export const loadingDataPath = async (path: string) => {
  const rootPath = goUpLevels(process.cwd(), 3);
  return fs.promises.readFile(`${rootPath}/${path}`, 'utf-8');
};
