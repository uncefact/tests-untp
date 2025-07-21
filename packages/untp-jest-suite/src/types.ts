/**
 * Type definitions for UNTP Jest Suite
 */

// Configuration for UNTP testing
export interface UNTPTestOptions {
  /** File paths of credentials to test */
  credentialPaths: string[];
  /** Additional test directories (for extensions) */
  extensionPaths?: string[];
}
