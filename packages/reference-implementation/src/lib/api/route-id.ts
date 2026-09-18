export function containsNulByte(value: string): boolean {
  return value.includes('\0');
}
