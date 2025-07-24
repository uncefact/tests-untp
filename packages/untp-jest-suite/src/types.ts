/**
 * Type definitions for UNTP Test Suite Mocha
 */

// Configuration for UNTP testing
export interface UNTPTestOptions {
  /** Tags to include (run only tests with these tags) */
  tags?: string[];
  /** Callback to create and configure Mocha instance */
  mochaSetupCallback: (mochaOptions: any) => any;
}
