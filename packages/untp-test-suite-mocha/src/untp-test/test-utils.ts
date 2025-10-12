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
          let message = `${ajvError.instancePath} ${ajvError.message}`;

          // For const validation errors, show expected vs actual values
          // We will probably want to detect different keywords here and include
          // more user-friendly messages generally as we discover them. We can
          // also update the data format of the errors if we want to pass more
          // structured info.
          if (ajvError.keyword === 'const' && ajvError.params?.allowedValue && ajvError.data) {
            message += `\n        Expected: ${ajvError.params.allowedValue}\n        Actual: ${ajvError.data}`;
          }

          result.errors.push({
            code: 'SCHEMA_VALIDATION_ERROR',
            message,
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

    // Extract more detailed error information
    let detailedMessage = 'Invalid JSON-LD format';
    let errorCode = 'INVALID_JSONLD';

    if (error instanceof Error) {
      // Check for common JSON-LD error types and extract key information
      if (error.message.includes('loading document failed')) {
        errorCode = 'JSONLD_DOCUMENT_LOAD_ERROR';
        detailedMessage = `Failed to load JSON-LD context: ${error.message}`;
      } else if (error.message.includes('invalid @context')) {
        errorCode = 'JSONLD_INVALID_CONTEXT';
        detailedMessage = `Invalid @context in JSON-LD document: ${error.message}`;
      } else if (error.message.includes('syntax error')) {
        errorCode = 'JSONLD_SYNTAX_ERROR';
        detailedMessage = `JSON-LD syntax error: ${error.message}`;
      } else if (error.message.includes('fetch')) {
        errorCode = 'JSONLD_CONTEXT_FETCH_ERROR';
        detailedMessage = `Could not fetch JSON-LD context from URL: ${error.message}`;
      } else if (error.message.includes('Dereferencing a URL did not result in a valid JSON-LD object')) {
        // Extract URL from the long error message
        const urlMatch = error.message.match(/URL: "([^"]+)"/);
        const failedUrl = urlMatch ? urlMatch[1] : 'unknown URL';
        errorCode = 'JSONLD_CONTEXT_DEREFERENCE_ERROR';
        detailedMessage = `Failed to load JSON-LD context from ${failedUrl} (URL not accessible or invalid JSON-LD)`;
      } else {
        detailedMessage = `JSON-LD processing error: ${error.message}`;
      }
    } else {
      detailedMessage = `JSON-LD validation failed: ${String(error)}`;
    }

    result.errors.push({
      code: errorCode,
      message: detailedMessage,
      error: error, // Always include the actual error object for debugging
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
    return validateJSONLD(obj, jsonld).then((result) => {
      this.assert(
        result.valid,
        `JSON-LD document validation failed: ${result.errors.map((e) => e.message).join(', ')}`,
        `expected credential not to be a valid JSON-LD document`,
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

      // Return a promise-based assertion
      return validateJsonAgainstSchema(obj, schemaUrl, ajv)
        .then((result) => {
          if (result.valid) {
            this.assert(true, '', '', true, true);
          } else {
            // Format errors for better readability
            const formattedErrors = result.errors.map((e) => `      - ${e.message}`).join('\n');

            this.assert(
              false,
              `Schema validation failed:\n${formattedErrors}`,
              `expected credential not to match schema`,
              true,
              false,
            );
          }
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

/**
 * Gets the UNTP credential type from a parsed credential
 * @param credential - The credential object
 * @returns The UNTPCredentialType enum value or undefined if not a recognized UNTP type
 */
export function getUNTPCredentialType(credential: any): UNTPCredentialType | undefined {
  if (!credential.type || !Array.isArray(credential.type)) {
    return undefined;
  }

  // Get all possible credential types from the enum
  const credentialTypes = Object.values(UNTPCredentialType);

  // Find the first matching credential type in the credential's type array
  for (const type of credential.type) {
    if (credentialTypes.includes(type as UNTPCredentialType)) {
      return type as UNTPCredentialType;
    }
  }

  return undefined;
}

/**
 * Gets extension types from a credential (types that precede the UNTP credential type)
 * @param credential - The credential object
 * @returns Array of extension type strings, or empty array if none found
 */
export function getExtensionTypes(credential: any): string[] {
  if (!credential.type || !Array.isArray(credential.type)) {
    return [];
  }

  // Get all possible UNTP credential types from the enum
  const untpCredentialTypes = Object.values(UNTPCredentialType);

  // Find the index of the first UNTP credential type
  const untpTypeIndex = credential.type.findIndex((type: string) =>
    untpCredentialTypes.includes(type as UNTPCredentialType),
  );

  // If no UNTP type found, return empty array
  if (untpTypeIndex === -1) {
    return [];
  }

  // Return all types before the UNTP credential type
  return credential.type.slice(0, untpTypeIndex);
}
