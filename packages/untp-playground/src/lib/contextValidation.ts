import type { JsonLdContextFailure, JsonLdDocumentFailure } from '@uncefact/untp-utils/validation';
import {
  buildUntpArtefactUrls,
  detectVersionFromContext,
  isV070OrAbove,
  UNTP_SHORT_CREDENTIAL_TYPES,
} from '@uncefact/untp-utils/artefacts';
import { ValidationError } from '@/types';
import type { ContextFailure, ContextServiceFailure } from './contextFailure';
import { classifyJsonLdFailure } from './artefactFailure';
import type { ArtefactFailureFamily, ArtefactStepFailure } from './artefactFailure';
import { API_BASE_PATH } from '../../constants';

/** One budget covering the request to `/api/context` and reading its body. */
export const CONTEXT_FETCH_TIMEOUT_MS = 15_000;

const MAX_CONTEXT_DECLARATION_DEPTH = 32;
const MAX_CONTEXT_DECLARATION_NODES = 10_000;

function untpContextUrlsForVersion(credential: Record<string, any>, version: string): ReadonlySet<string> {
  const declaredTypes = Array.isArray(credential.type)
    ? credential.type.filter((value: unknown): value is string => typeof value === 'string')
    : typeof credential.type === 'string'
      ? [credential.type]
      : [];
  const recognisedType = declaredTypes.find((type: string) => Object.hasOwn(UNTP_SHORT_CREDENTIAL_TYPES, type));
  const types = recognisedType ? [recognisedType] : Object.keys(UNTP_SHORT_CREDENTIAL_TYPES);

  const urls = types.flatMap((type) => {
    if (type === 'ConformityScheme' && !isV070OrAbove(version)) return [];
    return [buildUntpArtefactUrls(type, version).contextUrl];
  });
  return new Set(urls);
}

interface DeclaredContextCollection {
  urls: ReadonlySet<string>;
  complete: boolean;
}

export function declaredContextUrls(credential: Record<string, any>): DeclaredContextCollection {
  const urls = new Set<string>();
  let visitedNodes = 0;
  let complete = true;
  const unboundedContextObjects = new WeakSet<object>();

  /**
   * Context references occur only in context values, imports and scoped
   * contexts. Term IRIs, @vocab, @base and other term-definition values are
   * not declarations.
   */
  const visitUnboundedContextValue = (initialValue: unknown): void => {
    const pending = [initialValue];
    while (pending.length > 0) {
      const value = pending.pop();
      if (value === undefined) continue;
      if (typeof value === 'object' && value !== null) {
        if (unboundedContextObjects.has(value)) continue;
        unboundedContextObjects.add(value);
      }

      if (typeof value === 'string') {
        urls.add(value);
        continue;
      }
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
        continue;
      }
      if (!isRecord(value)) continue;

      const imported = value['@import'];
      if (typeof imported === 'string') urls.add(imported);
      const scopedContexts: unknown[] = [];
      for (const [key, entry] of Object.entries(value)) {
        if (key.startsWith('@')) continue;
        if (isRecord(entry) && Object.hasOwn(entry, '@context')) scopedContexts.push(entry['@context']);
      }
      for (let index = scopedContexts.length - 1; index >= 0; index -= 1) {
        pending.push(scopedContexts[index]);
      }
    }
  };

  const visitBoundedContextValue = (value: unknown, depth: number): void => {
    if (!complete) return;
    if (depth > MAX_CONTEXT_DECLARATION_DEPTH || visitedNodes >= MAX_CONTEXT_DECLARATION_NODES) {
      complete = false;
      return;
    }
    visitedNodes += 1;
    if (typeof value === 'string') {
      urls.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visitBoundedContextValue(entry, depth + 1));
      return;
    }
    if (!isRecord(value)) return;

    const imported = value['@import'];
    if (typeof imported === 'string') urls.add(imported);
    Object.entries(value).forEach(([key, entry]) => {
      if (key.startsWith('@')) return;
      if (isRecord(entry) && Object.hasOwn(entry, '@context')) {
        visitBoundedContextValue(entry['@context'], depth + 1);
      }
    });
  };

  const visitDocument = (value: unknown, depth: number): void => {
    if (!complete) return;
    if (depth > MAX_CONTEXT_DECLARATION_DEPTH || visitedNodes >= MAX_CONTEXT_DECLARATION_NODES) {
      complete = false;
      return;
    }
    visitedNodes += 1;

    if (Array.isArray(value)) {
      value.forEach((entry) => visitDocument(entry, depth + 1));
      return;
    }
    if (!isRecord(value)) return;

    Object.entries(value).forEach(([key, entry]) => {
      if (key === '@context') {
        visitBoundedContextValue(entry, depth + 1);
      } else {
        visitDocument(entry, depth + 1);
      }
    });
  };

  // The document's own declaration is direct evidence even when preceding
  // document content consumes the bounded walk.
  if (Object.hasOwn(credential, '@context')) {
    visitUnboundedContextValue(credential['@context']);
  }
  Object.entries(credential).forEach(([key, entry]) => {
    if (key !== '@context') visitDocument(entry, 1);
  });
  return { urls, complete };
}

