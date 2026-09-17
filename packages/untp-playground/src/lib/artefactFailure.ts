/**
 * The four artefact-failure classes and the copy the Playground shows for each.
 *
 * A class states who or what the evidence establishes as at fault, never a guess:
 * `could-not-fetch` when the artefact never arrived, `unusable-artefact` when it
 * arrived and is not usable, `credential-invalid` when the submitted document
 * is the established fault, and `unknown` when the available diagnostic
 * establishes none of those. Only `credential-invalid` copy may ask the
 * verifier to change the submitted document; the other three ask for a retry
 * or a report, because a verifier who changes a credential in response to a
 * host outage has been misled.
 *
 * Classification happens where the evidence is still present (the fetcher, the
 * validator, the route boundary) and is carried on the step, so cards, details,
 * toasts and the downloadable report never re-derive it.
 *
 * See issue #1012 and ADR-041.
 */

import type { JsonLdContextFailure, JsonLdDocumentFailure } from '@uncefact/untp-utils/validation';
import { TestCaseStepId } from '../../constants';
import type { ValidationError } from '@/types';
import type { SchemaFetchCategory, SchemaFetchReason, SchemaSelectionReason } from './schemaFetch';

/** The evidence class assigned to a failed artefact step. */
export type ArtefactFailureClass = 'could-not-fetch' | 'unusable-artefact' | 'credential-invalid' | 'unknown';

/** The family whose artefact or validation step produced a failure. */
export type ArtefactFailureFamily = 'credential' | 'extension' | 'vcdm' | 'context' | 'scheme' | 'link-set';

/** Stable diagnostic codes carried by failure metadata. */
export type ArtefactFailureCode =
  | 'schema.fetch.unreachable'
  | 'schema.fetch.upstream-status'
  | 'schema.fetch.invalid-json'
  | 'schema.fetch.uncoded'
  | 'schema.fetch.timeout'
  | 'schema.fetch.not-found'
  | 'schema.fetch.network'
  | 'schema.fetch.parse'
  | 'schema.fetch.unreadable-response'
  | 'schema.fetch.not-published'
  | 'schema.validation.meta-schema'
  | 'schema.validation.dialect'
  | 'schema.validation.compile'
  | 'schema.validation.payload'
  | 'schema.selection.version-not-detected'
  | 'schema.selection.unknown-type'
  | 'schema.selection.unsupported-extension-version'
  | 'schema.selection.vcdm-version-unmapped'
  | 'schema.selection.scheme-version-unsupported'
  | 'schema.selection.builder'
  /** Structural parser failures establish that the submitted scheme is invalid. */
  | 'conformity-scheme.parse-failed'
  | 'context.required'
  | 'context.fetch'
  | 'context.fetch.not-published'
  | 'context.invalid'
  | 'context.document.invalid-property'
  | 'context.document.unknown'
  | 'context.service'
  | 'playground.pipeline.initialisation'
  | 'playground.pipeline.unexpected'
  | 'playground.pipeline.step'
  | 'playground.pipeline.not-executed';

type ArtefactFailureBase = {
  code: ArtefactFailureCode;
  message: string;
  remediation: string;
};

/**
 * One of four evidence classes: could-not-fetch when no artefact arrived,
 * unusable-artefact when the response cannot be used, credential-invalid when
 * the submitted document is established as the fault, and unknown when the
 * available evidence cannot assign ownership.
 */
export type ArtefactStepFailure =
  | (ArtefactFailureBase & {
      class: 'could-not-fetch';
      artefactUrl?: string;
      serviceStatus?: number;
      upstreamStatus?: number;
    })
  | (ArtefactFailureBase & {
      class: 'unusable-artefact';
      artefactUrl: string;
      serviceStatus?: number;
      upstreamStatus?: number;
    })
  | (ArtefactFailureBase & {
      class: 'credential-invalid';
      artefactUrl?: string;
      serviceStatus?: number;
      upstreamStatus?: number;
      declaredVersion?: string;
    })
  | (ArtefactFailureBase & {
      class: 'unknown';
      artefactUrl?: string;
      serviceStatus?: number;
      upstreamStatus?: number;
      /** Step that caused Conformity Scheme validation to be skipped. */
      blockedBy?: TestCaseStepId;
    });

