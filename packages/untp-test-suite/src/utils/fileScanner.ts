import { readdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Scans a directory for credential files (JSON files)
 * @param directoryPath - Path to the directory to scan
 * @param recursive - Whether to scan subdirectories recursively
 * @returns Array of file paths found in the directory
 */
export async function scanDirectoryForCredentials(directoryPath: string, recursive = false): Promise<string[]> {
  const credentialFiles: string[] = [];

  try {
    const entries = await readdir(directoryPath);

    for (const entry of entries) {
      const fullPath = join(directoryPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory() && recursive) {
        // Recursively scan subdirectories
        const subDirFiles = await scanDirectoryForCredentials(fullPath, recursive);
        credentialFiles.push(...subDirFiles);
      } else if (stats.isFile() && (await isCredentialFile(fullPath))) {
        credentialFiles.push(fullPath);
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to scan directory ${directoryPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  return credentialFiles.sort(); // Sort for consistent ordering
}

/**
 * Checks if a file is a valid credential file by examining its content
 * @param filePath - Path to the file to check
 * @returns True if the file is a valid VerifiableCredential
 */
async function isCredentialFile(filePath: string): Promise<boolean> {
  try {
    const { readFile } = await import('fs/promises');
    const fileContent = await readFile(filePath, 'utf-8');
    const jsonData = JSON.parse(fileContent);

    // Check if the file has a type property
    if (!jsonData.type && !jsonData['@type']) {
      return false;
    }

    // Get the type value (could be string or array)
    const typeValue = jsonData.type || jsonData['@type'];

    // Check if VerifiableCredential is in the type
    if (Array.isArray(typeValue)) {
      return typeValue.includes('VerifiableCredential');
    } else if (typeof typeValue === 'string') {
      return typeValue === 'VerifiableCredential';
    }

    return false;
  } catch (error) {
    // If we can't read or parse the file, it's not a valid credential
    return false;
  }
}

/**
 * Validates that a file path exists and is accessible
 * @param filePath - Path to the file to validate
 * @returns True if the file exists and is accessible
 */
export async function validateFilePath(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Filters an array of file paths to only include valid, accessible files
 * @param filePaths - Array of file paths to validate
 * @returns Array of valid file paths
 */
export async function filterValidFiles(filePaths: string[]): Promise<string[]> {
  const validFiles: string[] = [];

  for (const filePath of filePaths) {
    if (await validateFilePath(filePath)) {
      validFiles.push(filePath);
    }
  }

  return validFiles;
}

/**
 * Expands directory paths to include all credential files within them
 * @param paths - Array of file and directory paths
 * @param recursive - Whether to scan directories recursively
 * @returns Array of expanded file paths
 */
export async function expandDirectoryPaths(paths: string[], recursive = false): Promise<string[]> {
  const expandedPaths: string[] = [];

  for (const path of paths) {
    try {
      const stats = await stat(path);

      if (stats.isDirectory()) {
        const credentialFiles = await scanDirectoryForCredentials(path, recursive);
        expandedPaths.push(...credentialFiles);
      } else if (stats.isFile()) {
        expandedPaths.push(path);
      }
    } catch (error) {
      console.warn(
        `Warning: Could not process path ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return [...new Set(expandedPaths)]; // Remove duplicates
}
