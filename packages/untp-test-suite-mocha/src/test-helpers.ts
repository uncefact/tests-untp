/**
 * UNTP Test Helpers
 *
 * This module provides a clean interface for test files to access dependencies
 * without needing to handle environment detection (Node.js vs browser) themselves.
 */

/**
 * Set up UNTP test dependencies with environment detection abstracted away
 */
function setupUNTPTests() {
  // Handle chai dependency
  const { expect } = typeof window !== 'undefined' ? (window as any).chai : require('chai');

  // Handle credential state dependency
  const credentialState = typeof window !== 'undefined' ? window : require('../dist/credential-state');

  return {
    expect,
    credentialState,
  };
}

// Make setupUNTPTests available globally in both environments
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).setupUNTPTests = setupUNTPTests;
} else {
  // Node.js environment
  (global as any).setupUNTPTests = setupUNTPTests;
}

// Export for TypeScript/module users
export { setupUNTPTests };