/** Presentation values shared by the card, details view and report. */
export interface ArtefactFailurePresentation {
  heading: string;
  message: string;
  remediation: string;
}

type SchemaFetchLike = {
  schemaUrl?: string;
  category: SchemaFetchCategory | string;
  serviceStatus?: number;
  upstreamStatus?: number;
  reason: SchemaFetchReason | string;
  message: string;
  browserSide?: boolean;
  declaredVersion?: string;
};

type JsonLdFailureLike =
  | (JsonLdContextFailure & { upstreamStatus?: number })
  | JsonLdDocumentFailure
  | { kind: 'request' | 'service'; detail: string }
  | ValidationError
  | undefined;

const familyLabel: Record<ArtefactFailureFamily, string> = {
  credential: 'credential',
  extension: 'extension schema',
  vcdm: 'VCDM schema',
  context: 'JSON-LD context',
  scheme: 'scheme',
  'link-set': 'link set',
};

const schemeStepDisplayNames: Partial<Record<TestCaseStepId, string>> = {
  [TestCaseStepId.SCHEME_VERSION_DETECTION]: 'Version Detection',
  [TestCaseStepId.SCHEME_SCHEMA_VALIDATION]: 'Schema Validation',
  [TestCaseStepId.SCHEME_STRUCTURAL_PARSE]: 'Structural Parse',
  [TestCaseStepId.CONTEXT_VALIDATION]: 'JSON-LD Document Expansion and Context Validation',
};

function defaultRemediation(failureClass: ArtefactFailureClass, family: ArtefactFailureFamily): string {
  switch (failureClass) {
    case 'could-not-fetch':
      return 'Retry the check. If it keeps failing, report the URL and these details to the Playground operator.';
    case 'unusable-artefact':
      return 'Report the artefact URL and these details to its publisher or the Playground operator.';
    case 'credential-invalid':
      return family === 'scheme'
        ? 'Correct the named field or term in the scheme.'
        : family === 'link-set'
          ? 'Correct the named field or term in the link set.'
          : 'Correct the named field or term in the credential.';
    case 'unknown':
      return 'Report these details to the Playground operator.';
  }
}

type MakeFailureOptions = {
  artefactUrl?: string;
  serviceStatus?: number;
  upstreamStatus?: number;
  declaredVersion?: string;
  blockedBy?: TestCaseStepId;
  remediation?: string;
};

