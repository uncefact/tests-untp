import { randomUUID } from 'node:crypto';
import { StoragePayloadError, type IStorageService, type StorageRecord } from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
  type CoreCredentialType,
} from '@/lib/prisma/generated';
import {
  createExternalCredential,
  type CreateExternalCredentialInput,
  type ExternalCredentialRecord,
  type ExternalDetailsCapture,
  type ExternalStorageInput,
  type InitialCheckRunInput,
  type VerifyJobReference,
} from '@/lib/prisma/repositories/external-credential.repository';
import type { CheckRunFailure } from '@/lib/prisma/repositories/check-run.repository';
import {
  CredentialDocumentFetchError,
  fetchCredentialDocument,
  getMaxCredentialSize,
  isRetryable,
  type DocumentFetchFailure,
  type FetchedDocument,
} from '@/lib/credentials/fetch-credential-document';
import { protectDecryptionKey, type ProtectedDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { resolveStorageService } from '@/lib/services/resolve-storage-service';
import type { SqlExecutor } from '@/lib/jobs/types';
import { apiLogger } from '@/lib/api/logger';
import {
  captureExternalDetails,
  readExternalArtefact,
  type ArtefactReading,
  type OpenedContent,
} from './external-artefact';

/**
 * The in-request half of registering a credential received from a third
 * party (#955): the guarded fetch, the decrypt with the supplier's key, the
 * extraction, the durable-copy store, and the one transaction that writes
 * the record with its generation 1 check run (ADR-053, ADR-054 decision 4).
 * Only the verifier call runs later, on the worker, against the copy stored
 * here. Every outcome of the discovery contract's register table is a branch
 * of {@link settleInRequest}, which is the single place a row's checks,
 * failure, custody and details are assembled together.
 *
 * The supplier's key crosses this module as an argument only: it is never
 * written, logged or enqueued (ADR-055 decision 1).
 */

const logger = apiLogger.child({ module: 'register-external-credential' });

export type RegisterExternalCredentialInput = {
  tenantId: string;
  /** A canonical WHATWG href the route has already validated as http(s) without userinfo. */
  sourceUrl: string;
  decryptionKey?: string;
  annotations: {
    displayName: string;
    declaredCredentialType: CoreCredentialType;
    dateReceived?: Date;
    notes?: string;
  };
  /** The LIBRARY_REGISTER claim the route holds, linked in the record's transaction. */
  idempotencyClaimId?: string;
};

/** Everything this pipeline reaches outside the process, injectable so tests can substitute each. */
export type RegisterExternalCredentialDependencies = {
  fetchDocument: (href: string) => Promise<FetchedDocument>;
  resolveStorage: (tenantId: string) => Promise<{ service: IStorageService; instanceId: string }>;
  /**
   * The D10 preflight: throws when this service cannot protect the key the
   * storage service is about to return. Runs before any store that asks for
   * encryption, never before the fetch.
   */
  assertEncryptionReady: () => void;
  /** Enqueues the verify job for a pending generation, inside the record's transaction. */
  enqueueVerification: (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;
  persist: (input: CreateExternalCredentialInput) => Promise<ExternalCredentialRecord>;
};

export function defaultRegisterDependencies(
  enqueueVerification: RegisterExternalCredentialDependencies['enqueueVerification'],
): RegisterExternalCredentialDependencies {
  return {
    fetchDocument: (href) => fetchCredentialDocument(href, { maxBytes: getMaxCredentialSize(), timeoutMs: 10_000 }),
    resolveStorage: (tenantId) => resolveStorageService(tenantId),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification,
    persist: createExternalCredential,
  };
}

/**
 * The guard refused to make the request: a malformed URL, or a scheme or
 * destination that is not permitted. The route answers 400 and no record
 * exists, per the contract's deterministic-reject row.
 */
export class SourceRejectedError extends Error {
  readonly failure: Extract<DocumentFetchFailure, { kind: 'rejected' }>;

  constructor(failure: Extract<DocumentFetchFailure, { kind: 'rejected' }>) {
    super(failure.error.message, { cause: failure.error });
    this.name = 'SourceRejectedError';
    this.failure = failure;
  }
}

/**
 * The D10 preflight failed: this service cannot protect the key a store
 * would return. The fetch, and any decrypt, already ran; no store was
 * attempted and no record exists.
 */
export class EncryptionUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Credential storage encryption is not available.', { cause });
    this.name = 'EncryptionUnavailableError';
  }
}

