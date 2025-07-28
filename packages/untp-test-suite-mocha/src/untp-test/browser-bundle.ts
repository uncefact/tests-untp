/**
 * Browser Bundle Entry Point
 *
 * This file exports the UNTP Test Suite components for browser environments.
 * It makes UNTPMochaRunner and related classes available globally for the HTML test page.
 */

import { UNTPTestRunner } from './validator';
import { StreamReporter, StreamEvent } from './stream-reporter';
import { setCredentialData, hasCredentials, getAllCredentials } from './credential-state';
import { setupUNTPChaiAssertions } from './test-utils';
import './utils';

// Import test files to register them with registerUNTPTestSuite
// The actual test suites will be executed after credentials are loaded
import '../../untp-tests/tier1.test.js';

// Make classes and functions available under untpTestSuite namespace
(window as any).untpTestSuite = {
  ...(window as any).untpTestSuite, // Preserve existing namespace from test-helpers
  UNTPTestRunner,
  StreamReporter,
  setCredentialData,
  hasCredentials,
  getAllCredentials,
  setupUNTPChaiAssertions,
};

// Export types for TypeScript users
export {
  UNTPTestRunner,
  StreamReporter,
  StreamEvent,
  setCredentialData,
  hasCredentials,
  getAllCredentials,
  setupUNTPChaiAssertions,
};

console.log('UNTP Test Suite browser bundle loaded');
