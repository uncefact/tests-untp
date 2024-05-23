import { IImportedData } from './types/types.js';
import { createNestedObject } from './utils/helpers.js';

/**
 * Maps imported data to the required fields based on the provided parameters.
 * @param importedData - The array of imported data.
 * @param parameters - The parameters object containing the required fields.
 * @returns The mapped data object.
 * @throws Error if importedData or requiredFields are missing.
 */
export const mappingImportedData = (importedData: IImportedData[], parameters: any) => {
  if (!importedData?.length || !parameters?.requiredFields) {
    throw new Error('Import data or required fields are missing');
  }
  
  const identifiers = importedData.map((item) => item.label);
  const mappedData = {
    data: createNestedObject(parameters.requiredFields, identifiers)
  }

  return mappedData;
};
