import { hasErrors } from './services/json-schema/validator.service.js';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service.js';
import {
  loadingConfigContentServices,
  loadingDataPath,
} from './services/loading-config-content/loadingConfigContent.service.js';
import { TestRunner } from './types/index.js';

/**
 * Process the test suite - Validate the data against the schema
 * @returns A promise that resolves to an array of error objects or null
 */
export const processTestRunner: TestRunner = async () => {
  const configContent = await loadingConfigContentServices();
  const loadingSchema = await Promise.all(
    configContent?.map(async (item) => {
      const schema = await dynamicLoadingSchemaService(item.type, item.version);
      const data = await loadingDataPath(item.dataPath);
      return {
        schema,
        data,
      };
    }),
  );

  if (!loadingSchema) {
    throw new Error(loadingSchema);
  }

  const compareResult = loadingSchema?.map((item) => {
    const result = hasErrors(item.schema, item.data);
    return result;
  });

  return compareResult;
};