interface ValidationResult {
  valid: boolean;
  /** The expanded JSON-LD form (an array of node objects) when valid. */
  data?: unknown[];
  error?: ValidationError;
  /** The typed failure, from the route or from this client when the request itself failed. Carries no copy: `classifyJsonLdFailure` assigns the class and the wording. */
  failure?: ArtefactStepFailure;
}

interface RequiredFieldsResult {
  valid: boolean;
  errorMessage?: string;
}

export async function validateContext(
  credential: Record<string, any>,
  failureFamily: ArtefactFailureFamily = 'context',
): Promise<ValidationResult> {
  const requiredFieldsResult = validateRequiredFields(credential, failureFamily);
  if (!requiredFieldsResult.valid) {
    const error: ValidationError = {
      keyword: 'required',
      message: requiredFieldsResult.errorMessage!,
      instancePath: '',
      params: { missingProperty: '@context' },
    };
    return {
      valid: false,
      error,
      failure: classifyJsonLdFailure(error, failureFamily),
    };
  }
  const declaredVersion = detectVersionFromContext(credential);
  const untpContextUrls = declaredVersion ? untpContextUrlsForVersion(credential, declaredVersion) : undefined;
  const documentContextCollection = declaredContextUrls(credential);
  const allContextUrls = new Set([...documentContextCollection.urls, ...(untpContextUrls ?? [])]);

  // Expansion runs server-side (`/api/context`), behind an SSRF guard with
  // size, redirect and timeout bounds, and the bundled UNTP contexts stand in
  // when a host is down. The route answers with utils' failure description,
  // which becomes both the verifier's copy and the typed failure the step carries.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTEXT_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}/api/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: credential }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? `The Playground's context service did not respond within ${
            CONTEXT_FETCH_TIMEOUT_MS / 1000
          }s. Retry in a moment.`
        : 'The Playground context service could not be reached. Retry in a moment.';
    const failure: ContextFailure = { kind: 'service', detail };
    return {
      valid: false,
      error: serviceError(detail),
      failure: classifyJsonLdFailure(failure, failureFamily, declaredVersion, allContextUrls, {
        untpContextUrls,
        contextDeclarationsComplete: documentContextCollection.complete,
      }),
    };
  }

  let payload: unknown;
  try {
    payload = await readJsonWithAbort(response, controller.signal);
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const detail = timedOut
      ? `The Playground's context service answered ${response.status} but the result did not finish arriving within ${
          CONTEXT_FETCH_TIMEOUT_MS / 1000
        }s. Retry in a moment.`
      : `The Playground's context service answered ${response.status} without a readable result. Retry in a moment.`;
    const failure: ContextFailure = { kind: 'service', detail };
    return {
      valid: false,
      error: serviceError(detail),
      failure: classifyJsonLdFailure(failure, failureFamily, declaredVersion, allContextUrls, {
        untpContextUrls,
        contextDeclarationsComplete: documentContextCollection.complete,
        serviceStatus: response.status,
      }),
    };
  }
  clearTimeout(timeout);
  if (response.ok) {
    if (!isRecord(payload) || !Array.isArray(payload.expanded)) {
      const failure: ContextFailure = { kind: 'service', detail: 'The response did not carry an expanded document.' };
      return {
        valid: false,
        error: serviceError(
          `The Playground's context service answered ${response.status} without an expanded document. Retry in a moment.`,
        ),
        failure: classifyJsonLdFailure(failure, failureFamily, declaredVersion, allContextUrls, {
          untpContextUrls,
          contextDeclarationsComplete: documentContextCollection.complete,
          serviceStatus: response.status,
        }),
      };
    }
    return { valid: true, data: payload.expanded };
  }
  const payloadFailure = isRecord(payload) ? payload.failure : undefined;
  const hasValidFailure = isFailureDescription(payloadFailure);
  const rawFailure = hasValidFailure
    ? payloadFailure
    : { kind: 'service' as const, detail: 'The context service returned a malformed failure envelope.' };
  const error = hasValidFailure
    ? describeJsonLdError(payloadFailure)
    : serviceError(
        `The Playground's context service answered ${response.status} with a malformed failure envelope. Retry in a moment.`,
        'service',
      );
  return {
    valid: false,
    error,
    failure: classifyJsonLdFailure(rawFailure, failureFamily, declaredVersion, allContextUrls, {
      untpContextUrls,
      contextDeclarationsComplete: documentContextCollection.complete,
      serviceStatus: response.status,
    }),
  };
}

