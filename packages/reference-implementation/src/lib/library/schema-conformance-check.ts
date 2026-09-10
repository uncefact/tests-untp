import {
  validateAgainstSchemas,
  validateJsonLd,
  describeJsonLdFailure,
  JsonLdValidationError,
  SchemaCompilationFailedError,
  SchemaFetchFailedError,
  SchemaPayloadError,
} from '@uncefact/untp-utils/validation';
import {
  createJsonLdDocumentLoader,
  type BundledFallbackOptions,
  type SchemaLoader,
} from '@uncefact/untp-utils/loaders';
import type { TtlCache } from '@uncefact/untp-utils/cache';
import type { LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import { buildUntpArtefactUrls } from '@uncefact/untp-utils/artefacts';
import {
  decodeCredential,
  type EnvelopedVerifiableCredential,
  type UNTPVerifiableCredential,
} from '@uncefact/untp-ri-services';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';
import { CheckResult, CoreCredentialType, CredentialDetailsStatus } from '@/lib/prisma/generated';
import { contextCache } from '@/lib/credentials/context-cache';
import { bundledArtefactsFallback, schemaLoader } from '@/lib/credentials/schema-loader';
import { bridgeNameOf } from './core-credential-type';
import { apiLogger } from '@/lib/api/logger';

const MAX_MESSAGE_LENGTH = 1_024;
const TRUNCATION_MARKER = '...';
/**
 * Fixed explanations for the document fault codes rejected by jsonld.js safe
 * mode. The classifier's detail is safe for display in some consumers, but
 * its allowlisted fields can still carry values from the credential, so this
 * persisted message uses only these fixed explanations.
 * Unrecognised document codes, including future syntax diagnostics, use the
 * generic message below.
 *
 * @see https://github.com/digitalbazaar/jsonld.js/blob/v8.3.3/lib/events.js#L103-L129
 */
const JSON_LD_DOCUMENT_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  'empty object': 'Empty JSON-LD object found.',
  'free-floating scalar': 'Free-floating JSON-LD scalar found.',
  'invalid @language value': 'Invalid JSON-LD @language value found.',
  'invalid property': 'Invalid JSON-LD property found.',
  'null @id value': 'Null JSON-LD @id value found.',
  'null @value value': 'Null JSON-LD @value found.',
  'object with only @id': 'JSON-LD object with only @id found.',
  'object with only @language': 'JSON-LD object with only @language found.',
  'object with only @list': 'JSON-LD object with only @list found.',
  'object with only @value': 'JSON-LD object with only @value found.',
  'relative @id reference': 'Relative @id reference found.',
  'relative @type reference': 'Relative @type reference found.',
  'relative @vocab reference': 'Relative @vocab reference found.',
  'reserved @id value': 'Reserved @id value found.',
  'reserved @reverse value': 'Reserved @reverse value found.',
  'reserved term': 'Reserved JSON-LD term found.',
  'blank node predicate': 'Blank node predicate found.',
  'relative graph reference': 'Relative graph reference found.',
  'relative object reference': 'Relative object reference found.',
  'relative predicate reference': 'Relative predicate reference found.',
  'relative subject reference': 'Relative subject reference found.',
  'rdfDirection not set': 'JSON-LD rdfDirection is not set.',
};
const GENERIC_JSON_LD_DOCUMENT_FAILURE_MESSAGE = 'The JSON-LD document could not be expanded as valid JSON-LD.';

export type SchemaConformanceResult =
  | { result: typeof CheckResult.FAIL; message: string }
  | { result: typeof CheckResult.PASS | typeof CheckResult.NOT_RUN; message: null };

export type SchemaConformanceCheckInput = {
  recordId: string;
  detailsStatus: CredentialDetailsStatus;
  coreCredentialType: CoreCredentialType | null;
  coreDataModelVersion: string | null;
  envelope: EnvelopedVerifiableCredential;
  deadline: number;
  signal: AbortSignal;
};

export type SchemaConformanceCheckDependencies = {
  schemaLoader: SchemaLoader;
  contextCache: TtlCache<LoadedRemoteDocument>;
  bundledArtefactsFallback: BundledFallbackOptions;
  logger: LoggerService;
};

/** A loader or expansion step was not allowed to start or finish in the attempt budget. */
class SchemaConformanceStageTimeout extends Error {
  constructor() {
    super('schema conformance stage allowance exhausted');
    this.name = 'SchemaConformanceStageTimeout';
  }
}

const defaultDependencies: SchemaConformanceCheckDependencies = {
  schemaLoader,
  contextCache,
  bundledArtefactsFallback,
  logger: apiLogger.child({ module: 'schema-conformance-check' }),
};

