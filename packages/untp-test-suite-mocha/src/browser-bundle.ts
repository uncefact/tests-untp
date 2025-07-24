/**
 * Browser Bundle Entry Point
 *
 * This file exports the UNTP Test Suite components for browser environments.
 * It makes UNTPMochaRunner and related classes available globally for the HTML test page.
 */

import { UNTPTestRunner } from './validator';
import { StreamReporter, StreamEvent } from './stream-reporter';
import { setCredentialData, hasCredentials, getAllCredentials } from './credential-state';
import './test-helpers';

// Import test files explicitly so esbuild includes them in the bundle
// Note: These are JavaScript files that will be executed when the bundle loads
import '../untp-tests/tier1/dummy.test.js';

// Make classes and functions available globally for browser
(window as any).UNTPTestRunner = UNTPTestRunner;
(window as any).StreamReporter = StreamReporter;
(window as any).setCredentialData = setCredentialData;
(window as any).hasCredentials = hasCredentials;
(window as any).getAllCredentials = getAllCredentials;

// Export types for TypeScript users
export { UNTPTestRunner, StreamReporter, StreamEvent, setCredentialData, hasCredentials, getAllCredentials };
export * from './types';

console.log('UNTP Test Suite browser bundle loaded');
