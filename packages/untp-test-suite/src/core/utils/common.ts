import * as path from 'path';

/**
 * Go up levels in the directory tree
 * @param folderPath - The path to the current folder
 * @param levels - The number of levels to go up
 * @returns The path to the target folder
 */
export const goUpLevels = (folderPath: string, levels: number): string => {
  let targetPath = folderPath;
  for (let i = 0; i < levels; i++) {
    targetPath = path.dirname(targetPath);
  }
  return targetPath;
};