/** A store that asked for encryption came back without the key it must return; the copy exists and cannot be opened. */
export class StorageKeyMissingError extends Error {
  constructor(uri: string) {
    super(`The storage service encrypted the durable copy at ${uri} but returned no decryption key`);
    this.name = 'StorageKeyMissingError';
  }
}

export async function registerExternalCredential(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
): Promise<ExternalCredentialRecord> {
  const outcome = await settleInRequest(input, deps);
  try {
    return await deps.persist({
      tenantId: input.tenantId,
      sourceUrl: input.sourceUrl,
      annotations: input.annotations,
      ...(input.idempotencyClaimId !== undefined ? { idempotencyClaimId: input.idempotencyClaimId } : {}),
      ...outcome,
    });
  } catch (error) {
    // The rows rolled back after the durable copy was written, so the copy
    // is an orphan nothing references (ADR-051 decision 6). Its coordinates
    // are logged so an operator can remove it; nothing else knows them.
    if (outcome.storage !== undefined) {
      logger.error(
        {
          err: error,
          tenantId: input.tenantId,
          storageUri: outcome.storage.uri,
          storageExternalId: outcome.storage.externalId,
          storageBucket: outcome.storage.bucket ?? null,
        },
        'Registration failed after the durable copy was stored; the copy is orphaned',
      );
    }
    throw error;
  }
}

/**
 * The fields of the create input that depend on how far the in-request work
 * got, closed per branch: a fetch that returned nothing has no digest and
 * no observation, and every branch that fetched states its digest, what it
 * observed, what kind of body it was and whether a key went unused, so no
 * branch can leave one of those to a default it did not choose.
 */
type InRequestOutcome =
  | {
      encrypted: null;
      details: ExternalDetailsCapture;
      checkRun: InitialCheckRunInput;
      sourceDigest?: undefined;
      contentKind?: undefined;
      storage?: undefined;
      decryptionKeyUnused?: undefined;
    }
  | {
      sourceDigest: string;
      encrypted: boolean;
      contentKind: ExternalContentKind;
      decryptionKeyUnused: boolean;
      storage?: ExternalStorageInput;
      details: ExternalDetailsCapture;
      checkRun: InitialCheckRunInput;
    };

const pendingDetails: ExternalDetailsCapture = { status: CredentialDetailsStatus.EXTRACTION_PENDING };

/**
 * Walks the register outcome table, one branch per row, and returns the
 * whole row-dependent part of the record at once so no branch can leave a
 * field to a default it did not choose.
 */
