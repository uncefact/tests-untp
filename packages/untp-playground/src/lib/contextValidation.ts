import { ValidationError } from '@/types';
import jsonld from 'jsonld';

interface ValidationResult {
  valid: boolean;
  data?: Record<string, any>;
  error?: ValidationError;
}

interface RequiredFieldsResult {
  valid: boolean;
  errorMessage?: string;
}

export async function validateContext(credential: Record<string, any>): Promise<ValidationResult> {
  const requiredFieldsResult = validateRequiredFields(credential);
  if (!requiredFieldsResult.valid) {
    return {
      valid: false,
      error: {
        keyword: 'required',
        message: requiredFieldsResult.errorMessage!,
        instancePath: '',
        params: { missingProperty: '@context' },
      },
    };
  }

  try {
    const expanded = await jsonld.expand(credential, { safe: true } as jsonld.Options.Expand);
    return { valid: true, data: expanded };
  } catch (error: any) {
    return { valid: false, error: describeJsonLdError(error) };
  }
}

export function validateRequiredFields(credential: Record<string, any>): RequiredFieldsResult {
  if (typeof credential !== 'object' || credential === null) {
    return { valid: false, errorMessage: 'Invalid JSON-LD document: must be a JSON object.' };
  }
  if (!('@context' in credential)) {
    return { valid: false, errorMessage: 'Missing required "@context" property in credential.' };
  }
  return { valid: true };
}

export function describeJsonLdError(error: any): ValidationError {
  if (!error || typeof error !== 'object') {
    return {
      keyword: 'unknown',
      message: 'Failed to validate the JSON-LD context. The library returned no diagnostic information.',
      instancePath: '',
    };
  }

  switch (error.name) {
    case 'jsonld.InvalidUrl':
      return describeInvalidUrl(error);
    case 'jsonld.SyntaxError':
      return describeSyntaxError(error);
    case 'jsonld.ValidationError':
      return describeValidationEvent(error);
    default:
      return {
        keyword: 'unknown',
        message:
          error.name && error.message
            ? `${error.name}: ${error.message}`
            : error.message || `${error.name || 'Error'}: validation failed.`,
        instancePath: '',
        params: { name: error.name, details: error.details },
      };
  }
}

function describeInvalidUrl(error: any): ValidationError {
  const url: string | undefined = error?.details?.url ?? error?.url;
  const code: string | undefined = error?.details?.code;
  const cause = error?.details?.cause;
  const causeMessage = typeof cause === 'string' ? cause : cause?.message;

  let message: string;
  if (code === 'loading remote context failed' && url) {
    message = `Couldn't load the @context at "${url}". Common causes: the URL is unreachable, blocked by CORS, redirected too many times, or returning a non-JSON-LD response.`;
  } else if (url) {
    message = `Couldn't resolve the @context URL "${url}".`;
  } else {
    message = error?.message || `Couldn't resolve a @context URL.`;
  }
  if (causeMessage) {
    message += ` Underlying cause: ${causeMessage}.`;
  }

  return {
    keyword: 'jsonldUrl',
    message,
    instancePath: '@context',
    params: { code, url, cause: causeMessage },
  };
}

function describeSyntaxError(error: any): ValidationError {
  const code: string | undefined = error?.details?.code;
  const term: string | undefined = error?.details?.term;
  const baseMessage: string = error?.message || 'Invalid JSON-LD syntax.';

  let message: string;
  if (code === 'protected term redefinition' && term) {
    message = `Your @context redefines "${term}", which is a protected JSON-LD term. Either rename the term, or use a different @context that doesn't redefine it.`;
  } else if (code === 'keyword redefinition' && term) {
    message = `Your @context redefines "${term}", which is a JSON-LD keyword. Keywords can't be redefined.`;
  } else if (code === 'invalid local context') {
    message = `The @context value isn't a valid JSON-LD context. ${baseMessage}`.trim();
  } else {
    message = baseMessage;
    if (term) message += ` Term involved: "${term}".`;
  }

  return {
    keyword: 'jsonldSyntax',
    message,
    instancePath: '@context',
    params: { code, term },
  };
}

// jsonld safe-mode rejects on a fixed set of event codes (see node_modules/jsonld/lib/events.js).
// We translate the common ones into plain English. Anything we don't know about falls through to
// the library's own message so new codes still surface useful information.
function describeValidationEvent(error: any): ValidationError {
  const event = error?.details?.event;
  const code: string | undefined = event?.code;
  const eventMessage: string | undefined = event?.message;
  const eventDetails: Record<string, any> = event?.details || {};
  const fallback = eventMessage || error?.message || 'JSON-LD validation failed.';

  let message: string;
  switch (code) {
    case 'invalid property':
      message = eventDetails.property
        ? `Property "${eventDetails.property}" appears in the credential but isn't defined by any @context. Either add a definition for it to a @context, or remove the property from the credential.`
        : "A property in the credential isn't defined by any @context.";
      break;
    case 'relative @id reference':
      message = eventDetails.id
        ? `The id "${eventDetails.id}" is a relative reference. Use an absolute IRI such as "https://...", "did:...", or "urn:...".`
        : 'An @id value is a relative reference. Use an absolute IRI such as "https://...", "did:...", or "urn:...".';
      break;
    case 'relative @type reference':
      message = eventDetails.type
        ? `The type "${eventDetails.type}" is a relative reference. Use an absolute IRI, or define it as a term in the @context.`
        : 'A @type value is a relative reference. Use an absolute IRI, or define it as a term in the @context.';
      break;
    case 'relative @vocab reference':
      message = 'The @context defines @vocab as a relative reference. The @vocab value must be an absolute IRI.';
      break;
    case 'reserved term':
      message = eventDetails.term
        ? `The @context defines "${eventDetails.term}", which is reserved by JSON-LD. Choose a different name.`
        : 'The @context uses a reserved term. Reserved terms (those beginning with "@") can\'t be redefined.';
      break;
    case 'reserved @id value':
      message = 'An @id value is reserved by JSON-LD. Values starting with "@" can\'t be used as identifiers.';
      break;
    case 'reserved @reverse value':
      message = 'A @reverse value is reserved by JSON-LD.';
      break;
    case 'invalid @language value':
      message = eventDetails.language
        ? `"${eventDetails.language}" isn't a valid BCP-47 language tag. Use a tag like "en", "en-AU", or "fr-CA".`
        : "A language tag in the credential isn't a valid BCP-47 tag.";
      break;
    default:
      message = fallback;
      break;
  }

  return {
    keyword: 'jsonldValidation',
    message,
    instancePath: '',
    params: {
      code,
      property: eventDetails.property,
      id: eventDetails.id,
      type: eventDetails.type,
      term: eventDetails.term,
      language: eventDetails.language,
    },
  };
}