function makeFailure(
  failureClass: 'could-not-fetch',
  code: ArtefactFailureCode,
  message: string,
  family: ArtefactFailureFamily,
  options?: MakeFailureOptions,
): Extract<ArtefactStepFailure, { class: 'could-not-fetch' }>;
function makeFailure(
  failureClass: 'unusable-artefact',
  code: ArtefactFailureCode,
  message: string,
  family: ArtefactFailureFamily,
  options: MakeFailureOptions & { artefactUrl: string },
): Extract<ArtefactStepFailure, { class: 'unusable-artefact' }>;
function makeFailure(
  failureClass: 'credential-invalid',
  code: ArtefactFailureCode,
  message: string,
  family: ArtefactFailureFamily,
  options?: MakeFailureOptions,
): Extract<ArtefactStepFailure, { class: 'credential-invalid' }>;
function makeFailure(
  failureClass: 'unknown',
  code: ArtefactFailureCode,
  message: string,
  family: ArtefactFailureFamily,
  options?: MakeFailureOptions,
): Extract<ArtefactStepFailure, { class: 'unknown' }>;
function makeFailure(
  failureClass: ArtefactFailureClass,
  code: ArtefactFailureCode,
  message: string,
  family: ArtefactFailureFamily,
  options: MakeFailureOptions = {},
): ArtefactStepFailure {
  const remediation = options.remediation ?? defaultRemediation(failureClass, family);
  switch (failureClass) {
    case 'could-not-fetch':
      return {
        class: failureClass,
        code,
        message,
        remediation,
        ...(options.artefactUrl === undefined ? {} : { artefactUrl: options.artefactUrl }),
        ...(options.serviceStatus === undefined ? {} : { serviceStatus: options.serviceStatus }),
        ...(options.upstreamStatus === undefined ? {} : { upstreamStatus: options.upstreamStatus }),
      };
    case 'unusable-artefact':
      if (options.artefactUrl === undefined) {
        throw new Error('An unusable artefact failure requires an artefact URL.');
      }
      return {
        class: failureClass,
        code,
        message,
        remediation,
        artefactUrl: options.artefactUrl,
        ...(options.serviceStatus === undefined ? {} : { serviceStatus: options.serviceStatus }),
        ...(options.upstreamStatus === undefined ? {} : { upstreamStatus: options.upstreamStatus }),
      };
    case 'credential-invalid':
      return {
        class: failureClass,
        code,
        message,
        remediation,
        ...(options.artefactUrl === undefined ? {} : { artefactUrl: options.artefactUrl }),
        ...(options.serviceStatus === undefined ? {} : { serviceStatus: options.serviceStatus }),
        ...(options.upstreamStatus === undefined ? {} : { upstreamStatus: options.upstreamStatus }),
        ...(options.declaredVersion === undefined ? {} : { declaredVersion: options.declaredVersion }),
      };
    case 'unknown':
      return {
        class: failureClass,
        code,
        message,
        remediation,
        ...(options.artefactUrl === undefined ? {} : { artefactUrl: options.artefactUrl }),
        ...(options.serviceStatus === undefined ? {} : { serviceStatus: options.serviceStatus }),
        ...(options.upstreamStatus === undefined ? {} : { upstreamStatus: options.upstreamStatus }),
        ...(options.blockedBy === undefined ? {} : { blockedBy: options.blockedBy }),
      };
  }
}

function statusText(error: Pick<SchemaFetchLike, 'serviceStatus' | 'upstreamStatus'>): string {
  const statuses = [
    error.upstreamStatus === undefined ? undefined : `upstream status ${error.upstreamStatus}`,
    error.serviceStatus === undefined ? undefined : `service status ${error.serviceStatus}`,
  ].filter((value): value is string => value !== undefined);
  return statuses.length > 0 ? ` (${statuses.join(', ')})` : '';
}

const schemaFetchCodes: Record<SchemaFetchCategory, ArtefactFailureCode> = {
  unreachable: 'schema.fetch.unreachable',
  'upstream-status': 'schema.fetch.upstream-status',
  'invalid-json': 'schema.fetch.invalid-json',
  uncoded: 'schema.fetch.uncoded',
};

const schemaFetchReasonCodes: Record<SchemaFetchReason, ArtefactFailureCode> = {
  timeout: 'schema.fetch.timeout',
  'not-found': 'schema.fetch.not-found',
  network: 'schema.fetch.network',
  parse: 'schema.fetch.parse',
  'unreadable-response': 'schema.fetch.unreadable-response',
};

function notPublishedMessage(kind: 'schema' | 'context', url: string, status: number, declaredVersion: string): string {
  return `The ${kind} at "${url}" returned HTTP status ${status}; it was not published for declared version ${declaredVersion}.`;
}

function isNotPublishedStatus(status: number): boolean {
  return status === 403 || status === 404 || status === 410;
}

