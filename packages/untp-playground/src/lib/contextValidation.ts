import { ValidationError } from '@/types';
import { API_BASE_PATH } from '../../constants';

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

  // Expansion runs server-side (`/api/context`) so every @context URL passes
  // the same SSRF guard, size, redirect and timeout bounds as the rest of the
  // Playground's fetches, and the bundled UNTP contexts stand in when a host
  // is down. The route answers with utils' failure description, which
  // describeJsonLdError turns into the verifier's copy.
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}/api/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: credential }),
    });
  } catch (error) {
    return {
      valid: false,
      error: {
        keyword: 'unknown',
        message: `The Playground's context service could not be reached (${
          error instanceof Error ? error.message : String(error)
        }). Retry in a moment.`,
        instancePath: '',
      },
    };
  }

  let payload: { ok?: boolean; expanded?: unknown; error?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return {
      valid: false,
      error: {
        keyword: 'unknown',
        message: `The Playground's context service answered ${response.status} without a readable result. Retry in a moment.`,
        instancePath: '',
      },
    };
  }
  if (payload.ok === true) {
    return { valid: true, data: payload.expanded as Record<string, any> };
  }
  return { valid: false, error: describeJsonLdError(payload.error) };
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

/**
 * Turns the context route's failure description (utils' `describeJsonLdFailure`
 * output) into the verifier's error copy. The kind picks the keyword the
 * error dialog keys on, and the recognised codes get plain-English guidance;
 * anything else shows the description's own detail.
 */
export function describeJsonLdError(failure: any): ValidationError {
  if (!failure || typeof failure !== 'object' || typeof failure.detail !== 'string') {
    return {
      keyword: 'unknown',
      message: 'Failed to validate the JSON-LD context. The context service returned no diagnostic information.',
      instancePath: '',
    };
  }

  switch (failure.kind) {
    case 'context-fetch':
    case 'context-invalid':
      return describeContextFailure(failure);
    case 'document':
      return failure.source === 'syntax-error' ? describeSyntaxError(failure) : describeValidationEvent(failure);
    default:
      return {
        keyword: 'unknown',
        message: failure.detail,
        instancePath: '',
        params: { kind: failure.kind, code: failure.code },
      };
  }
}

function describeContextFailure(failure: any): ValidationError {
  const url: string | undefined = failure.url;
  const code: string | undefined = failure.code;

  let message: string;
  if (failure.kind === 'context-invalid') {
    message = url
      ? `The @context at "${url}" was fetched but isn't a usable JSON-LD context (it must be a JSON object carrying "@context").`
      : 'A @context URL was fetched but isn\'t a usable JSON-LD context (it must be a JSON object carrying "@context").';
  } else if (url) {
    message = `Couldn't load the @context at "${url}". Common causes: the URL is unreachable, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. ${failure.detail}.`;
  } else {
    message = `Couldn't load a @context URL: ${failure.detail}.`;
  }

  return {
    keyword: 'jsonldUrl',
    message,
    instancePath: '@context',
    params: { code, url, cause: failure.detail },
  };
}

function describeSyntaxError(failure: any): ValidationError {
  const code: string | undefined = failure.code;
  const term: string | undefined = failure.fields?.term;
  const baseMessage: string = failure.detail || 'Invalid JSON-LD syntax.';

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
// the description's own detail so new codes still surface useful information.
function describeValidationEvent(failure: any): ValidationError {
  const code: string | undefined = failure.code;
  const eventDetails: Record<string, any> = failure.fields || {};
  const fallback = failure.detail || 'JSON-LD validation failed.';

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
