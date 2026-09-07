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
  DuplicateCredentialError,
  findExternalByContentDigest,
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
import { safeError } from '@/lib/api/safe-error';
import {
  captureExternalDetails,
  readExternalArtefact,
  type ArtefactReading,
  type OpenedContent,
} from './external-artefact';
import { contentDigestOf } from './content-digest';

/**
 * The in-request half of registering a credential received from a third
 * party (#955): the guarded fetch, the decrypt with the supplier's key, the
 * extraction, the content-identity lookup that refuses a credential the
 * tenant already holds (#956), the durable-copy store, and the one
 * transaction that writes the record with its generation 1 check run
 * (ADR-053, ADR-054 decision 4). Only the verifier call runs later, on the
 * worker, against the copy stored here. Every outcome of the discovery
 * contract's register table is a branch of {@link settleInRequest}, which is
 * the single place a row's checks, failure, custody and details are
 * assembled together, and which re-verification reuses in `recover` mode.
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
  /**
   * Returns the external record in this tenant already holding this content
   * identity, excluding `currentRecordId` so a recovery never matches itself.
   */
  findExistingExternal: (tenantId: string, contentDigest: string, currentRecordId?: string) => Promise<string | null>;
};

export function defaultRegisterDependencies(
  enqueueVerification: RegisterExternalCredentialDependencies['enqueueVerification'],
): RegisterExternalCredentialDependencies {
  return {
    fetchDocument: (href) => fetchCredentialDocument(href),
    resolveStorage: (tenantId) => resolveStorageService(tenantId),
    assertEncryptionReady: () => {
      getEncryptionService();
    },
    enqueueVerification,
    persist: createExternalCredential,
    findExistingExternal: findExternalByContentDigest,
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

/** A new registration. A refused source and a content match both stop the request. */
export type RegisterModeOptions = { mode: 'register' };

/**
 * A re-verification of an existing record. Both of those are outcomes to
 * record rather than reasons to stop, and the record being recovered is
 * excluded from the content lookup so its own content never reads as a
 * duplicate of itself.
 */
export type RecoverModeOptions = {
  mode: 'recover';
  currentRecordId: string;
  /**
   * Whether the reservation's snapshot of this record already held a content
   * identity (`contentDigest` or `duplicateOfRecordId`) before this fetch
   * ran. A response that does not open a credential is never allowed to
   * replace that identity, so when this is true, storing such a response at
   * all is pointless work the finaliser will only discard and orphan-log;
   * the store is skipped instead. A record with no identity to protect
   * (`false`) still stores a non-credential response, exactly as
   * registration does.
   */
  holdsIdentity: boolean;
};

/** Who is calling {@link settleInRequest}, and what that mode needs from them. */
export type SettleInRequestOptions = RegisterModeOptions | RecoverModeOptions;

export async function registerExternalCredential(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
): Promise<ExternalCredentialRecord> {
  const outcome = await settleInRequest(input, deps, { mode: 'register' });
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
          error: safeError(error),
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
 * A fetch that returned nothing, so there is no digest and no observation,
 * and `encrypted` stays null rather than claiming a body was seen.
 */
export type UnobservedOutcome = {
  encrypted: null;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
  sourceDigest?: undefined;
  contentKind?: undefined;
  storage?: undefined;
  decryptionKeyUnused?: undefined;
  contentDigest?: undefined;
  duplicateOfRecordId?: undefined;
  observedContentDigest?: undefined;
  storageSkipped?: undefined;
};

/**
 * A body that was reached and is not a signed credential, so there is no
 * signed artefact to take an identity from and nothing it can duplicate.
 */
export type NonCredentialOutcome = {
  sourceDigest: string;
  encrypted: boolean;
  contentKind: typeof ExternalContentKind.JSON_OBJECT | typeof ExternalContentKind.OPAQUE;
  decryptionKeyUnused: boolean;
  contentDigest?: undefined;
  duplicateOfRecordId?: undefined;
  observedContentDigest?: undefined;
  storage?: ExternalStorageInput;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
  /**
   * Set only in `recover` mode, only when the reservation's own identity
   * snapshot already held a content identity, so storing this response was
   * skipped as pointless work the finaliser would only discard. The
   * finaliser re-reads identity at commit time under its own lock: if it has
   * since been cleared (a concurrent write during the fetch), this marker is
   * what tells the finaliser its stored failure was never actually earned by
   * an identity conflict, and to settle a moved-identity failure instead of
   * consuming this one.
   */
  storageSkipped?: 'identity-held';
};

/**
 * A signed credential this request opened. It carries the content identity
 * unless another record in the tenant already holds it, in which case the
 * identity stays with that record and `duplicateOfRecordId` names it.
 *
 * The duplicate arm also reports `observedContentDigest`, the identity this
 * request computed, which is never written to the advisory row. It is what
 * the recover caller revalidates against. At commit, under its own lock, that
 * caller confirms the named record still holds `observedContentDigest`. If it
 * no longer does, the caller resolves the current holder by tenant and digest,
 * excluding itself, and points at that row instead. If nobody holds it, the
 * caller persists the digest with no pointer. A recover collision is never
 * routed through `createExternalCredential`, whose collision mapping answers
 * a registration rather than a recovery.
 */
export type CredentialOutcome = {
  sourceDigest: string;
  encrypted: boolean;
  contentKind: typeof ExternalContentKind.CREDENTIAL;
  decryptionKeyUnused: boolean;
  storage?: ExternalStorageInput;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
  /** A successfully opened credential is never skipped: it always attempts to store, or fails storing genuinely. */
  storageSkipped?: undefined;
} & (
  | { contentDigest?: string; duplicateOfRecordId?: undefined; observedContentDigest?: undefined }
  | { contentDigest?: undefined; duplicateOfRecordId: string; observedContentDigest: string }
);

/**
 * The fields of the create input that depend on how far the in-request work
 * got, closed per branch: every branch that fetched states its digest, what
 * it observed, what kind of body it was and whether a key went unused, so no
 * branch can leave one of those to a default it did not choose.
 *
 * `duplicateOfRecordId` is written straight onto the record, and
 * `observedContentDigest` is not a create-input field at all. Only `recover`
 * mode produces either, so a registration is typed never to receive one.
 */
export type InRequestOutcome = UnobservedOutcome | NonCredentialOutcome | CredentialOutcome;

/** What `register` mode returns. No branch of it points at another record. */
export type RegisterInRequestOutcome =
  | UnobservedOutcome
  | NonCredentialOutcome
  | (Omit<CredentialOutcome, 'contentDigest' | 'duplicateOfRecordId' | 'observedContentDigest'> & {
      contentDigest?: string;
      duplicateOfRecordId?: undefined;
      observedContentDigest?: undefined;
    });

/** What `recover` mode returns, the duplicate pointer included. */
export type RecoverInRequestOutcome = InRequestOutcome;

const pendingDetails: ExternalDetailsCapture = { status: CredentialDetailsStatus.EXTRACTION_PENDING };

/**
 * Walks the register outcome table, one branch per row, and returns the
 * whole row-dependent part of the record at once so no branch can leave a
 * field to a default it did not choose.
 *
 * `mode` says who is calling. In `register` mode two branches stop the
 * request and both throw, a source the guard refused and content already
 * registered in the tenant. In `recover` mode both come back as outcomes
 * instead, because a record already exists and the caller is updating it. A
 * recovered record that matches another still fetches, stores and records a
 * run. What it gives up is the content identity, which stays with the record
 * that already holds it and is named on the outcome as `duplicateOfRecordId`.
 */
export async function settleInRequest(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: RegisterModeOptions,
): Promise<RegisterInRequestOutcome>;
export async function settleInRequest(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: RecoverModeOptions,
): Promise<RecoverInRequestOutcome>;
export async function settleInRequest(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: SettleInRequestOptions,
): Promise<InRequestOutcome> {
  const { tenantId, sourceUrl } = input;

  let document: FetchedDocument;
  try {
    document = await deps.fetchDocument(sourceUrl);
  } catch (error) {
    if (!(error instanceof CredentialDocumentFetchError)) throw error;
    if (error.failure.kind === 'rejected') {
      if (options.mode === 'recover') {
        logger.warn(
          { tenantId, source: originOf(sourceUrl), reason: error.failure.reason },
          'The stored source was refused by the guard on re-verification',
        );
        return {
          encrypted: null,
          details: pendingDetails,
          checkRun: failedRun(
            { retrieval: CheckResult.FAIL },
            {
              code: CheckRunFailureCode.RETRIEVAL_FAILED,
              message: error.failure.error.message,
              retryable: false,
            },
          ),
        };
      }
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
    return settleUnopened(reading, sourceDigest, document, tenantId, sourceUrl, deps, options);
  }

  const { content, encrypted, keyUnused } = reading;
  const details = detailsOf(content, sourceUrl);
  const contentDigest = await contentDigestOf(content);

  let duplicateOfRecordId: string | undefined;
  if (contentDigest !== undefined) {
    const existingRecordId = await deps.findExistingExternal(
      tenantId,
      contentDigest,
      options.mode === 'recover' ? options.currentRecordId : undefined,
    );
    if (existingRecordId !== null) {
      logger.info(
        { tenantId, source: originOf(sourceUrl), existingRecordId },
        'Credential content is already registered',
      );
      if (options.mode === 'register') throw new DuplicateCredentialError(existingRecordId);
      duplicateOfRecordId = existingRecordId;
    }
  }
  const identity = identityOf(content, contentDigest, duplicateOfRecordId);

  const decryption = encrypted ? CheckResult.PASS : CheckResult.NOT_RUN;
  // The contract's digest check belongs to the signed form; a body that is
  // not a credential has none to digest, so the check did not apply.
  const digest = content.kind === ExternalContentKind.CREDENTIAL ? CheckResult.PASS : CheckResult.NOT_RUN;

  // A response that did not open the credential this row's reservation
  // already held an identity for is rejected by the finaliser regardless of
  // what this function returns (the fetched-content rule keeps that
  // identity, custody and details exactly as they were). Storing this body
  // anyway, only to have the finaliser discard it and log an orphan, is a
  // storage object every re-verify of a permanently wrong source repeats
  // forever. Skipped here instead, before the preflight even runs, since
  // there is nothing left for that preflight to protect: case (c) (no
  // identity to protect) still stores, exactly as a fresh registration
  // would.
  if (options.mode === 'recover' && options.holdsIdentity && content.kind !== ExternalContentKind.CREDENTIAL) {
    return {
      sourceDigest,
      encrypted,
      // Not `...identity`: `identity`'s static type is the full
      // `ObservedContentIdentity` union (computed once, above, before this
      // branch's own narrower guard), so spreading it here would carry the
      // credential-shaped arm's type along with it even though `content.kind`
      // is confirmed non-credential in this exact branch. `identityOf`
      // returns exactly `{ contentKind: content.kind }` for a non-credential
      // body, so stating that directly is both correct and properly narrowed.
      contentKind: content.kind,
      decryptionKeyUnused: keyUnused,
      details,
      storageSkipped: 'identity-held',
      // The finaliser's rejected-replacement branch always takes over an
      // outcome shaped this way (`holdsIdentity` true, a non-credential
      // `contentKind`) and settles its own failure from
      // `rejectedReplacementFailure`, never reading this one, UNLESS the row's
      // identity has since been cleared, in which case `storageSkipped`
      // above tells the finaliser to settle a moved-identity failure instead;
      // this checkRun exists only to satisfy the outcome type with something
      // honest rather than a fabricated success.
      checkRun: failedRun(
        { retrieval: CheckResult.PASS, decryption, digest },
        {
          code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
          message: 'The re-fetched source did not return the credential this record already holds.',
          retryable: true,
        },
      ),
    };
  }

  // The D10 preflight, immediately before the one store that asks the
  // storage service for a key; a failure here creates no record. Keeping it
  // after the duplicate check means a duplicate answers 409 even where this
  // deployment's encryption key is misconfigured.
  try {
    deps.assertEncryptionReady();
  } catch (error) {
    throw new EncryptionUnavailableError(error);
  }

  const stored = await storeOpened(content, document, tenantId, sourceUrl, deps);
  if (stored.outcome === 'failed') {
    return {
      sourceDigest,
      encrypted,
      ...identity,
      decryptionKeyUnused: keyUnused,
      details,
      checkRun: failedRun({ retrieval: CheckResult.PASS, decryption }, openedStorageFailure(stored.failure, encrypted)),
    };
  }
  return {
    sourceDigest,
    encrypted,
    ...identity,
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
 * What the observed body says about content identity. A signed credential
 * carries the identity, or gives it up to the record already holding it and
 * names that record instead, reporting the identity it observed so the caller
 * can revalidate the pointer before writing it. The digest column and the
 * pointer are exclusive, in the type and in the database. A body that is not
 * a credential carries neither.
 */
type ObservedContentIdentity =
  | {
      contentKind: typeof ExternalContentKind.CREDENTIAL;
      contentDigest?: string;
      duplicateOfRecordId?: undefined;
      observedContentDigest?: undefined;
    }
  | {
      contentKind: typeof ExternalContentKind.CREDENTIAL;
      contentDigest?: undefined;
      duplicateOfRecordId: string;
      observedContentDigest: string;
    }
  | {
      contentKind: typeof ExternalContentKind.JSON_OBJECT | typeof ExternalContentKind.OPAQUE;
      contentDigest?: undefined;
      duplicateOfRecordId?: undefined;
      observedContentDigest?: undefined;
    };

function identityOf(
  content: OpenedContent,
  contentDigest: string | undefined,
  duplicateOfRecordId: string | undefined,
): ObservedContentIdentity {
  if (content.kind !== ExternalContentKind.CREDENTIAL) return { contentKind: content.kind };
  if (duplicateOfRecordId !== undefined && contentDigest !== undefined) {
    return { contentKind: content.kind, duplicateOfRecordId, observedContentDigest: contentDigest };
  }
  return { contentKind: content.kind, ...(contentDigest === undefined ? {} : { contentDigest }) };
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
  options: SettleInRequestOptions,
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

  // An identity-holding row's reservation is refused by the finaliser
  // regardless of what this returns (unopened ciphertext never replaces an
  // existing identity), so storing it here would only be discarded and
  // orphan-logged. Skipped for the same reason the opened-but-not-a-credential
  // case is skipped above: case (c), no identity to protect, still stores.
  if (options.mode === 'recover' && options.holdsIdentity) {
    return { ...base, storageSkipped: 'identity-held', checkRun: failedRun(checks, decryptionFailure) };
  }

  const stored = await storeAsFetched(reading.bytes, document, false, tenantId, sourceUrl, deps);
  if (stored.outcome === 'failed') {
    // Two failures on one row: no copy was written, and this service holds
    // no key to open one anyway. STORAGE_FAILED wins the code, retryable
    // flag and outcome, unchanged from before; only the message text below
    // is composed for this branch. A re-verify of this row (once it holds no
    // identity, this branch's premise) fetches again and, once storage
    // recovers, keeps the ciphertext copy as fetched; it still cannot open
    // it, because a re-fetch supplies no key. Supplying one needs the
    // key-bearing route this service does not offer yet (#958).
    return {
      ...base,
      checkRun: failedRun(checks, {
        ...stored.failure,
        // Not `${stored.failure.message} ...`: that generic text (shared with
        // the plaintext storage-failure path, which this branch must not
        // touch) says a re-verify will store the copy. For an encrypted
        // record that is false, so this message is composed fresh instead of
        // built on top of it, from two local helpers that keep the storage
        // refusal-versus-outage distinction and name the right key cause for
        // whichever of the three unopened readings this is.
        message: `${unstoredCopyCause(stored.failure)} ${unopenedKeyCause(
          reading,
        )} Re-verification will fetch again and, once storage succeeds, will keep the fetched copy; it still cannot open that copy until a key can be supplied (#958).`,
      }),
    };
  }
  return { ...base, storage: stored.storage, checkRun: failedRun(checks, decryptionFailure) };
}

/**
 * The storage half of an unopened row's message. Keeps the refusal and outage
 * distinction that `store()` draws, composed fresh here because the generic
 * text does not name the key problem this row also has.
 */
function unstoredCopyCause(failure: CheckRunFailure): string {
  return failure.retryable
    ? 'The durable copy could not be written to storage.'
    : 'The storage service refused the durable copy (its upload rules do not accept this content), and an operator must allow it before any copy can be stored.';
}

/** The key half, without the stored-copy path's "the copy is kept as fetched". */
function unopenedKeyCause(reading: Exclude<ArtefactReading, { outcome: 'opened' }>): string {
  if (reading.outcome === 'encrypted-no-key')
    return 'This credential is also encrypted and this service holds no key that opens it.';
  if (reading.reason === 'key-mismatch') return 'The supplied decryption key also did not open this credential.';
  return 'This encrypted envelope is also corrupted, so no key will open it unless the source changes.';
}

/**
 * A credential this request just opened failed to store. The plaintext
 * message is unchanged (a plain re-fetch by re-verify can recover it). An
 * opened-with-key credential is different: recover mode never supplies a
 * key, so once this attempt's own decrypted bytes are gone (nothing was
 * stored), a later re-fetch of this still-encrypted source produces only
 * unopenable ciphertext again, and by then the fetched-content rule treats
 * that unopened ciphertext as a response that did not open a credential,
 * refusing to replace whatever identity this row may hold by then rather
 * than storing it. Recovering it needs the source to start serving
 * plaintext, or the key-bearing route this service does not offer yet
 * (#958).
 */
function openedStorageFailure(failure: CheckRunFailure, encrypted: boolean): CheckRunFailure {
  if (!encrypted) return failure;
  return {
    ...failure,
    message: `${unstoredCopyCause(
      failure,
    )} This credential was opened with a supplied key, but a re-fetch by re-verify cannot supply one again, so it can only recover this record once the source serves plaintext or a key-bearing route exists (#958).`,
  };
}

/**
 * Which of the three encrypted rows this is: no key at all, a key that did
 * not open the envelope, or an envelope too damaged for any key. Only the
 * last is terminal. The other two are retryable because a later attempt with
 * the right key would succeed, not because this release offers a way to
 * supply one. The messages say so rather than naming a route that refuses
 * every body it is given.
 */
function decryptionFailureOf(reading: Exclude<ArtefactReading, { outcome: 'opened' }>): CheckRunFailure {
  if (reading.outcome === 'encrypted-no-key') {
    return {
      code: CheckRunFailureCode.DECRYPTION_REQUIRED,
      message:
        'The fetched credential is encrypted and this service holds no key that opens it. The copy is kept as fetched. Supplying a key later is not supported yet.',
      retryable: true,
    };
  }
  if (reading.reason === 'key-mismatch') {
    return {
      code: CheckRunFailureCode.DECRYPTION_FAILED,
      message:
        'The supplied decryption key did not open the fetched credential. The copy is kept as fetched. Supplying a key later is not supported yet.',
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
    // the record exists, its digest is kept, and a bodyless re-verify fetches
    // again to recover it, except when the fetched content is encrypted: a
    // re-verify still fetches again and keeps the ciphertext copy once
    // storage recovers, but it cannot open it, because a re-fetch supplies
    // no key; recovering it needs the key-bearing route this service does
    // not offer yet (#958). A refusal (the service rejected the content,
    // typically a content type its upload allowlist does not carry) is not
    // an outage: the same request fails the same way until an operator
    // changes the service.
    logger.error(
      { error: safeError(error), tenantId, source: originOf(sourceUrl) },
      'Durable copy could not be stored',
    );
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
        error: safeError(error),
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
