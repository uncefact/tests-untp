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

// Utility function to truncate strings
export const truncateString = (str: string | undefined, maxLength: number) => {
  if (!str) return '';

  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength) + '...';
};

// Function to generate a clickable URL in terminal
export const createClickableUrl = (fullUrl: string, displayText: string) => {
  if (!fullUrl) return '';
  const fixedUrl = fullUrl.replace('&#x3D;', '=');
  return `\u001b]8;;${fixedUrl}\u0007${displayText}\u001b]8;;\u0007`;
};
