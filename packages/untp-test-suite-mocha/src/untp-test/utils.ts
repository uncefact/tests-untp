/**
 * UNTP Test Helpers
 *
 * This module provides a clean interface for test files to access dependencies
 * without needing to handle environment detection (Node.js vs browser) themselves.
 */

import { getSchemaUrlForCredential } from './schema-mapper';
import { getUNTPCredentialType, getExtensionTypes} from './test-utils';
import { listAllProducts, getUnattestedIssuersForProduct } from './rdf-utils';
import { storeQuads, runInferences, createN3Store } from './n3-utils';

/**
 * Creates and configures an AJV instance for universal use with JSON Schema 2020-12 support
 * Assumes fetch is globally available (native in browser, set up in Node.js CLI)
 */
function createAjvInstance(): any {
  const Ajv = typeof window !== 'undefined' ? (window as any).ajv2020 : require('ajv/dist/2020');
  const addFormats = typeof window !== 'undefined' ? (window as any).AjvFormats : require('ajv-formats');

  // Schema cache to prevent repeated fetching
  const schemaCache = new Map<string, any>();

  const instance = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    schemaId: '$id',
    validateSchema: false, // Disable to prevent meta-schema validation issues
    loadSchema: async (uri: string) => {
      // Check if the URI is a meta-schema - these should be pre-loaded
      if (uri.startsWith('https://json-schema.org/draft/')) {
        return; // Let Ajv use the pre-loaded schema
      }

      // Check cache first
      if (schemaCache.has(uri)) {
        return schemaCache.get(uri);
      }

      try {
        const response = await fetch(uri);
        if (!response.ok) {
          throw new Error(`Failed to load schema from ${uri}: ${response.statusText}`);
        }
        const schema = await response.json();
        schemaCache.set(uri, schema);
        return schema;
      } catch (error) {
        console.error(`Error loading schema from ${uri}:`, error);
        throw error;
      }
    },
  });

  if (addFormats) {
    addFormats(instance);
  }

  // Note: Using ajv/dist/2020 provides built-in 2020-12 support including prefixItems
  // No need to manually add meta-schemas as they are included by default

  return instance;
}

// Storage for deferred test suite registration functions
const registeredTestSuites: Array<(credentialState: any) => void> = [];

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
function registerUNTPTestSuite(testSuiteFunction: (credentialState: any) => void): void {
  registeredTestSuites.push(testSuiteFunction);
}

/**
 * Execute all registered test suites
 * This should be called after credentials are loaded to register
 * all the describe blocks with Mocha. Since we use fresh Mocha instances,
 * no cleanup is needed - each instance starts clean.
 */
function executeRegisteredTestSuites(): void {
  console.log(`Executing ${registeredTestSuites.length} registered test suites.`);

  // Get credential state for passing to test suites
  const credentialState =
    typeof window !== 'undefined'
      ? {
          hasCredentials: () => (window as any).untpTestSuite.hasCredentials(),
          getAllCredentials: () => (window as any).untpTestSuite.getAllCredentials(),
          setCredentialData: (data: any) => (window as any).untpTestSuite.setCredentialData(data),
        }
      : require('./credential-state');

  // Execute all registered test suites with current credential state
  registeredTestSuites.forEach((testSuite) => testSuite(credentialState));

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

  // Handle ajv dependency for schema validation
  const ajv = typeof window !== 'undefined' ? (window as any).ajv : createAjvInstance();


  // Set up custom Chai assertions
  if (typeof window !== 'undefined') {
    // Browser environment - chai assertions are set up directly in browser bundle
    // No action needed here
  } else {
    // Node.js environment
    const { setupUNTPChaiAssertions } = require('./test-utils');
    setupUNTPChaiAssertions(chai, jsonld, ajv);
  }

  return {
    expect,
    registerUNTPTestSuite,
  };
}

const trustedDIDs: string[] = [];


// Make functions available under untpTestSuite namespace to avoid polluting globals
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).untpTestSuite = {
    setupUNTPTests,
    registerUNTPTestSuite,
    executeRegisteredTestSuites,
    formatTags,
    showSuiteHierarchy,
    getSchemaUrlForCredential,
    getUNTPCredentialType,
    getExtensionTypes,
    // n3store, // Removed global n3store
    storeQuads,
    trustedDIDs,
    listAllProducts,
    runInferences,
    getUnattestedIssuersForProduct,
    createN3Store,
    registeredTestSuites,
  };
} else {
  // Node.js environment
  (global as any).untpTestSuite = {
    setupUNTPTests,
    registerUNTPTestSuite,
    executeRegisteredTestSuites,
    formatTags,
    showSuiteHierarchy,
    getSchemaUrlForCredential,
    getUNTPCredentialType,
    getExtensionTypes,
    // n3store, // Removed global n3store
    storeQuads,
    trustedDIDs,
    listAllProducts,
    runInferences,
    getUnattestedIssuersForProduct,
    createN3Store
  };
}

// Export for TypeScript/module users
export {
  setupUNTPTests,
  registerUNTPTestSuite,
  executeRegisteredTestSuites,
  formatTags,
  showSuiteHierarchy,
  createAjvInstance,
  getSchemaUrlForCredential,
  getUNTPCredentialType,
  getExtensionTypes,
  // n3store, // Removed global n3store
  storeQuads,
  trustedDIDs,
  listAllProducts,
  runInferences,
  getUnattestedIssuersForProduct,
  createN3Store
};
