/**
 * UNTP Test Helpers
 *
 * This module provides a clean interface for test files to access dependencies
 * without needing to handle environment detection (Node.js vs browser) themselves.
 */

// Storage for deferred test suite registration functions
const registeredTestSuites: Array<() => void> = [];

/**
 * Extract and format tags from a title
 */
function formatTags(title: string): { cleanTitle: string; tags: string } {
  const tagMatches = title.match(/( tag:[^ ]+)+/g);
  if (!tagMatches) {
    return { cleanTitle: title, tags: '' };
  }

  const tags = tagMatches[0]
    .split(' ')
    .filter((t) => t.startsWith('tag:'))
    .map((t) => t.replace('tag:', ''));
  const cleanTitle = title.replace(/( tag:[^ ]+)+/g, '').trim();

  // Format tags with simple 'tags:' prefix and comma separation
  const formattedTags = tags.join(', ');

  return { cleanTitle, tags: formattedTags ? ` (tags: ${formattedTags})` : '' };
}

/**
 * Show suite hierarchy using Mocha's structured suite information
 * Uses a callback to handle environment-specific output
 */
function showSuiteHierarchy(
  suiteHierarchy: string[],
  displayedSuites: Set<string>,
  outputCallback: (suiteTitle: string, cleanTitle: string, tags: string, indentLevel: number) => void,
): void {
  // Display each suite level that hasn't been shown yet
  suiteHierarchy.forEach((suiteTitle, index) => {
    // Build cumulative path for uniqueness check
    const suitePath = suiteHierarchy.slice(0, index + 1).join(' > ');

    if (!displayedSuites.has(suitePath)) {
      displayedSuites.add(suitePath);

      const { cleanTitle, tags } = formatTags(suiteTitle);
      outputCallback(suiteTitle, cleanTitle, tags, index);
    }
  });
}

/**
 * Register a test suite function to be executed later
 * This allows test files to defer their describe block registration
 * until after credentials are loaded and available
 */
function registerUNTPTestSuite(testSuiteFunction: () => void): void {
  registeredTestSuites.push(testSuiteFunction);
}

/**
 * Execute all registered test suites
 * This should be called after credentials are loaded to register
 * all the describe blocks with Mocha. Since we use fresh Mocha instances,
 * no cleanup is needed - each instance starts clean.
 */
function executeRegisteredTestSuites(): void {
  // Execute all registered test suites with current credential state
  registeredTestSuites.forEach((testSuite) => testSuite());

  // Keep registered test suites for potential re-execution
}

/**
 * Set up UNTP test dependencies with environment detection abstracted away
 */
function setupUNTPTests() {
  // Handle chai dependency
  const chai = typeof window !== 'undefined' ? (window as any).chai : require('chai');
  const { expect } = chai;

  // Handle jsonld dependency
  const jsonld = typeof window !== 'undefined' ? (window as any).jsonld : require('jsonld');

  // Set up custom UNTP Chai assertions
  const { setupUNTPChaiAssertions } =
    typeof window !== 'undefined' ? (window as any).untpTestSuite : require('./test-utils');

  setupUNTPChaiAssertions(chai, jsonld);

  // Handle credential state dependency
  const credentialState =
    typeof window !== 'undefined'
      ? {
          hasCredentials: () => (window as any).untpTestSuite.hasCredentials(),
          getAllCredentials: () => (window as any).untpTestSuite.getAllCredentials(),
          setCredentialData: (data: any) => (window as any).untpTestSuite.setCredentialData(data),
        }
      : require('./credential-state');

  return {
    expect,
    jsonld,
    credentialState,
    registerUNTPTestSuite,
    executeRegisteredTestSuites,
    formatTags,
    showSuiteHierarchy,
  };
}

// Make functions available under untpTestSuite namespace to avoid polluting globals
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).untpTestSuite = {
    setupUNTPTests,
    registerUNTPTestSuite,
    executeRegisteredTestSuites,
    formatTags,
    showSuiteHierarchy,
  };
} else {
  // Node.js environment
  (global as any).untpTestSuite = {
    setupUNTPTests,
    registerUNTPTestSuite,
    executeRegisteredTestSuites,
    formatTags,
    showSuiteHierarchy,
  };
}

// Export for TypeScript/module users
export { setupUNTPTests, registerUNTPTestSuite, executeRegisteredTestSuites, formatTags, showSuiteHierarchy };
