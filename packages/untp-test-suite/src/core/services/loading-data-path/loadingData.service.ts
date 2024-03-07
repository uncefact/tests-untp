import * as fs from 'fs';
import { readConfigContent, validateConfigContent } from './utils';
import { goUpLevels } from '../../utils/common';
// const results = await Promise.all(promises);

export const loadingConfigContentServices = async () => {
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

export const loadingDataPath = async (schema: string) => {
  const content = await loadingConfigContentServices();
  const dataPathBySchema = content?.find((item) => item.type === schema);
  const rootPath = goUpLevels(process.cwd(), 3);
  return fs.promises.readFile(`${rootPath}/${dataPathBySchema?.dataPath as string}`, 'utf-8');
};
