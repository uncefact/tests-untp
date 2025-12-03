/**
 * UNTP Test Module Exports
 *
 * This module provides clean exports for all UNTP test components.
 */

export * from './types';
export { UNTPTestRunner } from './validator';
export type { UNTPTestResults } from './validator';
export { StreamReporter } from './stream-reporter';
export type { StreamEvent } from './stream-reporter';
export { setCredentialData, hasCredentials, getAllCredentials } from './credential-state';
export {
  setupUNTPTests,
  registerUNTPTestSuite,
  executeRegisteredTestSuites,
  formatTags,
  showSuiteHierarchy,
  createAjvInstance,
  trustedDIDs,
} from './utils';
export { extractUNTPVersion, validateJSONLD, validateJsonAgainstSchema, setupUNTPChaiAssertions } from './test-utils';
