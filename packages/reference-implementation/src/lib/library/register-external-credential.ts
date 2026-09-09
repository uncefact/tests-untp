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
import type { AcquisitionChecks, CheckRunFailure } from '@/lib/prisma/repositories/check-run.repository';
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
import { DECRYPTION_REQUIRED_MESSAGE, STORED_COPY_KEY_MISMATCH_MESSAGE } from './reverify-messages';

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

/**
 * What every caller of the pipeline supplies, whatever it acquired the bytes
 * from. A supplier source is NOT part of it: mode B has none, and fabricating
 * one so the shape fits is how a `stored-copy:` scheme ends up in a log field
 * called `source`.
 */
export type AcquiredCredentialInput = {
  tenantId: string;
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

/** A registration, or a recovery that fetches the supplier source. Both have one. */
export type RegisterExternalCredentialInput = AcquiredCredentialInput & {
  /** A canonical WHATWG href the route has already validated as http(s) without userinfo. */
  sourceUrl: string;
};

/**
 * Where the bytes this pipeline is settling came from, and the one field name
 * their origin is logged under. A stored copy's origin is this deployment's
 * own storage service, which is a different fact from a supplier's origin and
 * is never reported as one.
 *
 * The source arm carries the digest taken over the fetched bytes, because a
 * supplier read and the digest of what it returned are one fact. Passing them
 * as two parameters made "source provenance with no digest" representable and
 * compilable, which is the shape the acquisition union was introduced to
 * remove, and it cost two non-null assertions to work around.
 */
type Provenance =
  | { mode: 'source'; sourceUrl: string; sourceDigest: string }
  | { mode: 'stored-copy'; storageUri: string };

/** The origin alone, under the field name that says which system it is. */
function provenanceLogFields(provenance: Provenance): { source: string } | { storageOrigin: string } {
  return provenance.mode === 'source'
    ? { source: originOf(provenance.sourceUrl) }
    : { storageOrigin: originOf(provenance.storageUri) };
}

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
  readonly checks?: AcquisitionChecks;

  constructor(cause: unknown, checks?: AcquisitionChecks) {
    super('Credential storage encryption is not available.', { cause });
    this.name = 'EncryptionUnavailableError';
    this.checks = checks;
  }
}

/**
 * The store threw, on a recovery, after the attempt had already earned its
 * acquisition checks. The checks travel on this class so the settlement that
 * catches it can narrow with `instanceof` and read a typed field, rather than
 * accepting any error that happens to carry a property called `checks`.
 *
 * The original throw is the `cause`, unchanged, so classification by error
 * class (a storage-configuration fault, a missing storage key) still sees
 * exactly what was thrown.
 */
export class StoreAttemptFailedError extends Error {
  readonly checks: AcquisitionChecks;
  override readonly cause: unknown;

  constructor(cause: unknown, checks: AcquisitionChecks) {
    super('The durable copy could not be stored', { cause });
    this.name = 'StoreAttemptFailedError';
    this.cause = cause;
    this.checks = checks;
  }
}

/**
 * A store that asked for encryption came back without the key it must return;
 * the copy exists and cannot be opened.
 *
 * The message reaches the caller: the recovery path copies it onto the
 * settled generation's `failureMessage`, which is published on the record. So
 * it names no coordinates. The object's storage URI, external id and bucket
 * are this deployment's own storage addresses, and they go where the person
 * who can act on them reads: the `error`-level orphan line the raising site
 * writes immediately before this is thrown.
 */
export const STORAGE_KEY_MISSING_MESSAGE =
  'The storage service encrypted the durable copy but returned no decryption key, so the copy cannot be opened; this needs an operator to inspect the storage service.';

