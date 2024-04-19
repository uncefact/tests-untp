/**
 * Get the value of a key in a case-insensitive way
 * @param obj
 * @param key The key to get the value of
 * @returns The value of the key
 */
export function getCaseInsensitive(obj: any, key: string) {
  return obj[Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase()) as string];
}
