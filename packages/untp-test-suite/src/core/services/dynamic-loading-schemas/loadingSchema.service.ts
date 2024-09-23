import { fetchData } from '../../utils/common.js';
import { IDynamicLoadingSchemaService } from './types.js';
import { checkSchemaExists, checkSchemaVersionExists, getSchemaContent } from './utils.js';

/**
 * Dynamic loading schema service to load schema from URL or from the schema content
 * @param schema - The schema name
 * @param version - The schema version
 * @param url - The URL to fetch the schema from
 * @param dataPath - The path to the data
 * @returns The schema content
 */
export const dynamicLoadingSchemaService: IDynamicLoadingSchemaService = async (schema, version, url, dataPath) => {
  try {
    // Fetch schema from URL
    if (url) {
      const { data, error, success } = await fetchData(url);
      // Handle fetch failure
      if (!success) {
        throw new Error(error as string);
      }

      return data;
    }

    // Fetch schema from local content
    const isValidSchema = await checkSchemaExists(schema);
    if (!isValidSchema) {
      throw new Error(`Schema not found`);
    }

    const isValidVersion = await checkSchemaVersionExists(schema, version);
    if (!isValidVersion) {
      throw new Error(`Version not found for schema ${schema}`);
    }

    const content = await getSchemaContent(schema, version);
    if (!content) {
      throw new Error(`Content in ${schema} schema not found`);
    }

    return JSON.parse(content);
  } catch (e) {
    const error = e as Error;
    return {
      keyword: 'schemaLoadingError',
      instancePath: 'schema',
      message: error?.message || 'Failed to load schema',
      dataPath,
    };
  }
};
