import {
  validateAgainstSchemas,
  validateJsonLd,
  describeJsonLdFailure,
  JsonLdValidationError,
  SchemaCompilationFailedError,
  SchemaFetchFailedError,
  SchemaPayloadError,
  SchemaValidationError,
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

export type SchemaConformanceResult = { result: CheckResult; message: string | null };

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
  const guardedDocumentLoader = createJsonLdDocumentLoader({
    cache: dependencies.contextCache,
    ...dependencies.bundledArtefactsFallback,
  });
  const guardedJsonLdDocumentLoader = (url: string) => guardedLoad(() => guardedDocumentLoader(url), deadline, signal);

  try {
    await validateAgainstSchemas(payload, [schemaUrl], guardedSchemaLoader);
  } catch (error) {
    if (hasStageTimeout(error)) return stageNotRun(log, 'schema');
    if (error instanceof SchemaPayloadError) {
      const first = error.failures[0];
      return failed(first.pointer || '/', first.message);
    }
    if (error instanceof SchemaFetchFailedError || error instanceof SchemaCompilationFailedError) {
      log.warn(
        { schemaOrigin: originOf(schemaUrl), errorName: error.name },
        'Schema conformance could not obtain a usable schema',
      );
      return notRun();
    }
    if (error instanceof SchemaValidationError) throw error;
    throw error;
  }

  if (Date.now() >= deadline || signal.aborted) return stageNotRun(log, 'JSON-LD');

  try {
    await validateJsonLd(payload, { documentLoader: guardedJsonLdDocumentLoader });
    return { result: CheckResult.PASS, message: null };
  } catch (error) {
    if (hasStageTimeout(error)) return stageNotRun(log, 'JSON-LD');
    if (error instanceof JsonLdValidationError) {
      const failure = describeJsonLdFailure(error);
      if (failure.kind === 'document') {
        return failed(failure.detail, failure.code);
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
            ...('source' in failure && failure.source ? { source: failure.source } : {}),
          };
      log.warn({ ...diagnostic }, 'JSON-LD context could not be obtained or used for schema conformance');
      return notRun();
    }
    throw error;
  }
}

function notRun(): SchemaConformanceResult {
  return { result: CheckResult.NOT_RUN, message: null };
}

function failed(detail: string, code?: string): SchemaConformanceResult {
  return { result: CheckResult.FAIL, message: boundMessage(code ? `${detail} (${code})` : detail) };
}

function stageNotRun(logger: LoggerService, stage: string): SchemaConformanceResult {
  logger.warn({ stage }, 'Schema conformance stage allowance was exhausted');
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
