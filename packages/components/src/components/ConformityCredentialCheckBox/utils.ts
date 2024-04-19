export function getCaseInsensitive(obj: any, key: string) {
  return obj[Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase()) as string];
}
