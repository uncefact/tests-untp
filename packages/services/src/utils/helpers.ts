import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import JSONPointer from 'jsonpointer';
import { generateIdWithSerialNumber, generateIdWithBatchLot } from '../epcisEvents/helpers.js';

export function generateUUID() {
  return uuidv4();
}

export function generateCurrentDatetime() {
  return new Date().toISOString();
}

/**
 * @returns a random integer with number of digits specified by numberDigits
 * @example
 *  randomIntegerString(5) returns a random integer with 5 digits:
 *     12345
 *     00000
 *     00001
 */
export function randomIntegerString(numberDigits: number) {
  return Math.floor(Math.random() * 10 ** numberDigits)
    .toString()
    .padStart(numberDigits, '0');
}

/**
 * Fill the array with the last value until it reaches the length of the first array
 * @param value1
 * @param value2
 * @returns the second array filled with the last value until it reaches the length of the first array
 */
export function fillArray(value1: any[], value2: any[]) {
  while (value2?.length < value1?.length) {
    value2.push(value2[value2.length - 1]);
  }

  return value2;
}

/**
 * Increment the quantity of the object
 * @param obj - object with quantity
 * @param numberOfItems - number of items
 * @returns object with the quantity incremented, if the object has a quantity
 */
export function incrementQuality(obj: any, numberOfItems: number) {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && key === 'quantity') {
      obj[key] *= numberOfItems;
    }
  }
  return obj;
}

/**
 * Define the path to access the value in the nested object
 * @param data
 * @param path path to the value in the nested object
 * @returns the value in the nested object
 */
export const getValueByPath = (data: any, path: string) => {
  if (_.isNil(path)) {
    throw new Error('Invalid result path');
  }

  return JSONPointer.get(data, path);
};

export interface IConstructObjectParameters {
  mappingFields?: { sourcePath: string; destinationPath: string }[];
  dummyFields?: { path: string; data: any }[];
  generationFields?: {
    path: string;
    handler: string;
    dependencies?: string[];
    parameters?: any[];
  }[];
}

export const genericHandlerFunctions = {
  generateUUID,
  generateCurrentDatetime,
  generateIdWithSerialNumber,
  generateIdWithBatchLot,
};

export interface ICurrentAndDependencies {
  currentData?: any;
  dependenciesValues?: any[];
}

export const allowedIndexKeys = ['i', 'index'];
/**
 * Constructs an object by mapping fields from a source object to a destination object and set the dummy fields.
 * @param data - The destination object to construct.
 * @param source - The source object to extract values from.
 * @param index - The index used for constructing nested paths.
 * @param parameters - Additional parameters for field mapping.
 * @returns The constructed object.
 */
