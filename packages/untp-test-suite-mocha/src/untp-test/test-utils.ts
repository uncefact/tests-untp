/**
 * UNTP Test Utilities
 *
 * This module provides utilities specifically for use within UNTP tests,
 * such as credential parsing, validation helpers, and data extraction functions.
 */

import { UNTPCredentialType, UNTP_CREDENTIAL_TYPE_ABBREVIATIONS } from './types';

/**
 * Creates and configures an AJV instance for universal use with JSON Schema 2020-12 support
 * Assumes fetch is globally available (native in browser, set up in Node.js CLI)
 */
export function createAjvInstance(): any {
  const Ajv = typeof window !== 'undefined' ? (window as any).ajv2020 : require('ajv');
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

  // Add meta-schemas for different JSON Schema drafts
  try {
    // Only add meta-schemas in Node.js environment where we can require them
    if (typeof window === 'undefined') {
      // Try to add 2020-12 meta-schemas if available
      try {
        const draft2020Schema = require('ajv/dist/refs/json-schema-2020-12/schema.json');
        const metaCore = require('ajv/dist/refs/json-schema-2020-12/meta/core.json');
        const metaApplicator = require('ajv/dist/refs/json-schema-2020-12/meta/applicator.json');
        const metaValidation = require('ajv/dist/refs/json-schema-2020-12/meta/validation.json');
        const metaMetaData = require('ajv/dist/refs/json-schema-2020-12/meta/meta-data.json');
        const metaFormat = require('ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json');
        const metaContent = require('ajv/dist/refs/json-schema-2020-12/meta/content.json');
        const metaUnevaluated = require('ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json');

        if (!instance.getSchema('https://json-schema.org/draft/2020-12/schema')) {
          instance.addMetaSchema(draft2020Schema);
          instance.addMetaSchema(metaCore);
          instance.addMetaSchema(metaApplicator);
          instance.addMetaSchema(metaValidation);
          instance.addMetaSchema(metaMetaData);
          instance.addMetaSchema(metaFormat);
          instance.addMetaSchema(metaContent);
          instance.addMetaSchema(metaUnevaluated);
        }
      } catch (metaError) {
        console.warn('Could not load JSON Schema 2020-12 meta-schemas:', metaError);
      }

      // Try to add other draft meta-schemas
      try {
        const draft2019Schema = require('ajv/dist/refs/json-schema-2019-09/schema.json');
        const draft7Schema = require('ajv/dist/refs/json-schema-draft-07.json');

        if (!instance.getSchema('https://json-schema.org/draft/2019-09/schema')) {
          instance.addMetaSchema(draft2019Schema);
        }
        if (!instance.getSchema('http://json-schema.org/draft-07/schema')) {
          instance.addMetaSchema(draft7Schema);
        }
      } catch (draftError) {
        console.warn('Could not load additional JSON Schema drafts:', draftError);
      }
    }
  } catch (error) {
    console.warn('Error setting up meta-schemas:', error);
  }

  return instance;
}

/**
 * Validates a JSON object against a JSON schema
 * @param jsonData - The JSON object to validate
 * @param schemaUrl - URL of the JSON schema to validate against
 * @param ajv - The AJV instance from setupUNTPTests
 * @returns Promise<ValidationResult> with schema validation results
 */