export class StorageKeyMissingError extends Error {
  constructor() {
    super(STORAGE_KEY_MISSING_MESSAGE);
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
  /**
   * Publishes the acquisition checks this attempt has earned at the moment it
   * earns them, rather than only when preparation returns.
   *
   * Between opening the body and returning an outcome, this function awaits
   * the duplicate lookup and the store, both of which can throw. The store's
   * throw is carried by {@link StoreAttemptFailedError}; the duplicate
   * lookup's is not, and before this callback existed a lookup that rejected
   * after a successful decrypt settled a generation saying the credential was
   * never decrypted, and in mode A never even retrieved. Publishing here, one
   * statement before the lookup, means the caller's record of what this
   * attempt proved is current across every await that follows.
   *
   * The caller owns what it does with the checks; this is a typed option on
   * the recover shape, so no arbitrary error carrying a property called
   * `checks` can reach the same state. Called at most once per attempt, and
   * only on the arm that opened a body: the arms that settle without opening
   * one already return their checks on the outcome.
   */
  onAcquisitionProgress?: (checks: AcquisitionChecks) => void;
};

/** A recovery that fetches the record's supplier source (mode A). */
export type RecoverFromSourceOptions = RecoverModeOptions & { acquisition: { from: 'source' } };

/**
 * A recovery that opens the record's own reserved durable copy (mode B). The
 * document and the checks its read earned travel together in one field: a
 * document with no checks would fabricate a `retrieval: pass` no read
 * recorded, and checks with no document would silently run mode A and drop
 * them.
 */
export type RecoverFromStoredCopyOptions = RecoverModeOptions & {
  acquisition: {
    from: 'stored-copy';
    /** The reserved copy, already read. Its presence is what selects mode B. */
    document: FetchedDocument;
    /** Checks the stored read earned before the reader was called. */
    checks: AcquisitionChecks;
    /** Where the copy was read from, logged as a storage origin, never as a source. */
    storageUri: string;
  };
};

/** Who is calling {@link settleInRequest}, and what that mode needs from them. */
export type SettleInRequestOptions = RegisterModeOptions | RecoverFromSourceOptions | RecoverFromStoredCopyOptions;

export async function registerExternalCredential(
  input: RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
): Promise<ExternalCredentialRecord> {
  const outcome = await settleInRequest(input, deps, { mode: 'register' });
  const { acquisition, ...persisted } = outcome;
  try {
    return await deps.persist({
      tenantId: input.tenantId,
      sourceUrl: input.sourceUrl,
      annotations: input.annotations,
      ...(input.idempotencyClaimId !== undefined ? { idempotencyClaimId: input.idempotencyClaimId } : {}),
      ...persisted,
      // The record's `sourceDigest` column is the supplier provenance this
      // attempt observed, which only a source acquisition that returned bytes
      // has. Registration always acquires from a source, so this is the digest
      // whenever the fetch returned anything at all.
      ...(acquisition.mode === 'source' ? { sourceDigest: acquisition.sourceDigest } : {}),
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
 * How this attempt tried to reach the bytes, and what that says about
 * provenance. One required discriminated field rather than three independent
 * optionals: `mode: 'source'` with a digest is the only shape that has
 * observed a supplier, so the finaliser's `sourceDigest`, `sourceChanged` and
 * `lastSourceCheckAt` writes cannot be reached by a stored-copy attempt, and
 * a source fetch that returned nothing cannot claim a digest it never
 * computed.
 */
export type Acquisition =
  /** A supplier fetch that returned bytes, digested before any decrypt (the contract's sourceDigest rule). */
  | { mode: 'source'; sourceDigest: string }
  /** A supplier fetch that returned no bytes: the guard refused it, or it failed. */
  | { mode: 'source-failed' }
  /** A read of this record's own reserved durable copy, whether or not it returned bytes. */
  | { mode: 'stored-copy' };

/**
 * An acquisition that returned nothing, so there is no digest and no
 * observation, and `encrypted` stays null rather than claiming a body was
 * seen. Reached by a failed or refused source fetch and by a stored copy that
 * could not be read back or could not be proven intact.
 */
export type UnobservedOutcome = {
  acquisition: Acquisition;
  encrypted: null;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
  contentKind?: undefined;
  storage?: undefined;
  decryptionKeyUnused?: undefined;
  contentDigest?: undefined;
  duplicateOfRecordId?: undefined;
  observedContentDigest?: undefined;
  storageSkipped?: undefined;
};

/**
 * Bytes were reached and could not be opened, and nothing classified them.
 * This is the record's own durable copy under a key that did not work, an
 * envelope too damaged for any key, or a digest that did not match: the copy
 * stays exactly as it is and this attempt settles its own failure.
 *
 * It carries no `contentKind` on purpose. A closed envelope has not been
 * classified, and the register path's `OPAQUE` is a classification a source
 * fetch genuinely makes and genuinely writes. Stating `OPAQUE` here to
 * satisfy the union would put a fabricated content kind one guard away from
 * overwriting the record's real one.
 */
export type UnopenedStoredCopyOutcome = {
  acquisition: { mode: 'stored-copy' };
  encrypted: true;
  details: ExternalDetailsCapture;
  checkRun: InitialCheckRunInput;
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
  acquisition: Acquisition;
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
  acquisition: Acquisition;
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
export type InRequestOutcome = UnobservedOutcome | UnopenedStoredCopyOutcome | NonCredentialOutcome | CredentialOutcome;

/** What `register` mode returns. No branch of it points at another record, and none reads a stored copy. */
export type RegisterInRequestOutcome =
  | UnobservedOutcome
  | NonCredentialOutcome
  | (Omit<CredentialOutcome, 'contentDigest' | 'duplicateOfRecordId' | 'observedContentDigest'> & {
      contentDigest?: string;
      duplicateOfRecordId?: undefined;
      observedContentDigest?: undefined;
    });

/** What `recover` mode returns: the duplicate pointer and the unopened stored copy included. */
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
  options: RecoverFromSourceOptions,
): Promise<RecoverInRequestOutcome>;
export async function settleInRequest(
  input: AcquiredCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: RecoverFromStoredCopyOptions,
): Promise<RecoverInRequestOutcome>;
export async function settleInRequest(
  input: AcquiredCredentialInput | RegisterExternalCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: SettleInRequestOptions,
): Promise<InRequestOutcome> {
  const { tenantId } = input;

  if (options.mode === 'recover' && options.acquisition.from === 'stored-copy') {
    const { document, checks, storageUri } = options.acquisition;
    return settleAcquiredDocument(input, deps, options, document, { mode: 'stored-copy', storageUri }, checks);
  }

  // Every remaining caller is typed to carry a supplier source: register
  // mode, and a recovery whose reservation found no durable copy.
  const sourceUrl = (input as RegisterExternalCredentialInput).sourceUrl;
  // The origin alone is all the failure paths below need, and it is all they
  // can have: nothing has been fetched yet, so there is no digest to carry.
  const sourceOrigin = { source: originOf(sourceUrl) };

  let document: FetchedDocument;
  try {
    document = await deps.fetchDocument(sourceUrl);
  } catch (error) {
    if (!(error instanceof CredentialDocumentFetchError)) throw error;
    if (error.failure.kind === 'rejected') {
      if (options.mode === 'recover') {
        logger.warn(
          { tenantId, ...sourceOrigin, reason: error.failure.reason },
          'The stored source was refused by the guard on re-verification',
        );
        return {
          acquisition: { mode: 'source-failed' },
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
    logger.warn({ tenantId, ...sourceOrigin, reason: error.failure.reason }, 'Source could not be retrieved');
    return {
      acquisition: { mode: 'source-failed' },
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
  return settleAcquiredDocument(input, deps, options, document, { mode: 'source', sourceUrl, sourceDigest }, undefined);
}

/**
 * Processes bytes that have already been acquired. Source mode records their
 * source digest and retains the register behaviour; stored-copy mode records
 * only the checks earned by reading the reserved copy and never creates new
 * source provenance.
 */
async function settleAcquiredDocument(
  input: AcquiredCredentialInput,
  deps: RegisterExternalCredentialDependencies,
  options: SettleInRequestOptions,
  document: FetchedDocument,
  provenance: Provenance,
  acquisitionChecks: AcquisitionChecks | undefined,
): Promise<InRequestOutcome> {
  const reading = readExternalArtefact(document.bytes, input.decryptionKey);
  const acquisition: Acquisition =
    provenance.mode === 'stored-copy'
      ? { mode: 'stored-copy' }
      : { mode: 'source', sourceDigest: provenance.sourceDigest };

  if (reading.outcome !== 'opened') {
    if (provenance.mode === 'stored-copy') {
      // The copy is already durable and stays exactly as it is: no upload, no
      // content classification, no identity. The generation records only that
      // the reserved bytes were reached and would not open.
      return {
        acquisition: { mode: 'stored-copy' },
        encrypted: true,
        decryptionKeyUnused: undefined,
        details: pendingDetails,
        checkRun: failedRun(
          { ...(acquisitionChecks ?? {}), decryption: CheckResult.FAIL },
          // The copy is this record's own durable one and stays exactly as it
          // is, so it is retained by definition on this path.
          decryptionFailureOf(reading, provenance, true),
        ),
      };
    }
    return settleUnopened(reading, document, input.tenantId, provenance, deps, options);
  }

  const { content, encrypted, keyUnused } = reading;
  const details = detailsOf(content, provenance);
  const contentDigest = await contentDigestOf(content);

  const decryption = acquisitionChecks?.decryption ?? (encrypted ? CheckResult.PASS : CheckResult.NOT_RUN);
  // The contract's digest check belongs to the signed form; a body that is
  // not a credential has none to digest, so the check did not apply.
  const digest =
    acquisitionChecks?.digest ??
    (content.kind === ExternalContentKind.CREDENTIAL ? CheckResult.PASS : CheckResult.NOT_RUN);
  const retrieval = acquisitionChecks?.retrieval ?? CheckResult.PASS;

  // Settled before the duplicate lookup because all three are decided by what
  // the body already is, and the lookup is the first await that can throw
  // without carrying them.
  if (options.mode === 'recover') options.onAcquisitionProgress?.({ retrieval, decryption, digest });

  let duplicateOfRecordId: string | undefined;
  if (contentDigest !== undefined) {
    const existingRecordId = await deps.findExistingExternal(
      input.tenantId,
      contentDigest,
      options.mode === 'recover' ? options.currentRecordId : undefined,
    );
    if (existingRecordId !== null) {
      logger.info(
        { tenantId: input.tenantId, ...provenanceLogFields(provenance), existingRecordId },
        'Credential content is already registered',
      );
      if (options.mode === 'register') throw new DuplicateCredentialError(existingRecordId);
      duplicateOfRecordId = existingRecordId;
    }
  }
  const identity = identityOf(content, contentDigest, duplicateOfRecordId);

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
      acquisition,
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
      // The finaliser's rejected-replacement branch takes over an outcome
      // shaped this way (`holdsIdentity` true, a non-credential
      // `contentKind`), and it settles THIS failure: the branch prefers the
      // prepared run's own failure whenever that run is FAILED, as it is
      // here, so the code, message and retryable flag written below are what
      // the caller reads back. `rejectedReplacementFailure` composes a
      // failure only for a PENDING prepared outcome, which is an attempt that
      // opened a body on a row holding no identity and met a row holding one
      // by the time the lock was taken. The one path that discards this
      // failure is a SOURCE acquisition meeting a row whose identity has
      // since been cleared, where `storageSkipped` above tells the finaliser
      // to settle a moved-identity failure instead; a stored-copy acquisition
      // on that same cleared row still settles this failure through the
      // finaliser's stored-copy sub-branch, because no source was ever read.
      checkRun: failedRun(
        { retrieval, decryption, digest },
        {
          code: CheckRunFailureCode.SOURCE_NOT_CREDENTIAL,
          message:
            provenance.mode === 'source'
              ? 'The re-fetched source did not return the credential this record already holds.'
              : "The record's durable copy opened to something that is not the credential this record already holds. No source was read; the copy is unchanged.",
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
    throw new EncryptionUnavailableError(error, { retrieval, decryption, digest });
  }

  let stored: StoreOutcome;
  try {
    stored = await storeOpened(content, document, input.tenantId, provenance, deps);
  } catch (error) {
    // Recover mode only: the reservation this throw abandons has to settle
    // with the checks the attempt already earned, and that carrier is a typed
    // class the settler narrows on rather than a property bolted onto
    // whatever was thrown. Register mode rethrows untouched, so its callers'
    // error surface is unchanged.
    if (options.mode === 'recover') throw new StoreAttemptFailedError(error, { retrieval, decryption, digest });
    throw error;
  }
  if (stored.outcome === 'failed') {
    return {
      acquisition,
      encrypted,
      ...identity,
      decryptionKeyUnused: keyUnused,
      details,
      checkRun: failedRun(
        {
          retrieval,
          decryption,
          // Register's store-failure row leaves `digest` NOT_RUN: on that
          // path `digest` would mean "the body is a signed credential",
          // which is the content-identity meaning, not the custody-integrity
          // meaning the schema and the worker publish. Only a caller that
          // earned a custody-integrity result (mode B, which checked the
          // stored copy against its recorded digest before opening it)
          // carries one here, so nothing is defaulted in.
          ...(acquisitionChecks?.digest === undefined ? {} : { digest: acquisitionChecks.digest }),
        },
        openedStorageFailure(stored.failure, encrypted),
      ),
    };
  }
  return {
    acquisition,
    encrypted,
    ...identity,
    storage: stored.storage,
    decryptionKeyUnused: keyUnused,
    details,
    checkRun: {
      state: CheckRunState.PENDING,
      checks: {
        retrieval: acquisitionChecks?.retrieval ?? CheckResult.PASS,
        decryption,
        digest: acquisitionChecks?.digest ?? digest,
      },
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
 * The two encrypted rows the request could not open: the ciphertext is
 * kept exactly as fetched with no key of ours, and the run fails with the
 * code that says whether a key was missing or did not work. No preflight
 * runs, because no storage-service key is involved.
 */
async function settleUnopened(
  reading: Exclude<ArtefactReading, { outcome: 'opened' }>,
  document: FetchedDocument,
  tenantId: string,
  provenance: Extract<Provenance, { mode: 'source' }>,
  deps: RegisterExternalCredentialDependencies,
  options: SettleInRequestOptions,
): Promise<InRequestOutcome> {
  // OPAQUE is a real classification here, not a placeholder: a source fetch
  // that returned an envelope this service cannot open has observed a body,
  // and the record records what kind of body it was. The stored-copy path
  // makes no such observation and carries no content kind at all.
  const base = {
    acquisition: { mode: 'source' as const, sourceDigest: provenance.sourceDigest },
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
    // Nothing was stored, so the caller's next move is still about the
    // supplier: no durable copy of these bytes exists for an operator to look
    // at.
    return {
      ...base,
      storageSkipped: 'identity-held',
      checkRun: failedRun(checks, decryptionFailureOf(reading, provenance, false)),
    };
  }

  const stored = await storeAsFetched(reading.bytes, document, false, tenantId, provenance, deps);
  if (stored.outcome === 'failed') {
    // Two failures on one row: no copy was written, and this service holds
    // no key to open one anyway. STORAGE_FAILED wins the code, retryable
    // flag and outcome, unchanged from before; only the message text below
    // is composed for this branch. A bodyless re-verify of this row (once it
    // holds no identity, this branch's premise) fetches again and, once
    // storage recovers, keeps the ciphertext copy as fetched; it still
    // cannot open it, because a re-fetch supplies no key. A key-bearing
    // re-verification retries the source fetch WITH the supplied key, which
    // is the form this message names, because it is the one that can finish
    // the job for this record.
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
        )} Once storage recovers, retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify to fetch the source again and open it.`,
      }),
    };
  }
  // Chosen here rather than before the store, because the store outcome is
  // what decides where the caller is sent. The raw ciphertext is now this
  // record's durable copy, so the NEXT attempt reads that copy and never
  // touches the supplier: guidance about the source changing would name a
  // system nothing will read again.
  return {
    ...base,
    storage: stored.storage,
    checkRun: failedRun(checks, decryptionFailureOf(reading, provenance, true)),
  };
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
 * opened-with-key credential is different: a bodyless re-verification cannot
 * supply a key, so a later attempt against a still-encrypted source produces
 * only unopenable ciphertext again. A key-bearing re-verification can retry
 * the source fetch with the key after storage recovers.
 */
function openedStorageFailure(failure: CheckRunFailure, encrypted: boolean): CheckRunFailure {
  if (!encrypted) return failure;
  return {
    ...failure,
    message: `${unstoredCopyCause(
      failure,
    )} This credential was opened with a supplied key, but its opened copy was not stored. Retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify once storage recovers.`,
  };
}

/**
 * Which of the three encrypted rows this is: no key at all, a key that did
 * not open the envelope, or an envelope too damaged for any key. Only the
 * last is terminal. The other two are retryable because a later attempt with
 * the right key may succeed. The messages name the key-bearing re-verification
 * form that the caller can use for that attempt.
 */
function decryptionFailureOf(
  reading: Exclude<ArtefactReading, { outcome: 'opened' }>,
  provenance: Provenance,
  copyRetained: boolean,
): CheckRunFailure {
  const fromSource = provenance.mode === 'source';
  if (reading.outcome === 'encrypted-no-key') {
    return {
      code: CheckRunFailureCode.DECRYPTION_REQUIRED,
      message: fromSource
        ? 'The fetched credential is encrypted and this service holds no key that opens it. The copy is kept as fetched. Retry with sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.'
        : DECRYPTION_REQUIRED_MESSAGE,
      retryable: true,
    };
  }
  if (reading.reason === 'key-mismatch') {
    return {
      code: CheckRunFailureCode.DECRYPTION_FAILED,
      message: fromSource
        ? 'The supplied decryption key did not open the fetched credential. The copy is kept as fetched. Retry with the correct sourceEncryption.decryptionKey on POST /api/v1/library/{id}/verify.'
        : STORED_COPY_KEY_MISMATCH_MESSAGE,
      retryable: true,
    };
  }
  // A retained copy is not going to change, so nothing about the supplier
  // is relevant to it: naming a source change as the way out would send the
  // caller to a system this path never reads.
  //
  // `copyRetained`, not `fromSource` alone: a source fetch whose corrupt
  // ciphertext WAS stored has produced exactly the state the stored-copy
  // wording describes, and every later attempt reads that copy rather than
  // the supplier. The source wording is right only where no durable copy of
  // these bytes exists, which is a store that failed or was skipped.
  return {
    code: CheckRunFailureCode.DECRYPTION_FAILED,
    message:
      fromSource && !copyRetained
        ? 'The fetched encrypted envelope is corrupted and cannot be decrypted; re-supplying the key will not help unless the source changes.'
        : "The encrypted envelope in this record's durable copy is corrupted and cannot be decrypted; no key will open it, and the copy needs an operator to inspect it.",
    retryable: false,
  };
}

function detailsOf(content: OpenedContent, provenance: Provenance): ExternalDetailsCapture {
  if (content.kind !== ExternalContentKind.CREDENTIAL) {
    // The artefact was reached and is not a signed credential: a read that
    // ran and found nothing to extract, which is a failure, not a pending.
    return { status: CredentialDetailsStatus.EXTRACTION_FAILED, error: CredentialDetailsError.UNREADABLE_ENVELOPE };
  }
  const { capture, reason } = captureExternalDetails(content.decoded);
  if (reason !== undefined) {
    logger.warn(
      { ...provenanceLogFields(provenance), reason },
      'Descriptive fields could not be extracted from the acquired credential',
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
  provenance: Provenance,
  deps: RegisterExternalCredentialDependencies,
): Promise<StoreOutcome> {
  if (content.kind === ExternalContentKind.CREDENTIAL) {
    return store(tenantId, provenance, deps, true, (service) => service.store(content.credential, true));
  }
  return storeAsFetched(content.bytes, document, true, tenantId, provenance, deps);
}

async function storeAsFetched(
  bytes: Uint8Array,
  document: FetchedDocument,
  encrypt: boolean,
  tenantId: string,
  provenance: Provenance,
  deps: RegisterExternalCredentialDependencies,
): Promise<StoreOutcome> {
  const contentType = document.contentType?.split(';')[0].trim() || 'application/octet-stream';
  const filename = `${randomUUID()}.${extensionFor(contentType)}`;
  return store(tenantId, provenance, deps, encrypt, (service) =>
    service.storeBinary(bytes, filename, contentType, encrypt),
  );
}

async function store(
  tenantId: string,
  provenance: Provenance,
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
    // no key; a later key-bearing re-verification can retry the source fetch
    // with the key after storage recovers. A refusal (the service rejected the content,
    // typically a content type its upload allowlist does not carry) is not
    // an outage: the same request fails the same way until an operator
    // changes the service.
    logger.error(
      { error: safeError(error), tenantId, ...provenanceLogFields(provenance) },
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
    // This line is also where the object's coordinates stop: the error thrown
    // below carries none, because a recovery copies its message onto the
    // record's published failure.
    logger.error(
      { tenantId, storageUri: record.uri, storageExternalId: record.externalId, storageBucket: record.bucket ?? null },
      'Storage encrypted the durable copy but returned no key; the copy is orphaned',
    );
    throw new StorageKeyMissingError();
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
