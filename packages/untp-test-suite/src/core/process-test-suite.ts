import { hasErrors } from './services';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service';
import {
  loadingConfigContentServices,
  loadingDataPath,
} from './services/loading-config-content/loadingConfigContent.service';
import { TestRunner } from './types';

/**
 * Process the test suite - Validate the data against the schema
 * @returns A promise that resolves to an array of error objects or null
 */
export const processTestRunner: TestRunner = async () => {
  try {
    const configContent = await loadingConfigContentServices();
    const loadingSchema = await Promise.all(
      configContent.map(async (item) => {
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

    const compareResult = loadingSchema.map((item) => {
      const result = hasErrors(item.schema, item.data);
      return result;
    });

    return compareResult;
  } catch (e) {
    const error = e as Error;
    throw new Error(error.message ?? 'Error processing test suite');
  }
};
