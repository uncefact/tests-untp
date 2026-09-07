import type { JsonLdContextFailure, JsonLdDocumentFailure } from '@uncefact/untp-utils/validation';
import { ValidationError } from '@/types';
import type { ContextFailure, ContextServiceFailure } from './contextFailure';
import { API_BASE_PATH } from '../../constants';

interface ValidationResult {
  valid: boolean;
  /** The expanded JSON-LD form (an array of node objects) when valid. */
  data?: unknown[];
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

  // Expansion runs server-side (`/api/context`), behind an SSRF guard with
  // size, redirect and timeout bounds, and the bundled UNTP contexts stand in
  // when a host is down. The route answers with utils' failure description,
  // which describeJsonLdError turns into the verifier's copy.
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
      error: serviceError(
        `The Playground's context service could not be reached (${
          error instanceof Error ? error.message : String(error)
        }). Retry in a moment.`,
      ),
    };
  }

  let payload: { expanded?: unknown; failure?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return {
      valid: false,
      error: serviceError(
        `The Playground's context service answered ${response.status} without a readable result. Retry in a moment.`,
      ),
    };
  }
  if (response.ok) {
    if (!Array.isArray(payload?.expanded)) {
      return {
        valid: false,
        error: serviceError(
          `The Playground's context service answered ${response.status} without an expanded document. Retry in a moment.`,
        ),
      };
    }
    return { valid: true, data: payload.expanded };
  }
  return { valid: false, error: describeJsonLdError(payload.failure) };
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
 * output, or the route's own request/service failure) into the verifier's
 * error copy. The kind picks the keyword the error dialog keys on, and the
 * recognised codes get plain-English guidance; anything else shows the
 * description's own detail.
 */
export function describeJsonLdError(failure: unknown): ValidationError {
  if (!isFailureDescription(failure)) return NO_DIAGNOSTIC;

  switch (failure.kind) {
    case 'context-fetch':
    case 'context-invalid':
      return describeContextFailure(failure);
    case 'document':
      return failure.source === 'syntax-error' ? describeSyntaxError(failure) : describeValidationEvent(failure);
    case 'request':
    case 'service':
      // The service did not judge the document at all.
      return serviceError(
        `The Playground's context service could not process the request: ${failure.detail}`,
        failure.kind,
      );
    default:
      return NO_DIAGNOSTIC;
  }
}

const NO_DIAGNOSTIC: ValidationError = {
  keyword: 'unknown',
  message: 'Failed to validate the JSON-LD context. The context service returned no diagnostic information.',
  instancePath: '',
};

/** The service, not the credential, failed: the dialog keys its heading and tip on this keyword. */
function serviceError(
  message: string,
  kind: ContextServiceFailure['kind'] | 'unreachable' = 'unreachable',
): ValidationError {
  return { keyword: 'jsonldService', message, instancePath: '', params: { kind } };
}

function isFailureDescription(value: unknown): value is ContextFailure {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, detail } = value as { kind?: unknown; detail?: unknown };
  return (
    typeof detail === 'string' &&
    (kind === 'context-fetch' ||
      kind === 'context-invalid' ||
      kind === 'document' ||
      kind === 'request' ||
      kind === 'service')
  );
}

function describeContextFailure(failure: JsonLdContextFailure): ValidationError {
  const { url, code } = failure;

  let message: string;
  if (failure.kind === 'context-invalid') {
    message = url
      ? `The @context at "${url}" was fetched but isn't a usable JSON-LD context. Reported cause: ${failure.detail}.`
      : `A @context URL was fetched but isn't a usable JSON-LD context. Reported cause: ${failure.detail}.`;
  } else if (url) {
    message = `Couldn't load the @context at "${url}". Common causes: the URL is unreachable, is not https, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. Reported cause: ${failure.detail}.`;
  } else {
    message = `Couldn't load a @context URL. Reported cause: ${failure.detail}.`;
  }

  return {
    keyword: 'jsonldUrl',
    message,
    instancePath: '@context',
    params: { kind: failure.kind, code, url, cause: failure.detail },
  };
}

function describeSyntaxError(failure: JsonLdDocumentFailure): ValidationError {
  const code = failure.code;
  const term = failure.fields?.term;
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

// jsonld safe-mode rejects on a fixed set of event codes (jsonld.js `lib/events.js`).
// We translate the common ones into plain English. Anything we don't know about, including a
// document failure that carries no code at all (the pre-expansion shape check, or an unrecognised
// processor error), falls through to the description's own detail so it still surfaces something useful.
function describeValidationEvent(failure: JsonLdDocumentFailure): ValidationError {
  const code = failure.code;
  const eventDetails = failure.fields ?? {};
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
    params: { code, ...eventDetails },
  };
}
