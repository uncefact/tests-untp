/**
 * UNTP Test Utilities
 *
 * This module provides utilities specifically for use within UNTP tests,
 * such as credential parsing, validation helpers, and data extraction functions.
 */

import { UNTPCredentialType, UNTP_CREDENTIAL_TYPE_ABBREVIATIONS } from './types';

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
