import * as schemas from '../../../schemas';
import { IDynamicLoadingSchemaService } from './types';

export const dynamicLoadingSchemaService: IDynamicLoadingSchemaService = async (schema, version) => {
  try {
    const isValidSchema = schema && (await schemas.getSchemasName()).includes(schema);

    if (!isValidSchema) {
      throw new Error(`Schema not found`);
    }

    const isValidVersion = version && (await schemas.getSchemasVersion())[schema].version.includes(version);
    if (!isValidVersion) {
      throw new Error(`Version not found for schema ${schema}`);
    }

    const content = await schemas.getContentSchema(schema, version);
    if (!content) {
      throw new Error(`Content in ${schema} schema not found`);
    }

    return content;
  } catch (e) {
    const error = e as Error;
    throw new Error(error.message ?? 'Error loading schema');
  }
};
