import fs from 'fs';
import path from 'path';

/**
 * Go up levels in the directory tree
 * @param folderPath - The path to the current folder
 * @param levels - The number of levels to go up
 * @returns The path to the target folder
 */
const goUpLevels = (folderPath: string, levels: number): string => {
  let targetPath = folderPath;
  for (let i = 0; i < levels; i++) {
    targetPath = path.dirname(targetPath);
  }
  return targetPath;
};

/**
 * Check if a file exists
 * @param filePath - The path to the file
 * @returns A promise that resolves to a boolean indicating if the file exists
 */
const checkFileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath);
    return true; // The file exists
  } catch {
    return false; // The file does not exist
  }
};

/**
 * Check if a schema exists
 * @param schemaName - The name of the schema
 * @returns A promise that resolves to a boolean indicating if the schema exists
 */
export const checkSchemaExists = async (schemaName: string): Promise<boolean> => {
  const targetPath = goUpLevels(process.cwd(), 3);
  return checkFileExists(`${targetPath}/schemas/${schemaName}`);
};

/**
 * Check if a schema version exists
 * @param folderName - The name of the schema
 * @param version - The version of the schema
 * @returns A promise that resolves to a boolean indicating if the schema version exists
 */
export const checkSchemaVersionExists = async (folderName: string, version: string): Promise<boolean> => {
  const targetPath = goUpLevels(process.cwd(), 3);
  return checkFileExists(`${targetPath}/schemas/${folderName}/${version}`);
};

/**
 * Get the content of a schema
 * @param folderName - The name of the schema
 * @param version - The version of the schema
 * @returns A promise that resolves to the content of the schema
 */
export const getSchemaContent = (folderName: string, version: string): Promise<string> => {
  const targetPath = goUpLevels(process.cwd(), 3);
  return fs.promises.readFile(`${targetPath}/schemas/${folderName}/${version}/schema.json`, 'utf-8');
};