/**
 * Checks an extracted credential against its system core schema and JSON-LD
 * expansion. Loader and validator failures are classified as advisory
 * outcomes so the worker can settle the other checks independently.
 */
export async function checkSchemaConformance(
  input: SchemaConformanceCheckInput,
  dependencies: SchemaConformanceCheckDependencies = defaultDependencies,
): Promise<SchemaConformanceResult> {
  const { recordId, detailsStatus, coreCredentialType, coreDataModelVersion, envelope, deadline, signal } = input;
  const log = dependencies.logger.child({ recordId });

  if (
    detailsStatus !== CredentialDetailsStatus.EXTRACTED ||
    coreCredentialType === null ||
    coreDataModelVersion === null
  ) {
    log.debug('Schema conformance was not run because credential details were not extracted');
    return notRun();
  }

  let payload: UNTPVerifiableCredential;
  try {
    payload = decodeCredential(envelope);
  } catch (error) {
    log.error(
      { errorName: error instanceof Error ? error.name : 'NonError' },
      'Schema conformance could not decode the extracted credential',
    );
    return notRun();
  }

  const schemaUrl = buildUntpArtefactUrls(bridgeNameOf(coreCredentialType), coreDataModelVersion).schemaUrl;
  const guardedSchemaLoader: SchemaLoader = {
    load: (url) => guardedLoad(() => dependencies.schemaLoader.load(url), deadline, signal),
  };
  const documentLoader = createJsonLdDocumentLoader({
    cache: dependencies.contextCache,
    ...dependencies.bundledArtefactsFallback,
  });
  const guardedDocumentLoader = (url: string) => guardedLoad(() => documentLoader(url), deadline, signal);

  try {
    await validateAgainstSchemas(payload, [schemaUrl], guardedSchemaLoader);
  } catch (error) {
    if (hasStageTimeout(error)) return stageNotRun(log, 'schema', signal);
    if (error instanceof SchemaPayloadError) {
      const first = error.failures[0];
      return first === undefined
        ? failed('the schema validator reported a violation without a location')
        : failed(first.pointer || '/', first.message);
    }
    if (error instanceof SchemaFetchFailedError || error instanceof SchemaCompilationFailedError) {
      log.warn(
        { schemaOrigin: originOf(schemaUrl), errorName: error.name },
        'Schema conformance could not obtain a usable schema',
      );
      return notRun();
    }
    throw error;
  }

  if (Date.now() >= deadline || signal.aborted) return stageNotRun(log, 'JSON-LD', signal);

  try {
    await validateJsonLd(payload, { documentLoader: guardedDocumentLoader });
    return { result: CheckResult.PASS, message: null };
  } catch (error) {
    if (hasStageTimeout(error)) return stageNotRun(log, 'JSON-LD', signal);
    if (error instanceof JsonLdValidationError) {
      const failure = describeJsonLdFailure(error);
      if (failure.kind === 'document') {
        return failed(
          JSON_LD_DOCUMENT_FAILURE_MESSAGES[failure.code ?? ''] ?? GENERIC_JSON_LD_DOCUMENT_FAILURE_MESSAGE,
          failure.code,
        );
      }
      const diagnostic = failure.url
        ? {
            stage: 'JSON-LD',
            contextOrigin: originOf(failure.url),
            ...(failure.code ? { errorCode: failure.code } : {}),
          }
        : {
            stage: 'JSON-LD',
            ...(failure.code ? { errorCode: failure.code } : {}),
            ...(failure.kind === 'context-invalid' && 'fields' in failure && failure.fields
              ? { fields: failure.fields }
              : {}),
          };
      log.warn({ ...diagnostic }, 'JSON-LD context could not be obtained or used for schema conformance');
      return notRun();
    }
    throw error;
  }
}

function notRun(): { result: typeof CheckResult.NOT_RUN; message: null } {
  return { result: CheckResult.NOT_RUN, message: null };
}

function failed(detail: string, code?: string): { result: typeof CheckResult.FAIL; message: string } {
  return { result: CheckResult.FAIL, message: boundMessage(code ? `${detail} (${code})` : detail) };
}

function stageNotRun(
  logger: LoggerService,
  stage: string,
  signal: AbortSignal,
): { result: typeof CheckResult.NOT_RUN; message: null } {
  logger.warn(
    { stage, reason: signal.aborted ? 'aborted' : 'deadline' },
    'Schema conformance stage allowance was exhausted',
  );
  return notRun();
}

function boundMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_MESSAGE_LENGTH - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function guardedLoad<T>(load: () => Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
  if (Date.now() >= deadline || signal.aborted) throw new SchemaConformanceStageTimeout();
  return load();
}

function hasStageTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current)) {
    if (current instanceof SchemaConformanceStageTimeout) return true;
    seen.add(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