async function settleInRequest(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
): Promise<InRequestOutcome> {
  const { tenantId, sourceUrl } = input;

  let document: FetchedDocument;
  try {
    document = await deps.fetchDocument(sourceUrl);
  } catch (error) {
    if (!(error instanceof CredentialDocumentFetchError)) throw error;
    if (error.failure.kind === 'rejected') {
      throw new SourceRejectedError(error.failure);
    }
    // The transient and the deterministic retrieval rows: nothing observed,
    // so `encrypted` stays null and no digest exists.
    logger.warn(
      { tenantId, source: originOf(sourceUrl), reason: error.failure.reason },
      'Source could not be retrieved',
    );
    return {
      encrypted: null,
      details: pendingDetails,
      checkRun: failedRun({ retrieval: CheckResult.FAIL }, retrievalFailure(error.failure)),
    };
  }

  // Captured over the raw bytes before any decrypt, on every branch that
  // fetched (the contract's sourceDigest rule).
  const sourceDigest = (
    await MultibaseDigest.fromData(document.bytes, { algorithm: 'sha2-256', base: 'base58btc' })
  ).toString();
  const reading = readExternalArtefact(document.bytes, input.decryptionKey);

  if (reading.outcome !== 'opened') {
    return settleUnopened(reading, sourceDigest, document, tenantId, sourceUrl, deps);
  }

  // The D10 preflight, immediately before the one store that asks the
  // storage service for a key; a failure here creates no record.
  try {
    deps.assertEncryptionReady();
  } catch (error) {
    throw new EncryptionUnavailableError(error);
  }

  const { content, encrypted, keyUnused } = reading;
  const details = detailsOf(content, sourceUrl);
  const decryption = encrypted ? CheckResult.PASS : CheckResult.NOT_RUN;
  // The contract's digest check belongs to the signed form; a body that is
  // not a credential has none to digest, so the check did not apply.
  const digest = content.kind === ExternalContentKind.CREDENTIAL ? CheckResult.PASS : CheckResult.NOT_RUN;

  const stored = await storeOpened(content, document, tenantId, sourceUrl, deps);
  if (stored.outcome === 'failed') {
    return {
      sourceDigest,
      encrypted,
      contentKind: content.kind,
      decryptionKeyUnused: keyUnused,
      details,
      checkRun: failedRun({ retrieval: CheckResult.PASS, decryption }, stored.failure),
    };
  }
  return {
    sourceDigest,
    encrypted,
    contentKind: content.kind,
    storage: stored.storage,
    decryptionKeyUnused: keyUnused,
    details,
    checkRun: {
      state: CheckRunState.PENDING,
      checks: { retrieval: CheckResult.PASS, decryption, digest },
      enqueue: deps.enqueueVerification,
    },
  };
}

/**
 * The two encrypted rows the request could not open (R1): the ciphertext is
 * kept exactly as fetched with no key of ours, and the run fails with the
 * code that says whether a key was missing or did not work. No preflight
 * runs, because no storage-service key is involved.
 */
async function settleUnopened(
  reading: Exclude<ArtefactReading, { outcome: 'opened' }>,
  sourceDigest: string,
  document: FetchedDocument,
  tenantId: string,
  sourceUrl: string,
  deps: RegisterExternalCredentialDependencies,
): Promise<InRequestOutcome> {
  const decryptionFailure = decryptionFailureOf(reading);
  const base = {
    sourceDigest,
    encrypted: true,
    contentKind: ExternalContentKind.OPAQUE,
    decryptionKeyUnused: false,
    details: pendingDetails,
  };
  const checks = { retrieval: CheckResult.PASS, decryption: CheckResult.FAIL };

  const stored = await storeAsFetched(reading.bytes, document, false, tenantId, sourceUrl, deps);
  if (stored.outcome === 'failed') {
    // Two failures on one row. STORAGE_FAILED wins because its recovery (a
    // bodyless re-verify that fetches again) is the one that restores the
    // ciphertext copy; the message says the key problem is still waiting.
    return {
      ...base,
      checkRun: failedRun(checks, {
        ...stored.failure,
        message: `${stored.failure.message} ${decryptionFailure.message}`,
      }),
    };
  }
  return { ...base, storage: stored.storage, checkRun: failedRun(checks, decryptionFailure) };
}

/**
 * Which of the three encrypted rows this is: no key at all, a key that did
 * not open the envelope, or an envelope too damaged for any key. Only the
 * last is terminal, because the other two are corrected by re-verifying.
 */
