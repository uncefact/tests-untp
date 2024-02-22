import { v4 as uuidv4 } from 'uuid';

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
    if (Object.prototype.hasOwnProperty.call(obj[key], 'quantity')) {
      obj[key].quantity *= numberOfItems;
    }
  }
  return obj;
}
