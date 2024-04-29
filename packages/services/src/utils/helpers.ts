import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import JSONPointer from 'jsonpointer';

export function generateUUID() {
  return uuidv4();
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
 * Define the path to access the credential or the link to the credential within the API response
 * @param apiResp API response data
 * @param path Path to the credential or the link to the credential within the API response
 * @returns The credential or the link to the credential within the API response
 */
export const getStorageUrlByPath = (apiResp: any, path: string) => {
  if (_.isNil(path)) {
    throw new Error('Invalid result path');
  }

  return JSONPointer.get(apiResp, path);
};
