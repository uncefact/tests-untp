import { IDynamicLoadingSchemaService } from './types.js';
import { checkSchemaExists, checkSchemaVersionExists, getSchemaContent } from './utils.js';

export const dynamicLoadingSchemaService: IDynamicLoadingSchemaService = async (schema, version) => {
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
};
