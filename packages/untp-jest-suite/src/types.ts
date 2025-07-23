/**
 * Type definitions for UNTP Test Suite Mocha
 */

// Configuration for UNTP testing
export interface UNTPTestOptions {
  /** File paths of credentials to test */
  credentialFilePaths: string[];
  /** Additional test directory (for extensions) */
  additionalTestsDir?: string;
  /** Tags to include (run only tests with these tags) */
  tags?: string[];
}
