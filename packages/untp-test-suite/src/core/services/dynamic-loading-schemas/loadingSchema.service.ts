import { IDynamicLoadingSchemaService } from './types';
import { checkSchemaExists, checkSchemaVersionExists, getSchemaContent } from './utils';

export const dynamicLoadingSchemaService: IDynamicLoadingSchemaService = async (schema, version) => {
  try {
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
    throw new Error(error.message ?? 'Error loading schema');
  }
};
