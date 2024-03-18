import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const getCurrentFilePath = () => {
  return fileURLToPath(import.meta.url);
};

export const getCurrentDirPath = (filePath: string) => {
  return dirname(filePath);
};