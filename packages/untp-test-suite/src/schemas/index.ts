import fs from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SchemaVerions = Record<string, { version: string[] }>;

/**
 * Get the names of the schemas in the schemas directory
 * @returns ['objectEvent', 'aggregationEvent']
 */
export const getSchemasName = (): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    fs.readdir(__dirname, (err, files) => {
      if (err) {
        reject(err);
      } else {
        const filteredFiles = files.filter((file) => {
          if (/\.(ts|js)$/i.test(file)) {
            return false;
          }

          // Only include directories
          return fs.statSync(join(__dirname, file)).isDirectory();
        });

        resolve(filteredFiles);
      }
    });
  });
};

/**
 * Get the version of the schemas in the schemas directory
 * @returns
 * {
 *   objectEvent: { version: ['v1.0.0', 'v1.0.1'] },
 *   aggregationEvent: { version: ['v0.0.1' ] },
 * }
 */
export const getSchemasVersion = async (): Promise<SchemaVerions> => {
  const obj = {} as Record<string, { version: string[] }>;
  try {
    const files = await getSchemasName();
    files.forEach((file) => {
      const schemaVersions = fs.readdirSync(`${__dirname}/${String(file)}`);
      obj[file] = { version: schemaVersions };
    });

    return obj;
  } catch (err) {
    return {};
  }
};

/**
 * Get the content of the schema
 * @param schema - The name of the schema
 * @param version - The version of the schema
 * @returns The content of the schema
 */
export const getContentSchema = async (schema: string, version: string): Promise<any> => {
  const schemaPath = join(__dirname, schema, version, 'schema.json');
  return fs.promises.readFile(schemaPath, 'utf-8');
};
