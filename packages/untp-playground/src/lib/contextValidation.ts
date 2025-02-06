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

export async function validateContext(credential: Record<string, any>): Promise<ValidationResult> {
  try {
    const validateRequiredFieldsResult = validateRequiredFields(credential);
    if (!validateRequiredFieldsResult.valid) {
      return {
        valid: false,
        error: {
          keyword: 'required',
          message: validateRequiredFieldsResult.errorMessage,
          instancePath: '',
          params: { missingProperty: '@context' },
        },
      };
    }

    const expanded = await jsonld.expand(credential, { safe: true } as jsonld.Options.Expand);

    return { valid: true, data: expanded };
  } catch (error: any) {
    const checkSyntaxErrorResult = checkSyntaxError(error);
    if (!checkSyntaxErrorResult.valid) {
      return {
        valid: false,
        error: {
          keyword: 'conflictingProperties',
          message: checkSyntaxErrorResult.errorMessage as string,
          instancePath: '@context',
          params: {
            conflictingProperty: checkSyntaxErrorResult.term,
          }
        },
      }
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

    const checkInvalidPropertyResult = checkInvalidProperty(error);
    if (!checkInvalidPropertyResult.valid) {
      return {
        valid: false,
        error: {
          keyword: 'const',
          message: checkInvalidPropertyResult!.errorMessage as string,
          instancePath: checkInvalidPropertyResult.invalidValue as string,
        },
      }
    }

    return {
      valid: false,
      error: {
        keyword: 'unknown',
        message: 'Failed to validate context in credential',
        instancePath: '',
      },
    }
  }
}

export function validateRequiredFields(credential: Record<string, any>): { valid: boolean, errorMessage: string } {
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

export function checkSyntaxError(error: { name: string, [key: string]: any }): { valid: boolean, term?: string, errorMessage?: string } {
  // Check invalid JSON-LD syntax; tried to redefine a protected term.
  if (error && error.name === 'jsonld.SyntaxError') {
    const existingDetailErrors = error?.details?.code && error?.details?.term;
    return { 
      valid: false,
      term: error?.details?.term || 'unknown',
      errorMessage: existingDetailErrors ? `Invalid JSON-LD syntax: ${error?.details?.code}; "${error?.details?.term}" is a protected term.` : 'Failed to validate JSON-LD syntax.'
    };
  }

  return { valid: true };
}

export function checkInvalidContext(error: { name: string, [key: string]: any }): { valid: boolean, invalidContextUrl?: string, errorMessage?: string } {
  // Check if the context URL is invalid
  if (error && error.name === 'jsonld.InvalidUrl') {
    const invalidContextUrl = error?.url || error?.details?.url;
    return {
      valid: false,
      invalidContextUrl: invalidContextUrl || 'unknown',
      errorMessage: invalidContextUrl ? `Invalid URL: "${invalidContextUrl}". Failed to resolve context url.` : 'Failed to resolve context url.'
    };
  }

  return { valid: true };
}

export function checkInvalidProperty(error: { name: string, [key: string]: any }): { valid: boolean, invalidValue?: string, errorMessage?: string } {
  // Check if the property in the credential is invalid
  if (error && error.name === 'jsonld.ValidationError') {
    const invalidProperty = error?.details?.event?.details?.property;

    return { 
      valid: false,
      invalidValue: invalidProperty || 'unknown',
      errorMessage: invalidProperty ? `Invalid Property: "${invalidProperty}" in the credential.` : 'Failed to validate properties in the credential.'
    };
  }

  return { valid: true };
}
