import { fetchData } from '../../utils/common.js';
import { checkSchemaExists, checkSchemaVersionExists, getSchemaContent } from './utils.js';

/**
 * Dynamic loading schema service to load schema from URL or from the schema content
 * @param type - The credential type
 * @param version - The schema version
 * @param url - Optional URL to fetch the schema from
 * @returns The schema content
 */
export const dynamicLoadingSchemaService = async (type: string, version: string, url?: string) => {
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
    if (!type) {
      throw new Error(`Type is required for local schema loading`);
    }

    if (!version) {
      throw new Error(`Version is required for local schema loading`);
    }

    const isValidSchema = await checkSchemaExists(type);
    if (!isValidSchema) {
      throw new Error(`Schema not found`);
    }

    const isValidVersion = await checkSchemaVersionExists(type, version);
    if (!isValidVersion) {
      throw new Error(`Version not found for schema ${type}`);
    }

    const content = await getSchemaContent(type, version);
    if (!content) {
      throw new Error(`Content in ${type} schema not found`);
    }

    return JSON.parse(content);
  } catch (e) {
    const error = e as Error;
    return error?.message || 'Failed to load schema';
  }
};