function decryptionFailureOf(reading: Exclude<ArtefactReading, { outcome: 'opened' }>): CheckRunFailure {
  if (reading.outcome === 'encrypted-no-key') {
    return {
      code: CheckRunFailureCode.DECRYPTION_REQUIRED,
      message:
        'The fetched credential is encrypted and no decryption key was supplied; re-verify with a key to open it.',
      retryable: true,
    };
  }
  if (reading.reason === 'key-mismatch') {
    return {
      code: CheckRunFailureCode.DECRYPTION_FAILED,
      message: 'The supplied decryption key did not decrypt the credential; check the key and re-verify.',
      retryable: true,
    };
  }
  return {
    code: CheckRunFailureCode.DECRYPTION_FAILED,
    message:
      'The fetched encrypted envelope is corrupted and cannot be decrypted; re-supplying the key will not help unless the source changes.',
    retryable: false,
  };
}

function detailsOf(content: OpenedContent, sourceUrl: string): ExternalDetailsCapture {
  if (content.kind !== ExternalContentKind.CREDENTIAL) {
    // The artefact was reached and is not a signed credential: a read that
    // ran and found nothing to extract, which is a failure, not a pending.
    return { status: CredentialDetailsStatus.EXTRACTION_FAILED, error: CredentialDetailsError.UNREADABLE_ENVELOPE };
  }
  const { capture, reason } = captureExternalDetails(content.decoded);
  if (reason !== undefined) {
    logger.warn(
      { source: originOf(sourceUrl), reason },
      'Descriptive fields could not be extracted from the fetched credential',
    );
  }
  return capture;
}

type StoreOutcome =
  | { outcome: 'stored'; storage: ExternalStorageInput }
  | { outcome: 'failed'; failure: CheckRunFailure };

/** An opened body goes to storage protected the native way: encrypted by the storage service, whose key we hold. */
async function storeOpened(
  content: OpenedContent,
  document: FetchedDocument,
  tenantId: string,
  sourceUrl: string,
  deps: RegisterExternalCredentialDependencies,
): Promise<StoreOutcome> {
  if (content.kind === ExternalContentKind.CREDENTIAL) {
    return store(tenantId, sourceUrl, deps, true, (service) => service.store(content.credential, true));
  }
  return storeAsFetched(content.bytes, document, true, tenantId, sourceUrl, deps);
}

async function storeAsFetched(
  bytes: Uint8Array,
  document: FetchedDocument,
  encrypt: boolean,
  tenantId: string,
  sourceUrl: string,
  deps: RegisterExternalCredentialDependencies,
): Promise<StoreOutcome> {
  const contentType = document.contentType?.split(';')[0].trim() || 'application/octet-stream';
  const filename = `${randomUUID()}.${extensionFor(contentType)}`;
  return store(tenantId, sourceUrl, deps, encrypt, (service) =>
    service.storeBinary(bytes, filename, contentType, encrypt),
  );
}

