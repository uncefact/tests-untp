/**
 * Type definitions for UNTP Test Suite Mocha
 */

// Configuration for UNTP testing
export interface UNTPTestOptions {
  /** File paths of credentials to test */
  credentialFilePaths: string[];
  /** Additional test directory (for extensions or other additional tests) */
  additionalTestsDir?: string;
}