export async function validateJsonAgainstSchema(
  jsonData: any,
  schemaUrl: string,
  ajv: any,
): Promise<{ valid: boolean; errors: Array<{ code: string; message: string; path?: string }> }> {
  const result = {
    valid: true,
    errors: [] as Array<{ code: string; message: string; path?: string }>,
  };

  try {
    const validate = await ajv.compileAsync({ $ref: schemaUrl });

    const isValid = validate(jsonData);

    if (isValid) {
      return result;
    } else {
      result.valid = false;

      if (validate.errors) {
        for (const ajvError of validate.errors) {
          result.errors.push({
            code: 'SCHEMA_VALIDATION_ERROR',
            message: `${ajvError.instancePath} ${ajvError.message}`,
            path: ajvError.instancePath,
          });
        }
      } else {
        result.errors.push({
          code: 'SCHEMA_VALIDATION_ERROR',
          message: 'Schema validation failed without specific errors',
        });
      }
    }
  } catch (error) {
    result.valid = false;
    result.errors.push({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: `Failed to validate against schema: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return result;
}

/**
 * Validates if a parsed JSON object is valid JSON-LD
 * @param credential - Object to validate as JSON-LD
 * @param jsonld - The jsonld library instance
 * @returns Promise<ValidationResult> with JSON-LD validation results
 */
export async function validateJSONLD(
  credential: any,
  jsonld: any,
): Promise<{ valid: boolean; errors: Array<{ code: string; message: string; error?: any }> }> {
  const result = {
    valid: true,
    errors: [] as Array<{ code: string; message: string; error?: any }>,
  };

  try {
    // Configure options for jsonld.expand
    const expandOptions: any = {
      safe: true, // Use safe mode to avoid code execution in JSON-LD scripts
    };

    // Try to expand the JSON-LD document
    await jsonld.expand(credential, expandOptions);
  } catch (error) {
    result.valid = false;
    result.errors.push({
      code: 'INVALID_JSONLD',
      message: 'Invalid JSON-LD format',
      error: error, // Always include the actual error object
    });
  }

  return result;
}

/**
 * Sets up custom Chai assertions for UNTP testing
 * Should be called once to extend Chai with UNTP-specific matchers
 */
export function setupUNTPChaiAssertions(chai: any, jsonld: any, ajv: any): void {
  const { Assertion } = chai;

  // Add validJSONLDDocument assertion
  Assertion.addProperty('validJSONLDDocument', function (this: any) {
    const obj = this._obj;

    // Return a promise-based assertion
    const assertion = this;

    return validateJSONLD(obj, jsonld).then((result) => {
      assertion.assert(
        result.valid,
        `expected #{this} to be a valid JSON-LD document but got errors: ${result.errors
          .map((e) => e.message)
          .join(', ')}`,
        `expected #{this} not to be a valid JSON-LD document`,
        true,
        result.valid,
      );
    });
  });

  // Add 'match' property to enable chaining
  Assertion.addProperty('match', function (this: any) {
    return this;
  });

  // Add schema matching assertion
  Assertion.addChainableMethod(
    'schema',
    function (this: any, schemaUrl: string) {
      const obj = this._obj;
      const assertion = this;

      return validateJsonAgainstSchema(obj, schemaUrl, ajv)
        .then((result) => {
          assertion.assert(
            result.valid,
            `expected #{this} to match schema ${schemaUrl} but got errors: ${result.errors
              .map((e) => e.message)
              .join(', ')}`,
            `expected #{this} not to match schema ${schemaUrl}`,
            true,
            result.valid,
          );
        })
        .catch((error) => {
          // Handle any errors in schema validation
          throw new Error(`Schema validation failed: ${error.message}`);
        });
    },
    function (this: any) {
      // Chain function - enables the chaining syntax
      return this;
    },
  );
}

/**
 * Extracts the UNTP version from a credential's context for any UNTP credential type
 * @param credential - The credential object
 * @returns The extracted version or null if not found
 */
export function extractUNTPVersion(credential: any): string | null {
  if (!credential['@context'] || !Array.isArray(credential['@context'])) {
    return null;
  }

  // Create regex patterns for all UNTP credential types
  const abbreviations = Object.values(UNTP_CREDENTIAL_TYPE_ABBREVIATIONS);
  const untpContextRegex = new RegExp(
    `https://test\\.uncefact\\.org/vocabulary/untp/(${abbreviations.join('|')})/([^/]+)/`,
  );

  for (const contextUrl of credential['@context']) {
    if (typeof contextUrl === 'string') {
      const match = contextUrl.match(untpContextRegex);
      if (match && match[2]) {
        return match[2]; // Return the captured version (second capture group)
      }
    }
  }

  return null;
}
