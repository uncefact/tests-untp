import { hasErrors } from './services';
import { dynamicLoadingSchemaService } from './services/dynamic-loading-schemas/loadingSchema.service';
import {
  loadingConfigContentServices,
  loadingDataPath,
} from './services/loading-config-content/loadingConfigContent.service';
import { TestRunner } from './types';

/**
 * Steps: (please remove when this function is implemented)
 * 1. Write a read config file function
 *   _ Check content of the file
 * 2. Check if the schema exists then load the schema
 * 3. Check if the schema version exists then load the schema version
 * 4. Check if the data path exists then load the data
 * 5. Call hasError function to compare the data and the schema
 * 6. If there is an error, throw an error, else return the result
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
    throw new Error(e);
  }
};
