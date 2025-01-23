/**
 * This function is used to find the value of a key in a nested object.
 * Recursively searches for the target key.
 * @param data 
 * @param parameters targetKey: string
 * @returns any | undefined
 */

/**
// Example usage:
const nestedObject = {
  a: {
      b: {
          c: 42,
          d: "hello",
      },
      e: {
          f: {
              g: "world",
          },
      },
  },
  h: "test",
};

console.log(findFirstMatchingKeyValue(nestedObject, "c")); // Output: 42
console.log(findFirstMatchingKeyValue(nestedObject, "g")); // Output: "world"
console.log(findFirstMatchingKeyValue(nestedObject, "z")); // Output: undefined
*/

export function findFirstMatchingKeyValue(data: Record<string, any>, parameters: { targetKey: string } ): any | undefined {
  if (!data || !parameters?.targetKey) {
    return undefined;
  }

  for (const key in data) {
    if (key === parameters.targetKey) {
      return data[key];
    }

    if (typeof data[key] === "object" && data[key] !== null) {
      // Recursively search for the target key
      const result = findFirstMatchingKeyValue(data[key], { targetKey: parameters.targetKey });
      if (result !== undefined) {
          return result;
      }
    }
  }

  return undefined;
}