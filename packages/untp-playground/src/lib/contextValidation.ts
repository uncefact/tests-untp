import jsonld from 'jsonld';

interface ValidationResult {
  valid: boolean;
  data?: Record<string, any>;
  error?: {
    keyword: string;
    message: string;
    instancePath: string;
    [key: string]: any;
  };
}

interface ValidationError {
  valid: boolean;
  errorMessage?: string;
  [key: string]: any;
}

export async function validateContext(credential: Record<string, any>): Promise<ValidationResult> {
  try {
    const validateRequiredFieldsResult = validateRequiredFields(credential);
    if (!validateRequiredFieldsResult.valid) {
      return {
        valid: false,
        error: {
          keyword: 'required',
          message: validateRequiredFieldsResult.errorMessage!,
          instancePath: '',
          params: { missingProperty: '@context' },
        },
      };
    }

    // Expand the credential to validate the context
    const expanded = await jsonld.expand(credential, { safe: true } as jsonld.Options.Expand);

    return { valid: true, data: expanded };
  } catch (error: any) {
    console.log('Expand JSON-LD error:', error);

    try {
      const checkSyntaxErrorResult = checkSyntaxError(error);
      if (!checkSyntaxErrorResult.valid) {
        return {
          valid: false,
          error: {
            keyword: checkSyntaxErrorResult.keyword,
            message: checkSyntaxErrorResult.errorMessage as string,
            instancePath: '@context',
            params: {
              conflictingProperty: checkSyntaxErrorResult.term,
            },
          },
        };
      }

      const checkInvalidContextResult = checkInvalidContext(error);
      if (!checkInvalidContextResult.valid) {
        return {
          valid: false,
          error: {
            keyword: 'const',
            message: checkInvalidContextResult.errorMessage as string,
            instancePath: '@context',
          },
        };
      }

      const checkInvalidPropertiesResult = await checkInvalidProperties(error, credential);
      if (!checkInvalidPropertiesResult.valid) {
        return {
          valid: false,
          error: {
            keyword: 'const',
            message: checkInvalidPropertiesResult.errorMessage as string,
            instancePath: checkInvalidPropertiesResult.invalidValues as string,
          },
        };
      }
    } catch (error) {
      console.log('Context validation error:', error);
    }

    return {
      valid: false,
      error: {
        keyword: 'unknown',
        message: 'Failed to validate context in credential',
        instancePath: '',
      },
    };
  }
}

export function validateRequiredFields(credential: Record<string, any>): ValidationError {
  // Check if the credential is a JSON object
  if (typeof credential !== 'object' || credential === null) {
    return { valid: false, errorMessage: 'Invalid JSON-LD document: must be a JSON object' };
  }

  // Check if the credential has a context property
  if (!('@context' in credential)) {
    return { valid: false, errorMessage: 'Missing required "@context" property in credential.' };
  }

  return { valid: true, errorMessage: '' };
}

export function checkSyntaxError(error: { name: string; [key: string]: any }): ValidationError {
  // Check invalid JSON-LD syntax; tried to redefine a protected term.
  if (!error || error.name !== 'jsonld.SyntaxError') {
    return { valid: true };
  }

  if (error?.details?.term) {
    return {
      keyword: 'conflictingProperties',
      valid: false,
      term: error?.details?.term,
      errorMessage: `Invalid JSON-LD syntax: ${error?.details?.code}. "${error?.details?.term}" is a protected term.`,
    };
  }

  if (error?.details?.context) {
    return {
      keyword: 'const',
      valid: false,
      term: '@context',
      errorMessage: `${error.message} Context: ${JSON.stringify(error.details.context)}`,
    };
  }

  return {
    keyword: 'const',
    valid: false,
    term: 'unknown',
    errorMessage: error.message,
  };
}

export function checkInvalidContext(error: { name: string; [key: string]: any }): ValidationError {
  // Check if the context URL is invalid
  if (error && error.name === 'jsonld.InvalidUrl') {
    const invalidContextUrl = error?.url || error?.details?.url;
    return {
      valid: false,
      invalidContextUrl: invalidContextUrl || 'unknown',
      errorMessage: invalidContextUrl
        ? `Invalid URL: "${invalidContextUrl}". Failed to resolve context url.`
        : 'Failed to resolve context url.',
    };
  }

  return { valid: true };
}

export async function checkInvalidProperties(
  error: { name: string; [key: string]: any },
  credential: Record<string, any>,
): Promise<{ valid: boolean; invalidValues?: string; errorMessage?: string }> {
  // Check if properties in the credential are invalid
  if (error && error.name === 'jsonld.ValidationError') {
    // Expand the credential and compact it to validate the properties
    const expandedProperties = await jsonld.expand(credential);
    const compacted = await jsonld.compact(expandedProperties, credential['@context']);

    // Get the dropped properties from the original object
    const droppedProperties = getDroppedProperties(credential, compacted);
    const invalidPropertiesString = droppedProperties.join(', ');

    return {
      valid: false,
      invalidValues: invalidPropertiesString || 'unknown',
      errorMessage: invalidPropertiesString
        ? `Properties "${invalidPropertiesString}" are defined in the credential but missing from the context.`
        : 'Failed to validate properties in the credential.',
    };
  }

  return { valid: true };
}

// Get the dropped properties from the original object
export function getDroppedProperties(
  originalObject: Record<string, any>,
  compactedObject: Record<string, any>,
  excludeField = '@context',
): string[] {
  let uniqueKeys: string[] = [];

  // Recursively find unique keys in the original object
  function findUniqueKeys(objectA: any, objectB: any, path: string[] = []) {
    if (typeof objectA !== 'object' || objectA === null) return;

    for (const key of Object.keys(objectA)) {
      const currentPath = path.concat(key);

      if (key === excludeField) continue;

      // If key does not exist in objB, record it
      if (!(key in objectB)) {
        uniqueKeys.push(currentPath.join('/'));
      } else if (typeof objectA[key] === 'object' && objectA[key] !== null && !Array.isArray(objectA[key])) {
        // Recursively search for unique keys
        findUniqueKeys(objectA[key], objectB[key], currentPath);
      }
    }
  }

  // Start the recursive search
  findUniqueKeys(originalObject, compactedObject);
  return uniqueKeys;
}
