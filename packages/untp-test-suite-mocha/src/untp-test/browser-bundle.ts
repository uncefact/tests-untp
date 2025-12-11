/**
 * Browser Bundle Entry Point
 *
 * This file exports the UNTP Test Suite components for browser environments.
 * It makes UNTPMochaRunner and related classes available globally for the HTML test page.
 */

import { UNTPTestRunner } from './validator';
import { StreamReporter, StreamEvent } from './stream-reporter';
import { setCredentialData, hasCredentials, getAllCredentials } from './credential-state';
import { setupUNTPChaiAssertions, getUNTPCredentialType, getExtensionTypes } from './test-utils';
import { createAjvInstance } from './utils';
import { SchemaMappingsManager, getSchemaUrlForCredential } from './schema-mapper';
import './utils';
import './schema-mapper';

// Setup Mocha for BDD-style tests before any test suites are registered
(window as any).mocha.setup('bdd');

// Embed default schema mappings and schema definition for browser environment
import * as defaultMappings from './schema-mapper/default-mappings.json';
import * as schemaDefinition from './schema-mapper/schema-mappings.schema.json';
(window as any).untpDefaultSchemaMappings = defaultMappings;
(window as any).untpSchemaMappingsSchema = schemaDefinition;

// Set up AJV instance for browser using the same function as Node.js
const ajvInstance = createAjvInstance();
(window as any).ajv = ajvInstance;

// Set up Chai assertions directly in browser bundle
const chai = (window as any).chai;
const jsonld = (window as any).jsonld;

if (!chai) {
  throw new Error('Chai library not found. Ensure Chai script is loaded before the UNTP bundle.');
}

if (!jsonld) {
  throw new Error('JSON-LD library not found. Ensure JSON-LD script is loaded before the UNTP bundle.');
}

setupUNTPChaiAssertions(chai, jsonld, ajvInstance);

// Make classes and functions available under untpTestSuite namespace
(window as any).untpTestSuite = {
  ...((window as any).untpTestSuite || {}), // Preserve existing namespace from utils
  UNTPTestRunner,
  StreamReporter,
  setCredentialData,
  hasCredentials,
  getAllCredentials,
  setupUNTPChaiAssertions,
  getUNTPCredentialType,
  getExtensionTypes,
  SchemaMappingsManager,
  getSchemaUrlForCredential,
};

// Load all UNTP test files to register them with registerUNTPTestSuite after setup is complete
// The actual test suites will be executed after credentials are loaded
import '../generated/test-file-list';

// Export types for TypeScript users
export type { StreamEvent };
export {
  UNTPTestRunner,
  StreamReporter,
  setCredentialData,
  hasCredentials,
  getAllCredentials,
  setupUNTPChaiAssertions,
  getUNTPCredentialType,
  getExtensionTypes,
  SchemaMappingsManager,
  getSchemaUrlForCredential,
};

console.log('UNTP Test Suite browser bundle loaded');