export function validateRequiredFields(
  credential: Record<string, any>,
  failureFamily: ArtefactFailureFamily = 'credential',
): RequiredFieldsResult {
  if (typeof credential !== 'object' || credential === null) {
    return { valid: false, errorMessage: 'Invalid JSON-LD document: must be a JSON object.' };
  }
  if (!('@context' in credential)) {
    const documentNoun = failureFamily === 'scheme' ? 'scheme' : 'credential';
    return { valid: false, errorMessage: `Missing required "@context" property in ${documentNoun}.` };
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

function abortError(): Error {
  return Object.assign(new Error('The context response body read was aborted.'), { name: 'AbortError' });
}

async function readJsonWithAbort(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    response
      .json()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The service, not the credential, failed: the dialog keys its heading and tip on this keyword. */
function serviceError(
  message: string,
  kind: ContextServiceFailure['kind'] | 'unreachable' = 'unreachable',
): ValidationError {
  return { keyword: 'jsonldService', message, instancePath: '', params: { kind } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailureDescription(value: unknown): value is ContextFailure {
  if (!isRecord(value)) return false;
  const { kind, detail, code, url, source, fields, upstreamStatus } = value;
  const validSource = source === undefined || source === 'syntax-error' || source === 'safe-mode-event';
  return (
    typeof detail === 'string' &&
    (kind === 'context-fetch' ||
      kind === 'context-invalid' ||
      kind === 'document' ||
      kind === 'request' ||
      kind === 'service') &&
    (code === undefined || typeof code === 'string') &&
    (url === undefined || typeof url === 'string') &&
    validSource &&
    (fields === undefined || isStringRecord(fields)) &&
    (upstreamStatus === undefined || typeof upstreamStatus === 'number')
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function describeContextFailure(failure: JsonLdContextFailure & { upstreamStatus?: number }): ValidationError {
  const { url, code, upstreamStatus } = failure;

  let message: string;
  if (failure.kind === 'context-invalid') {
    if (url) {
      message = `The @context at "${url}" was fetched but isn't a usable JSON-LD context. Reported code: ${
        code ?? 'context-invalid'
      }. Reported cause: ${failure.detail}.`;
    } else if (code === 'invalid scoped context') {
      message = `The @context check reported "${
        code ?? 'context-invalid'
      }", which does not establish whether the context was fetched or where it came from.`;
    } else {
      message = `The @context check reported "${
        code ?? 'context-invalid'
      }", which does not establish whether the context was fetched or where it came from. Reported cause: ${
        failure.detail
      }.`;
    }
  } else if (url && upstreamStatus !== undefined) {
    const reportedCause = failure.detail.includes(`${url} returned status ${upstreamStatus}`)
      ? ''
      : ` Reported cause: ${failure.detail}.`;
    message = `The @context at "${url}" returned HTTP ${upstreamStatus}.${reportedCause}`;
  } else if (url) {
    message = `Couldn't load the @context at "${url}". Common causes: the URL is unreachable, is not https, resolves to a private address, redirected too many times, or returned a non-JSON-LD response. Reported cause: ${failure.detail}.`;
  } else {
    message = `Couldn't load a @context URL. Reported cause: ${failure.detail}.`;
  }

  return {
    keyword: 'jsonldUrl',
    message,
    instancePath: '@context',
    params: {
      kind: failure.kind,
      code,
      url,
      cause: failure.detail,
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    },
  };
}

function describeSyntaxError(failure: JsonLdDocumentFailure): ValidationError {
  const code = failure.code;
  const term = failure.fields?.term;
  const baseMessage: string = failure.detail || 'Invalid JSON-LD syntax.';

  let message: string;
  if (code === 'protected term redefinition' && term) {
    message = `Your @context redefines "${term}", which is a protected JSON-LD term.`;
  } else if (code === 'keyword redefinition' && term) {
    message = `Your @context redefines "${term}", which is a JSON-LD keyword.`;
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
        ? `Property "${eventDetails.property}" appears in the credential but isn't defined by any @context.`
        : "A property in the credential isn't defined by any @context.";
      break;
    case 'relative @id reference':
      message = eventDetails.id
        ? `The id "${eventDetails.id}" is a relative reference.`
        : 'An @id value is a relative reference.';
      break;
    case 'relative @type reference':
      message = eventDetails.type
        ? `The type "${eventDetails.type}" is a relative reference.`
        : 'A @type value is a relative reference.';
      break;
    case 'relative @vocab reference':
      message = 'The @context defines @vocab as a relative reference.';
      break;
    case 'reserved term':
      message = eventDetails.term
        ? `The @context defines "${eventDetails.term}", which is reserved by JSON-LD.`
        : 'The @context uses a reserved term.';
      break;
    case 'reserved @id value':
      message = 'An @id value is reserved by JSON-LD.';
      break;
    case 'reserved @reverse value':
      message = 'A @reverse value is reserved by JSON-LD.';
      break;
    case 'invalid @language value':
      message = eventDetails.language
        ? `"${eventDetails.language}" isn't a valid BCP-47 language tag.`
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
