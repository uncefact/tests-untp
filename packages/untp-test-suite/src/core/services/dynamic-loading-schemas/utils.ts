import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const SCHEMA_PATH = path.resolve(process.cwd(), '../../../schemas'); // ../tests-untp/packages/untp-test-suite/src/schemas

/**
 * Check if a schema exists
 * @param schemaName - The name of the schema
 * @returns A promise that resolves to a boolean indicating if the schema exists
 */
export const checkSchemaExists = async (schemaName: string): Promise<boolean> => {
  return checkFileExists(`${SCHEMA_PATH}/${schemaName}`);
};

/**
 * Check if a schema version exists
 * @param folderName - The name of the schema
 * @param version - The version of the schema
 * @returns A promise that resolves to a boolean indicating if the schema version exists
 */
export const checkSchemaVersionExists = async (folderName: string, version: string): Promise<boolean> => {
  return checkFileExists(`${SCHEMA_PATH}/${folderName}/${version}`);
};

/**
 * Get the content of a schema
 * @param folderName - The name of the schema
 * @param version - The version of the schema
 * @returns A promise that resolves to the content of the schema
 */
export const getSchemaContent = (folderName: string, version: string): Promise<string> => {
  return fs.promises.readFile(`${SCHEMA_PATH}/${folderName}/${version}/schema.json`, 'utf-8');
};
