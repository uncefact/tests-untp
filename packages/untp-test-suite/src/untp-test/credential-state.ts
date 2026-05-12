/**
 * Shared credential state for UNTP tests
 *
 * This module provides a centrally managed credential data store that can be
 * accessed by all test files. The UNTPMochaRunner populates this data before
 * running tests, and test files can access it to validate uploaded credentials.
 */

/**
 * Internal map of credential file names to their content
 * Key: filename (e.g., "credential.json")
 * Value: file content as string
 */
let credentialData = new Map<string, string>();

/**
 * Set the credential data (called by UNTPMochaRunner)
 */
export function setCredentialData(data: Map<string, string>): void {
  credentialData = data;
}

/**
 * Check if any credentials are loaded
 */
export function hasCredentials(): boolean {
  return credentialData.size > 0;
}

/**
 * Get all credentials as an array of [filename, content] pairs
 */
export function getAllCredentials(): Array<[string, string]> {
  return Array.from(credentialData.entries());
}