function contextServiceMessage(detail: string, serviceStatus?: number): string {
  if (serviceStatus !== undefined) {
    return /^The Playground(?:'s)? context service answered \d+/.test(detail)
      ? detail
      : `The Playground's context service answered ${serviceStatus}: ${detail}`;
  }
  return /^The Playground(?:'s)? context service (?:could not be reached|did not respond)/.test(detail)
    ? detail
    : `The Playground context service could not be reached: ${detail}`;
}

function artefactLocation(schemaUrl?: string): string {
  return schemaUrl ? `the artefact at "${schemaUrl}"` : 'the artefact';
}

/**
 * Classifies a schema route or browser transport failure while retaining the
 * distinction between an answered route and a failed browser request.
 */
export function classifySchemaFetchFailure(
  error: SchemaFetchLike,
  family: ArtefactFailureFamily = 'credential',
  declaredVersion?: string,
): ArtefactStepFailure {
  const common = {
    ...(error.schemaUrl === undefined ? {} : { artefactUrl: error.schemaUrl }),
    ...(error.serviceStatus === undefined ? {} : { serviceStatus: error.serviceStatus }),
    ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
  };

  const isUpstream4xx =
    error.category === 'upstream-status' &&
    error.upstreamStatus !== undefined &&
    error.upstreamStatus >= 400 &&
    error.upstreamStatus < 500;

  if (family === 'link-set' && error.schemaUrl && isUpstream4xx) {
    return makeFailure(
      'could-not-fetch',
      'schema.fetch.upstream-status',
      `The Playground could not fetch ${artefactLocation(error.schemaUrl)}${statusText(error)}.`,
      family,
      {
        ...common,
        remediation: 'Pick a UNTP version that has a published link-set schema.',
      },
    );
  }

  if (
    error.category === 'upstream-status' &&
    error.schemaUrl &&
    error.upstreamStatus !== undefined &&
    isNotPublishedStatus(error.upstreamStatus) &&
    declaredVersion
  ) {
    return makeFailure(
      'credential-invalid',
      'schema.fetch.not-published',
      notPublishedMessage('schema', error.schemaUrl, error.upstreamStatus, declaredVersion),
      family,
      {
        ...common,
        declaredVersion,
        remediation:
          family === 'scheme'
            ? `Use the declared @context version ${declaredVersion} with a schema published for that version, or correct the scheme's declared @context version.`
            : `Use the declared @context version ${declaredVersion} with a schema published for that version, or correct the credential's declared @context version.`,
      },
    );
  }

  const reason = error.reason as SchemaFetchReason;
  if (error.browserSide && Object.hasOwn(schemaFetchReasonCodes, reason)) {
    return makeFailure(
      'could-not-fetch',
      schemaFetchReasonCodes[reason],
      `The Playground could not fetch ${artefactLocation(error.schemaUrl)}${statusText(error)}.`,
      family,
      common,
    );
  }

  const category = error.category as SchemaFetchCategory;
  const knownCategory = Object.hasOwn(schemaFetchCodes, category);
  if (!knownCategory) {
    return makeFailure(
      'unknown',
      'schema.fetch.uncoded',
      `The Playground schema service returned an unrecognised category "${String(
        error.category,
      )}" for ${artefactLocation(error.schemaUrl)}.`,
      family,
      common,
    );
  }

  if (error.category === 'invalid-json' && error.schemaUrl) {
    return makeFailure(
      'unusable-artefact',
      'schema.fetch.invalid-json',
      `The artefact at "${error.schemaUrl}" was fetched but its response was not valid JSON.`,
      family,
      { ...common, artefactUrl: error.schemaUrl },
    );
  }

  if (error.category === 'uncoded' && error.serviceStatus !== undefined && error.serviceStatus < 500) {
    return makeFailure(
      'unknown',
      'schema.fetch.uncoded',
      `The Playground schema service returned status ${error.serviceStatus} for ${artefactLocation(
        error.schemaUrl,
      )} without a classified cause.`,
      family,
      common,
    );
  }

  const code = schemaFetchCodes[category];
  return makeFailure(
    'could-not-fetch',
    code,
    `The Playground could not fetch ${artefactLocation(error.schemaUrl)}${statusText(error)}.`,
    family,
    common,
  );
}

/** Classifies a schema whose JSON was valid but whose schema contract failed. */
export function classifySchemaMetaFailure(
  schemaUrl: string,
  diagnostic: string,
  family: ArtefactFailureFamily = 'credential',
): ArtefactStepFailure {
  return makeFailure(
    'unusable-artefact',
    'schema.validation.meta-schema',
    `The artefact at "${schemaUrl}" is not a usable JSON Schema: ${diagnostic}`,
    family,
    { artefactUrl: schemaUrl },
  );
}

/** Classifies a schema that declares a dialect unavailable to this validator. */
export function classifySchemaDialectFailure(
  schemaUrl: string,
  dialect: string,
  family: ArtefactFailureFamily = 'credential',
): ArtefactStepFailure {
  return makeFailure(
    'unknown',
    'schema.validation.dialect',
    `The schema at "${schemaUrl}" declares the dialect "${dialect}", which this validator does not carry.`,
    family,
    { artefactUrl: schemaUrl },
  );
}

/** Classifies a schema that could not be compiled by the selected validator. */
export function classifySchemaCompileFailure(
  schemaUrl: string,
  diagnostic: string,
  family: ArtefactFailureFamily = 'credential',
): ArtefactStepFailure {
  return makeFailure(
    'unknown',
    'schema.validation.compile',
    `The Playground could not compile the schema at "${schemaUrl}": ${diagnostic}`,
    family,
    { artefactUrl: schemaUrl },
  );
}

/** Classifies a submitted document that failed a usable schema. */
export function classifySchemaPayloadFailure(
  message: string,
  family: ArtefactFailureFamily = 'credential',
  options: { artefactUrl?: string; remediation?: string } = {},
): ArtefactStepFailure {
  return makeFailure('credential-invalid', 'schema.validation.payload', message, family, options);
}

const schemaSelectionCodes: Record<SchemaSelectionReason, ArtefactFailureCode> = {
  'version-not-detected': 'schema.selection.version-not-detected',
  'unknown-type': 'schema.selection.unknown-type',
  'unsupported-extension-version': 'schema.selection.unsupported-extension-version',
  'vcdm-version-unmapped': 'schema.selection.vcdm-version-unmapped',
  'scheme-version-unsupported': 'schema.selection.scheme-version-unsupported',
  builder: 'schema.selection.builder',
};

function schemaSelectionRemediation(reason: SchemaSelectionReason, family: ArtefactFailureFamily): string | undefined {
  const documentNoun = family === 'scheme' ? 'scheme' : 'credential';
  switch (reason) {
    case 'version-not-detected':
      return `Check the ${documentNoun} @context for a recognised UNTP version.`;
    case 'unknown-type':
      return `Check the ${documentNoun} type field against the UNTP types this Playground validates.`;
    case 'unsupported-extension-version':
      return 'Check the extension context entry against the registered extension versions.';
    case 'vcdm-version-unmapped':
      return `Check the ${documentNoun} @context for a VCDM version this Playground carries.`;
    case 'scheme-version-unsupported':
      return 'Check the scheme version in @context and use a version with a published schema.';
    case 'builder':
      return undefined;
  }
}

/** Classifies failure to select the schema required by an artefact. */
export function classifySchemaSelectionFailure(
  error: { reason: SchemaSelectionReason; message: string },
  family: ArtefactFailureFamily,
): ArtefactStepFailure {
  const remediation = schemaSelectionRemediation(error.reason, family);
  const options = {
    ...(remediation === undefined ? {} : { remediation }),
  };
  return error.reason === 'builder'
    ? makeFailure('unknown', schemaSelectionCodes[error.reason], error.message, family, options)
    : makeFailure('credential-invalid', schemaSelectionCodes[error.reason], error.message, family, options);
}

function contextCode(failure: JsonLdFailureLike): string | undefined {
  if (!failure || !('kind' in failure)) return failure?.params?.code;
  return 'code' in failure && typeof failure.code === 'string' ? failure.code : undefined;
}

function contextUrl(failure: JsonLdFailureLike): string | undefined {
  if (!failure || !('kind' in failure)) return failure?.params?.url;
  return 'url' in failure && typeof failure.url === 'string' ? failure.url : undefined;
}

function contextDetail(failure: JsonLdFailureLike): string {
  if (!failure) return 'No diagnostic information was returned.';
  if ('detail' in failure && typeof failure.detail === 'string') return failure.detail;
  if ('message' in failure && typeof failure.message === 'string') return failure.message;
  return 'No diagnostic information was returned.';
}

function contextFields(failure: JsonLdFailureLike): Record<string, string> {
  if (!failure || !('kind' in failure) || !('fields' in failure) || !failure.fields) return {};
  return Object.fromEntries(
    Object.entries(failure.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function contextFetchDetail(code: string | undefined, detail: string): string {
  return code === 'resolver.timed-out' || /timed out after \d+ms/i.test(detail)
    ? 'the context service timed out while fetching the remote @context'
    : detail;
}

function contextFetchMessage(url: string | undefined, detail: string, serviceStatus?: number): string {
  const message = url
    ? `The Playground could not fetch the JSON-LD context at "${url}": ${detail}`
    : `The Playground could not fetch the JSON-LD context: ${detail}`;
  return serviceStatus === undefined
    ? message
    : `The Playground's context service answered ${serviceStatus}: ${message}`;
}

function contextPointer(code: string | undefined, fields: Record<string, string>): string | undefined {
  const fieldByCode: Record<string, string> = {
    'relative @type reference': 'type',
    'relative @id reference': 'id',
    'relative @vocab reference': 'vocab',
    'reserved term': 'term',
    'invalid @language value': 'language',
  };
  const field = code === undefined ? undefined : fieldByCode[code];
  return field === undefined ? undefined : fields[field];
}

export interface JsonLdFailureClassificationOptions {
  /** URLs present in the submitted document, including the generated UNTP context URL. */
  declaredContextUrls?: ReadonlySet<string>;
  /** Generated UNTP context URLs, kept separate so version-specific copy is accurate. */
  untpContextUrls?: ReadonlySet<string>;
  /** The declared context entry known to have imported a failing dependency. */
  declaredContextEntry?: string;
  /** Whether the document walk completed before parent or dependency evidence was needed. */
  contextDeclarationsComplete?: boolean;
  /** HTTP status returned by the Playground context service, when there was a response. */
  serviceStatus?: number;
}

/**
 * Classifies a JSON-LD context diagnostic by its exact code, never by category.
 *
 * jsonld emits the same event whether the offending definition was inline in the
 * credential or came from a fetched remote context, so only `invalid property`
 * establishes the credential as the fault. Every other document code, and a
 * `context-invalid` result that carries no URL, is `unknown`. Do not widen the
 * `credential-invalid` branch without evidence that the code can arise from the
 * credential alone.
 */
export function classifyJsonLdFailure(
  failure: JsonLdFailureLike,
  family: ArtefactFailureFamily = 'context',
  declaredVersion?: string,
  declaredContextUrls?: ReadonlySet<string>,
  options: JsonLdFailureClassificationOptions = {},
): ArtefactStepFailure {
  const code = contextCode(failure);
  const url = contextUrl(failure);
  const detail = contextDetail(failure);
  const fields = contextFields(failure);
  const untpContextUrls = options.untpContextUrls ?? declaredContextUrls;
  const contextDeclarationsComplete = options.contextDeclarationsComplete !== false;
  const declaredContextEntry = contextDeclarationsComplete
    ? options.declaredContextEntry ?? (declaredContextUrls?.size === 1 ? [...declaredContextUrls][0] : undefined)
    : undefined;
  const documentNoun = family === 'scheme' ? 'scheme' : 'credential';
  const serviceStatus = options.serviceStatus;

  if (failure && 'kind' in failure && (failure.kind === 'request' || failure.kind === 'service')) {
    return makeFailure('could-not-fetch', 'context.service', contextServiceMessage(detail, serviceStatus), family, {
      serviceStatus,
    });
  }

  if (failure && 'kind' in failure && failure.kind === 'context-fetch') {
    const upstreamStatus = 'upstreamStatus' in failure ? failure.upstreamStatus : undefined;
    if (code === 'resolver.http-error' && url && upstreamStatus !== undefined && isNotPublishedStatus(upstreamStatus)) {
      const isDeclaredContext = declaredContextUrls?.has(url) === true;
      if (isDeclaredContext) {
        const isUntpContext = declaredVersion !== undefined && untpContextUrls?.has(url) === true;
        return makeFailure(
          'credential-invalid',
          'context.fetch.not-published',
          isUntpContext
            ? notPublishedMessage('context', url, upstreamStatus, declaredVersion)
            : `No context is published at ${url} (status ${upstreamStatus}). Check the ${documentNoun}'s @context entry.`,
          family,
          {
            artefactUrl: url,
            serviceStatus,
            upstreamStatus,
            ...(isUntpContext ? { declaredVersion } : {}),
            remediation: isUntpContext
              ? `Use the declared @context version ${declaredVersion} with a context published for that version, or correct the ${documentNoun}'s declared @context version.`
              : `Check the ${documentNoun}'s @context entry for ${url}.`,
          },
        );
      }
      if (!contextDeclarationsComplete) {
        return makeFailure(
          'could-not-fetch',
          'context.fetch',
          `The Playground could not fetch the context at ${url} (status ${upstreamStatus}). The document is too large for the Playground to trace which context imported it.`,
          family,
          {
            artefactUrl: url,
            serviceStatus,
            upstreamStatus,
            remediation: `The context at ${url} has not been published by its publisher. Report it to the publisher of the context that imported it.`,
          },
        );
      }
      const dependencyMessage = declaredContextEntry
        ? `The context dependency at "${url}" returned HTTP status ${upstreamStatus}; it was reached through declared context "${declaredContextEntry}".`
        : `The context dependency at "${url}" returned HTTP status ${upstreamStatus}; it was imported by a declared context.`;
      const dependencyRemediation = declaredContextEntry
        ? `The context at ${declaredContextEntry} depends on ${url}, which its publisher has not published. Report it to that publisher.`
        : `The context at ${url} is imported by a declared context, but its publisher has not published it. Report it to that publisher.`;
      return makeFailure('could-not-fetch', 'context.fetch', dependencyMessage, family, {
        artefactUrl: url,
        serviceStatus,
        upstreamStatus,
        remediation: dependencyRemediation,
      });
    }
    const fetchDetail = contextFetchDetail(code, detail);
    return makeFailure(
      'could-not-fetch',
      'context.fetch',
      contextFetchMessage(url, fetchDetail, serviceStatus),
      family,
      { artefactUrl: url, serviceStatus, upstreamStatus },
    );
  }

  if (failure && 'kind' in failure && failure.kind === 'context-invalid') {
    const establishedRemoteInvalid = code === 'resolver.invalid-json' || code === 'invalid remote context';
    if (url && establishedRemoteInvalid) {
      return makeFailure(
        'unusable-artefact',
        'context.invalid',
        `The JSON-LD context at "${url}" was fetched but is not usable: ${detail}`,
        family,
        { artefactUrl: url, serviceStatus },
      );
    }
    const diagnosticMessage = `The JSON-LD context check returned code "${
      code ?? 'context-invalid'
    }". The diagnostic does not establish retrieval or origin for the invalid definition`;
    return makeFailure(
      'unknown',
      'context.invalid',
      code === 'invalid scoped context' ? `${diagnosticMessage}.` : `${diagnosticMessage}: ${detail}`,
      family,
      { artefactUrl: url, serviceStatus },
    );
  }

  if (code === 'invalid property') {
    const term = fields.property ?? fields.term;
    return makeFailure(
      'credential-invalid',
      'context.document.invalid-property',
      term
        ? `The ${documentNoun} uses property "${term}", but no supplied JSON-LD context defines it.`
        : `The ${documentNoun} uses a property that no supplied JSON-LD context defines.`,
      family,
      {
        serviceStatus,
        remediation: term ? `Add "${term}" to a context, or remove it from the ${documentNoun}.` : undefined,
      },
    );
  }

  if (
    failure &&
    !('kind' in failure) &&
    failure.keyword === 'required' &&
    failure.params?.missingProperty === '@context'
  ) {
    return makeFailure('credential-invalid', 'context.required', failure.message, family, {
      remediation: `Add the missing "@context" field to the ${documentNoun}.`,
    });
  }

  if (failure && !('kind' in failure) && failure.keyword === 'jsonldService') {
    return makeFailure(
      'could-not-fetch',
      'context.service',
      contextServiceMessage(failure.message, serviceStatus),
      family,
      {
        serviceStatus,
      },
    );
  }

  if (failure && !('kind' in failure) && failure.keyword === 'jsonldUrl' && failure.params?.kind === 'context-fetch') {
    return makeFailure('could-not-fetch', 'context.fetch', failure.message, family, {
      artefactUrl: contextUrl(failure),
    });
  }

  const diagnosticCode = code ?? (failure && 'keyword' in failure ? failure.keyword : undefined) ?? 'unknown';
  const pointer = contextPointer(diagnosticCode, fields);
  const detailSuffix = pointer ? '' : ` ${detail}`;
  return makeFailure(
    'unknown',
    'context.document.unknown',
    `JSON-LD reported "${diagnosticCode}"${
      pointer ? ` for "${pointer}"` : ''
    }; the Playground cannot tell whether the credential or a remote context caused it.${detailSuffix}`,
    family,
    { artefactUrl: url, serviceStatus },
  );
}

/** Classifies an unexpected Playground pipeline failure. */
export function unexpectedFailure(
  code: Extract<
    ArtefactFailureCode,
    'playground.pipeline.initialisation' | 'playground.pipeline.unexpected' | 'playground.pipeline.step'
  >,
  message: string,
  family: ArtefactFailureFamily,
): ArtefactStepFailure {
  return makeFailure('unknown', code, message, family);
}

/**
 * Records that Conformity Scheme steps were skipped because an earlier step
 * failed; the scheme results consumer renders the blocked-by relationship.
 */
export function notExecutedFailure(blockedBy: TestCaseStepId, family: ArtefactFailureFamily): ArtefactStepFailure {
  return makeFailure(
    'unknown',
    'playground.pipeline.not-executed',
    `This ${familyLabel[family]} step was not executed because step "${
      schemeStepDisplayNames[blockedBy] ?? blockedBy
    }" failed first.`,
    family,
    { blockedBy },
  );
}

/** Toasts are reserved for failures whose codes identify an unexpected pipeline break. */
export function isUnexpectedFailure(failure: ArtefactStepFailure | undefined): boolean {
  return (
    failure?.code === 'playground.pipeline.unexpected' ||
    failure?.code === 'playground.pipeline.initialisation' ||
    failure?.code === 'playground.pipeline.step'
  );
}

function headingForKnownClass(failureClass: ArtefactFailureClass, family: ArtefactFailureFamily): string {
  switch (failureClass) {
    case 'credential-invalid':
      return family === 'scheme' ? 'Scheme invalid' : family === 'link-set' ? 'Link set invalid' : 'Credential invalid';
    case 'could-not-fetch':
      return 'Could not fetch';
    case 'unusable-artefact':
      return 'Unusable artefact';
    case 'unknown':
      return 'Could not determine the cause';
    default: {
      const exhaustive: never = failureClass;
      return exhaustive;
    }
  }
}

export function describeArtefactFailure(
  failure: ArtefactStepFailure | undefined,
  family: ArtefactFailureFamily,
): ArtefactFailurePresentation | undefined {
  if (!failure) return undefined;
  const heading =
    failure.code === 'playground.pipeline.not-executed' ? 'Not executed' : headingForKnownClass(failure.class, family);
  return {
    heading,
    message: failure.message,
    remediation: failure.remediation,
  };
}
