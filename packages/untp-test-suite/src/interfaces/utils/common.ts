import { readFile } from 'fs/promises';

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const fileJson = await readFile(filePath, { encoding: 'utf-8' });
    const file = JSON.parse(fileJson);

    return file;
  } catch (error) {
    return null;
  }
}