export const constructObject = (
  data: any,
  source: any,
  parameters: IConstructObjectParameters,
  index?: number,
  options?: { handlers: any },
): { [k: string]: any } => {
  // Mappping fields from source to destination
  if (parameters.mappingFields && parameters.mappingFields.length > 0) {
    for (const { sourcePath, destinationPath } of parameters.mappingFields) {
      const sourceIndex = sourcePath.split('/').findIndex((key) => allowedIndexKeys.includes(key));
      const destinationIndex = destinationPath.split('/').findIndex((key) => allowedIndexKeys.includes(key));
      // If the source path does not contain an index, it means it is a direct mapping
      if ((destinationIndex === -1 && sourceIndex === -1) || index === undefined) {
        const sourceValue = JSONPointer.get(source, sourcePath);
        JSONPointer.set(data, destinationPath, sourceValue);
      }
      // If the source path contains an index, it means it map one source data to multiple destination data with the same value
      else if (sourceIndex === -1) {
        const headDestinationPath = destinationPath.split('/').slice(0, destinationIndex).join('/');
        const tailDestinationPath = destinationPath
          .split('/')
          .slice(destinationIndex + 1)
          .join('/');

        const sourceValue = JSONPointer.get(source, sourcePath);
        JSONPointer.set(data, `${headDestinationPath}/${index}/${tailDestinationPath}`, sourceValue);
      }
      // If the destination path contains an index, it means it map multiple source data to one destination data
      else if (destinationIndex === -1) {
        const headSourcePath = sourcePath.split('/').slice(0, sourceIndex).join('/');
        const tailSourcePath = sourcePath
          .split('/')
          .slice(sourceIndex + 1)
          .join('/');

        const sourceValue = JSONPointer.get(source, `${headSourcePath}/${index}/${tailSourcePath}`);
        const destinationValue = JSONPointer.get(data, destinationPath) || [];
        JSONPointer.set(data, destinationPath, [...destinationValue, sourceValue]);
      }
      // If both source path and destination path contain an index, it means it map multiple source data to multiple destination data with the same index
      else {
        const headSourcePath = sourcePath.split('/').slice(0, sourceIndex).join('/');
        const tailSourcePath = sourcePath
          .split('/')
          .slice(sourceIndex + 1)
          .join('/');

        const headDestinationPath = destinationPath.split('/').slice(0, destinationIndex).join('/');
        const tailDestinationPath = destinationPath
          .split('/')
          .slice(destinationIndex + 1)
          .join('/');

        const sourceArray = JSONPointer.get(source, headSourcePath);
        if (!Array.isArray(sourceArray)) {
          throw new Error('Invalid configuration for mapping fields');
        }

        let lastExistingDestinationIndex;
        const destinationArray = JSONPointer.get(data, headDestinationPath);
        if (!Array.isArray(destinationArray)) {
          lastExistingDestinationIndex = 0;
        } else {
          lastExistingDestinationIndex = destinationArray.findIndex(
            (value) => JSONPointer.get(value, `/${tailDestinationPath}`) !== undefined,
          );

          if (lastExistingDestinationIndex === -1) {
            lastExistingDestinationIndex = 0;
          } else {
            lastExistingDestinationIndex += 1;
          }
        }

        for (const [idx, sourceObjectValue] of sourceArray.entries()) {
          const sourceValue = JSONPointer.get(sourceObjectValue, `/${tailSourcePath}`);
          JSONPointer.set(
            data,
            `${headDestinationPath}/${lastExistingDestinationIndex + idx}/${tailDestinationPath}`,
            sourceValue,
          );
        }
      }
    }
  }

  // Set dummy fields
  if (parameters.dummyFields && parameters.dummyFields.length > 0) {
    for (const { path, data: dummyData } of parameters.dummyFields) {
      JSONPointer.set(data, path, dummyData);
    }
  }

  // Generate fields
  if (parameters.generationFields && parameters.generationFields.length > 0) {
    for (const {
      path,
      handler,
      dependencies = [],
      parameters: handlerParameters = [],
    } of parameters.generationFields) {
      const handlerFunction: any = options?.handlers?.[handler];
      if (!handlerFunction) {
        throw new Error(`Handler function ${handler} not found`);
      }
      const dependenciesIndexes = dependencies.map((dependency) =>
        dependency.split('/').findIndex((key) => allowedIndexKeys.includes(key)),
      );
      const pathIndex = path.split('/').findIndex((key) => allowedIndexKeys.includes(key));
      if (pathIndex === -1 || index === undefined) {
        const dependenciesValues = dependencies.map((dependency) => JSONPointer.get(data, dependency));
        const currentData = JSONPointer.get(data, path);

        const params = [{ currentData, dependenciesValues }, ...handlerParameters];
        const generatedValue = handlerFunction(...params);
        JSONPointer.set(data, path, generatedValue);
      } else {
        const headPath = path.split('/').slice(0, pathIndex).join('/');
        const tailPath = path
          .split('/')
          .slice(pathIndex + 1)
          .join('/');

        const sourceArray = JSONPointer.get(data, headPath);
        if (!Array.isArray(sourceArray)) {
          throw new Error('Invalid configuration for generation fields');
        }

        for (const [idx, currentObjectValue] of sourceArray.entries()) {
          const dependenciesValues = dependenciesIndexes.map((dependencyIndex, i) => {
            if (dependencyIndex === -1) {
              return JSONPointer.get(data, dependencies[i]);
            } else {
              const headDependencyPath = dependencies[i].split('/').slice(0, dependencyIndex).join('/');
              const tailDependencyPath = dependencies[i]
                .split('/')
                .slice(dependencyIndex + 1)
                .join('/');
              const dependencyArray = JSONPointer.get(data, headDependencyPath);
              if (!Array.isArray(dependencyArray)) {
                throw new Error('Invalid configuration for generation fields');
              }
              return JSONPointer.get(dependencyArray[idx], `/${tailDependencyPath}`);
            }
          });
          const currentData = JSONPointer.get(currentObjectValue, `/${tailPath}`);
          const params = [{ currentData, dependenciesValues }, ...handlerParameters];
          const generatedValue = handlerFunction(...params);
          JSONPointer.set(data, `${headPath}/${idx}/${tailPath}`, generatedValue);
        }
      }
    }
  }

  return data;
};