async function store(
  tenantId: string,
  sourceUrl: string,
  deps: RegisterExternalCredentialDependencies,
  encrypt: boolean,
  write: (service: IStorageService) => Promise<StorageRecord>,
): Promise<StoreOutcome> {
  // Resolving the tenant's storage service is configuration, not a store: a
  // tenant with no usable instance is the registry's own error (a 500 with
  // no record), never a "retry once storage recovers" row.
  const resolved = await deps.resolveStorage(tenantId);
  let record: StorageRecord;
  try {
    record = await write(resolved.service);
  } catch (error) {
    // Any failure to write the copy is the contract's STORAGE_FAILED row:
    // the record exists, its digest is kept, and recovery fetches again.
    // A refusal (the service rejected the content, typically a content type
    // its upload allowlist does not carry) is not an outage: the same
    // request fails the same way until an operator changes the service.
    logger.error({ err: error, tenantId, source: originOf(sourceUrl) }, 'Durable copy could not be stored');
    const refused = error instanceof StoragePayloadError;
    return {
      outcome: 'failed',
      failure: {
        code: CheckRunFailureCode.STORAGE_FAILED,
        message: refused
          ? 'The storage service refused the durable copy (its upload rules do not accept this content); an operator must allow it before a re-verify can store it.'
          : 'The durable copy could not be written to storage; retry via re-verify once storage recovers.',
        retryable: !refused,
      },
    };
  }
  if (encrypt && record.decryptionKey === undefined) {
    // The copy exists and nothing will reference it: the same orphan line
    // the persist failure writes, so an operator can find and remove it.
    logger.error(
      { tenantId, storageUri: record.uri, storageExternalId: record.externalId, storageBucket: record.bucket ?? null },
      'Storage encrypted the durable copy but returned no key; the copy is orphaned',
    );
    throw new StorageKeyMissingError(record.uri);
  }
  let decryptionKey: ProtectedDecryptionKey | undefined;
  try {
    decryptionKey = protectDecryptionKey(record.decryptionKey);
  } catch (error) {
    // The copy exists and its key could not be protected, so nothing will
    // reference it: the same orphan line as every other post-store failure.
    logger.error(
      {
        err: error,
        tenantId,
        storageUri: record.uri,
        storageExternalId: record.externalId,
        storageBucket: record.bucket ?? null,
      },
      'The durable copy was stored but its key could not be protected; the copy is orphaned',
    );
    throw error;
  }
  return {
    outcome: 'stored',
    storage: {
      uri: record.uri,
      digestMultibase: record.digestMultibase,
      serviceInstanceId: resolved.instanceId,
      externalId: record.externalId,
      ...(record.bucket !== undefined ? { bucket: record.bucket } : {}),
      ...(decryptionKey !== undefined ? { decryptionKey } : {}),
    },
  };
}

/** The origin alone: a supplier's link may carry a capability token, which belongs with the record, not the log. */
function originOf(sourceUrl: string): string {
  return new URL(sourceUrl).origin;
}

function extensionFor(contentType: string): string {
  if (contentType.endsWith('json')) return 'json';
  if (contentType === 'text/html') return 'html';
  if (contentType.startsWith('text/')) return 'txt';
  return 'bin';
}

function failedRun(checks: InitialCheckRunInput['checks'], failure: CheckRunFailure): InitialCheckRunInput {
  return { state: CheckRunState.FAILED, checks, failure };
}

/**
 * The RETRIEVAL_FAILED failure for a fetch that ran and did not return a
 * body, in the caller's terms: which refusal it was, and whether the same
 * request may succeed later (the helper's retryability rule).
 */
function retrievalFailure(failure: Extract<DocumentFetchFailure, { kind: 'failed' }>): CheckRunFailure {
  const retryable = isRetryable(failure);
  const next = retryable
    ? 'Retry via re-verify once the source is reachable.'
    : 'The same request will not succeed unless the source changes.';
  return {
    code: CheckRunFailureCode.RETRIEVAL_FAILED,
    message: `${retrievalRefusal(failure)} ${next}`,
    retryable,
  };
}

/** What the fetch refused with, in the caller's terms. */
function retrievalRefusal(failure: Extract<DocumentFetchFailure, { kind: 'failed' }>): string {
  switch (failure.reason) {
    case 'dns':
      return 'The source hostname could not be resolved.';
    case 'timeout':
      return 'The request to the source timed out.';
    case 'http':
      return `The source returned HTTP ${failure.status}.`;
    case 'too-large':
      return `The source response exceeded the ${getMaxCredentialSize()}-byte limit.`;
    case 'redirects':
      return 'The source redirected too many times, or redirected without a location.';
    case 'body-unreadable':
      return 'The source response could not be read.';
    case 'network':
      return 'The source could not be reached.';
    default: {
      // A new reason in the fetch helper must be worded here before it can
      // reach a caller's failure message.
      const unhandled: never = failure;
      throw new Error(`Unhandled fetch failure reason: ${JSON.stringify(unhandled)}`);
    }
  }
}
