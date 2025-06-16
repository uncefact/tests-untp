import { IConfigContent } from '../../types/index.js';
import { fetchData } from '../../utils/common.js';
import { IDynamicLoadingSchemaService } from './types.js';
import { checkSchemaExists, checkSchemaVersionExists, getSchemaContent } from './utils.js';

/**
 * Dynamic loading schema service to load schema from URL or from the schema content
 * @param schema - The schema name
 * @param version - The schema version
 * @param url - The URL to fetch the schema from
 * @returns The schema content
 */
export const dynamicLoadingSchemaService: IDynamicLoadingSchemaService = async (credentialConfig: IConfigContent) => {
  try {
    // Fetch schema from URL
    if (credentialConfig.url) {
      const { data, error, success } = await fetchData(credentialConfig.url);
      // Handle fetch failure
      if (!success) {
        throw new Error(error as string);
      }

      return data;
    }

    // Fetch schema from local content
    const isValidSchema = await checkSchemaExists(credentialConfig.type);
    if (!isValidSchema) {
      throw new Error(`Schema not found`);
    }

    const isValidVersion = await checkSchemaVersionExists(credentialConfig.type, credentialConfig.version);
    if (!isValidVersion) {
      throw new Error(`Version not found for schema ${credentialConfig.type}`);
    }

    const content = await getSchemaContent(credentialConfig.type, credentialConfig.version);
    if (!content) {
      throw new Error(`Content in ${credentialConfig.type} schema not found`);
    }

    return JSON.parse(content);
  } catch (e) {
    const error = e as Error;
    return error?.message || 'Failed to load schema';
  }
};
