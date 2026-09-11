import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckRunFailureCode,
  LibraryRecordOrigin,
  CheckResult,
  CheckRunState,
  CredentialDetailsStatus,
  type ExternalCredential,
} from '@/lib/prisma/generated';
import {
  CredentialDocumentFetchError,
  fetchCredentialDocument,
  type FetchedDocument,
} from '@/lib/credentials/fetch-credential-document';
import { ConfigDecryptionError, ConfigValidationError, NotFoundError, ServiceResolutionError } from '@/lib/api/errors';
import { appLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';
import { getLibraryRecordById } from '@/lib/prisma/repositories/library-record.repository';
import { LibraryRecordShapeError, type LibraryRecordDetailView } from '@/lib/library/library-record-view';
import {
  createReverificationGeneration,
  finaliseRecoveryGeneration,
  noChecksRun,
  reserveRecoveryGeneration,
  settleCheckRunFailed,
  RecoveryLockDiscoveryExhaustedError,
  type CheckRunFailure,
  type CreateReverificationGenerationInput,
  type CreateReverificationGenerationResult,
  type AcquisitionChecks,
  type RecoveryConflictReason,
  type RetiredRecoveryStorage,
  type ReverificationCustodySnapshot,
  type SourceFreshness,
} from '@/lib/prisma/repositories/check-run.repository';
import { isContentDigestUniqueViolation } from '@/lib/prisma/repositories/external-credential.repository';
import type { SqlExecutor } from '@/lib/jobs/types';
import type {
  InitialCheckRunInput,
  VerifyJobReference,
} from '@/lib/prisma/repositories/external-credential.repository';
import {
  defaultRegisterDependencies,
  settleInRequest,
  EncryptionUnavailableError,
  StorageKeyMissingError,
  StoreAttemptFailedError,
  type AcquiredCredentialInput,
  type RecoverFromSourceOptions,
  type RecoverFromStoredCopyOptions,
  type RecoverInRequestOutcome,
  type RegisterExternalCredentialInput,
} from './register-external-credential';
import { fetchStoredCopyBytes, StoredCopyReadError } from './verify-generation-job';
import { readWorkerJobTimeoutSeconds } from '@/lib/config/worker-job-timeout.config';
import { errorNameOf, removeStoredObject, storageCoordinatesForLog } from './remove-stored-object';
import {
  DECRYPTION_REQUIRED_MESSAGE,
  ENCRYPTION_UNAVAILABLE_RECOVERY_DETAIL,
  recoveryResumeGuidance,
  SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE,
  STORED_COPY_DIGEST_MISMATCH_MESSAGE,
  STORED_COPY_DIGEST_UNREADABLE_MESSAGE,
  STORED_COPY_NO_DIGEST_MESSAGE,
  storedCopyReadFailedMessage,
  VERIFICATION_IN_PROGRESS_MESSAGE,
  VERIFICATION_RACE_LOST_MESSAGE,
  cannotAcceptSupplierKey,
} from './reverify-messages';

const logger = appLogger.child({ module: 'reverify-library-record' });

/**
 * Refuses a BODYLESS request against a record that already holds a durable
 * copy of unopened ciphertext. Bodylessness is the deciding condition: the
 * same record with a key on the request opens that copy in the request
 * instead.
 *
 * A no-copy record is never refused this way. It always acquires first, per
 * the fetched-content rule, and a fetch that returns unopenable ciphertext
 * there settles as a `202` generation carrying this same code, either stored
 * fresh or refusing to replace an identity the row already holds.
 */
export class DecryptionRequiredError extends Error {
  readonly code = 'DECRYPTION_REQUIRED';

  constructor() {
    super(DECRYPTION_REQUIRED_MESSAGE);
    this.name = 'DecryptionRequiredError';
  }
}

/**
 * A caller-supplied key cannot be applied to native or already protected
 * custody. The message states the one condition under which a key IS
 * accepted, so it is true of both triggers: a native record's copy was issued
 * here and its key is already held, and an external record whose copy is
 * already receiver-protected needs no supplier key either.
 */
export class SourceEncryptionNotAllowedError extends Error {
  readonly code = 'SOURCE_ENCRYPTION_NOT_ALLOWED';

  constructor() {
    super(SOURCE_ENCRYPTION_NOT_ALLOWED_MESSAGE);
    this.name = 'SourceEncryptionNotAllowedError';
  }
}

/**
 * A key-bearing request that cannot be carried out as sent, for one of two
 * reasons the caller has to be able to tell apart.
 *
 * `pending`: a generation is already running and cannot consume this key, so
 * the caller waits for it to settle. `race-lost`: this request lost the
 * generation-index race twice and the winner had already settled by the time
 * it was read, so nothing is running, the key was never consumed, and it can
 * go again immediately. Both answer `409`, because in both the request as
 * sent did not happen; only the next step differs.
 */
export class VerificationInProgressError extends Error {
  readonly code = 'VERIFICATION_IN_PROGRESS';
  readonly reason: RecoveryConflictReason;
  /** The generation that caused the refusal, for the route's operator log line. Never published to the caller. */
  readonly generation: number;

  constructor(reason: RecoveryConflictReason, generation: number) {
    super(reason === 'race-lost' ? VERIFICATION_RACE_LOST_MESSAGE : VERIFICATION_IN_PROGRESS_MESSAGE);
    this.name = 'VerificationInProgressError';
    this.reason = reason;
    this.generation = generation;
  }
}

export type ReverifyLibraryRecordDependencies = {
  getRecord: (recordId: string, tenantId: string) => Promise<LibraryRecordDetailView | null>;
  fetchSource: (href: string) => Promise<FetchedDocument>;
  createGeneration: (input: CreateReverificationGenerationInput) => Promise<CreateReverificationGenerationResult>;
  /** The recovery branch's own reserve step. */
  reserveGeneration: (
    input: Parameters<typeof reserveRecoveryGeneration>[0],
  ) => ReturnType<typeof reserveRecoveryGeneration>;
  /** The recovery branch's own finalise step. */
  finaliseGeneration: (
    input: Parameters<typeof finaliseRecoveryGeneration>[0],
  ) => ReturnType<typeof finaliseRecoveryGeneration>;
  /**
   * Test and integration seam for the shared in-request recovery pipeline.
   * The options carry the record being recovered, whether its reservation
   * already held a content identity, and which acquisition mode this call is,
   * so nothing about the call is spread across loose parameters.
   */
  recoverInRequest?: (
    input: AcquiredCredentialInput | RegisterExternalCredentialInput,
    options: RecoverFromSourceOptions | RecoverFromStoredCopyOptions,
  ) => Promise<RecoverInRequestOutcome>;
  /**
   * Mode B's transport: a plain read of this deployment's own storage
   * service, not the guarded resolver. Required, like every other
   * member, so a partially constructed deps object in a test cannot fall
   * through to the real `fetch`.
   */
  fetchStoredCopy: (uri: string, timeoutMs: number) => Promise<Uint8Array>;
  /** The request-side bound for reading a record's own durable copy. */
  storedCopyTimeoutMs?: () => number;
};

export function defaultReverifyLibraryRecordDependencies(): ReverifyLibraryRecordDependencies {
  return {
    getRecord: getLibraryRecordById,
    fetchSource: (href) => fetchCredentialDocument(href),
    createGeneration: createReverificationGeneration,
    reserveGeneration: reserveRecoveryGeneration,
    finaliseGeneration: finaliseRecoveryGeneration,
    fetchStoredCopy: fetchStoredCopyBytes,
    storedCopyTimeoutMs: () => readWorkerJobTimeoutSeconds() * 1_000,
  };
}

export type ReverifyLibraryRecordResult = CreateReverificationGenerationResult;

/** Places the verification job on the queue, inside the transaction that finalises the generation. */
export type EnqueueVerification = (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;

/**
 * Readies whatever the enqueue needs, and is called only once this module has
 * decided a generation will be created. A caller that has to start a queue
 * does it here rather than before the record is read, so an unavailable queue
 * cannot turn a not-found, a join or a refusal into a server error.
 */
export type PrepareEnqueue = () => Promise<EnqueueVerification>;

/**
 * Decides what a re-verification does with a record, with or without a
 * supplied decryption key, prepares the in-request work, and asks the
 * repository to lock, recheck and append the generation.
 *
 * This is the only owner of the precedence a caller sees, in this order: the
 * record must exist under the tenant; a supplied key is refused
 * `SOURCE_ENCRYPTION_NOT_ALLOWED` for a native record or an external record
 * whose durable copy is already receiver-protected, before anything else
 * looks at pending state; a bodyless request joins a pending generation
 * rather than duplicating it, while a key-bearing one is refused
 * `VERIFICATION_IN_PROGRESS` instead, because a pending generation cannot
 * consume its key; a bodyless request against an unopened durable copy is
 * refused `DECRYPTION_REQUIRED`; and an external record is refused when the
 * branch its stored custody implies is unavailable. The route reads the
 * request and projects the answer, and repeats none of these decisions.
 *
 * The worker owns every read of a protected pinned copy. The protected
 * external branch only checks the supplier source here, and never replaces
 * the copy.
 *
 * The recovery branch is a reserve-then-acquire-then-finalise
 * sequence rather than one transaction: {@link reserveRecoveryGeneration} claims
 * generation N+1 as `PENDING` with no job under the parent's lock and
 * commits, so a concurrent bodyless caller joins that reservation instead of
 * starting a second acquisition (criterion 5); the bytes are then acquired,
 * either by fetching the supplier source or by reading the record's own
 * durable copy, and on success stored, entirely outside any transaction;
 * {@link finaliseRecoveryGeneration}
 * then locks the reserved run's parent (and every other parent the identity
 * reconciliation touches) again, fences on the reservation still being
 * exactly as this request left it, and either attaches the result and
 * enqueues or settles the reservation `FAILED` with no job. A queue that will
 * not start is readied immediately after a successful reservation and before
 * the fetch, so it cannot leave a stored copy with a reservation nobody will
 * ever finalise. The same gap is closed for every throw after that point
 * too: a fetch or a finalisation that throws (an encryption or storage
 * failure, a twice-collided identity, or anything unexpected) settles the
 * reservation `FAILED` and retryable before rethrowing, so this branch never
 * leaves a generation `PENDING` with no job for the reconciliation sweep to
 * find only after its abandonment cutoff passes. A queue that
 * will not start after the reservation is answered as `202` with that
 * settled generation rather than failing the request, because the
 * reservation this request made already exists and is already finalised
 * FAILED; a queue that will not start before any reservation exists (the
 * native and protected-copy branches, which enqueue before locking anything)
 * still fails the request, since no generation was created for it to report.
 *
 * The supplier's key crosses this module as an argument only. It is never
 * written to a log child, a dependency object, a queue payload or a response
 * (ADR-055 decision 1).
 */
export function reverifyLibraryRecord(
  recordId: string,
  tenantId: string,
  prepareEnqueue: PrepareEnqueue,
  deps?: ReverifyLibraryRecordDependencies,
): Promise<ReverifyLibraryRecordResult>;
/**
 * The key-bearing form. `decryptionKey` is `string`, never `string |
 * undefined`: the implementation decides which form it was given by testing
 * that argument's type, so a call passing `undefined` there would take the
 * bodyless arm and silently discard the `deps` in the fifth position, running
 * the real repository, the real fetch and the real storage against a test's
 * doubles. Narrowing it makes that call a compile error instead.
 */
export function reverifyLibraryRecord(
  recordId: string,
  tenantId: string,
  prepareEnqueue: PrepareEnqueue,
  decryptionKey: string,
  deps?: ReverifyLibraryRecordDependencies,
): Promise<ReverifyLibraryRecordResult>;
export async function reverifyLibraryRecord(
  recordId: string,
  tenantId: string,
  prepareEnqueue: PrepareEnqueue,
  keyOrDeps?: string | ReverifyLibraryRecordDependencies,
  depsArgument?: ReverifyLibraryRecordDependencies,
): Promise<ReverifyLibraryRecordResult> {
  const request: RecoveryRequest =
    typeof keyOrDeps === 'string' ? { kind: 'keyed', decryptionKey: keyOrDeps } : { kind: 'bodyless' };
  const deps =
    typeof keyOrDeps === 'string'
      ? depsArgument ?? defaultReverifyLibraryRecordDependencies()
      : keyOrDeps ?? defaultReverifyLibraryRecordDependencies();
  const current = await deps.getRecord(recordId, tenantId);
  if (current === null) throw new NotFoundError('No such credential record.', 'NOT_FOUND');

  const log = logger.child({ recordId, tenantId, origin: originOf(current) });
  log.info('Re-verification entered');
  const keyBearing = request.kind === 'keyed';

  if (keyBearing && current.origin === LibraryRecordOrigin.NATIVE) {
    throw new SourceEncryptionNotAllowedError();
  }
  if (
    keyBearing &&
    current.origin === LibraryRecordOrigin.EXTERNAL &&
    // Rule 4, read here from the key envelope this view already carries.
    // The reservation's own lock and the race resolver decide the same rule
    // from a custody snapshot and a key-presence projection respectively;
    // all three call this one predicate, whose docblock carries the
    // invariant that lets a site with no `storageUri` decide it at all.
    cannotAcceptSupplierKey({ decryptionKeyPresent: current.external.decryptionKey !== null })
  ) {
    throw new SourceEncryptionNotAllowedError();
  }

  if (!keyBearing && current.checkRun?.state === CheckRunState.PENDING) {
    log.info({ generation: current.checkRun.generation }, 'Re-verification joined pending generation');
    return { outcome: 'joined' };
  }

  const common = { recordId, tenantId, expectedCustody: custodyOf(current) };

  if (current.origin === LibraryRecordOrigin.NATIVE) {
    // Generation 1 of a native record is its issuance assertion whether or not
    // a run was ever stored, so the first executed generation is 2.
    return recorded(
      log,
      await deps.createGeneration({
        ...common,
        expectedOrigin: LibraryRecordOrigin.NATIVE,
        expectedGeneration: current.checkRun?.generation ?? 1,
        enqueue: await prepareEnqueue(),
      }),
    );
  }

  const external = current.external;
  if (external.storageUri === null) {
    if (external.sourceUrl === null) {
      throw new LibraryRecordShapeError(recordId, 'has no durable copy and no source URL to recover');
    }
    return recorded(
      log,
      await recoverExternalRecord(
        common,
        current.checkRun.generation,
        { kind: 'no-copy', external, sourceUrl: external.sourceUrl },
        request,
        prepareEnqueue,
        deps,
      ),
    );
  }
  if (external.decryptionKey === null) {
    if (!keyBearing && external.encrypted === true) throw new DecryptionRequiredError();
    if (external.encrypted === true) {
      // Necessarily key-bearing: the bodyless form of this exact state was
      // refused on the line above.
      return recorded(
        log,
        await recoverExternalRecord(
          common,
          current.checkRun.generation,
          { kind: 'unopened-copy', external },
          request,
          prepareEnqueue,
          deps,
        ),
      );
    }
    throw new LibraryRecordShapeError(recordId, 'holds a stored copy that is neither encrypted nor keyed');
  }
  if (external.encrypted === null) {
    throw new LibraryRecordShapeError(
      recordId,
      'holds a key for a stored copy that does not say whether it is encrypted',
    );
  }
  if (external.sourceUrl === null || external.sourceDigest === null) {
    throw new LibraryRecordShapeError(recordId, 'holds a stored copy with no source provenance to compare against');
  }

  const freshness = await checkSourceFreshness(log, external.sourceUrl, external.sourceDigest, deps.fetchSource);
  return recorded(
    log,
    await deps.createGeneration({
      ...common,
      expectedOrigin: LibraryRecordOrigin.EXTERNAL,
      expectedGeneration: current.checkRun.generation,
      freshness,
      enqueue: await prepareEnqueue(),
    }),
  );
}

type CommonRecoveryInput = { recordId: string; tenantId: string; expectedCustody: ReverificationCustodySnapshot };

/**
 * What the caller supplied, as one value rather than a key and a flag that can
 * disagree. `(undefined, true)` was representable while those were two
 * parameters, and it reserved key-bearing, took mode B and then failed to
 * decrypt for a request that carried no key at all.
 */
type RecoveryRequest = { kind: 'bodyless' } | { kind: 'keyed'; decryptionKey: string };

/**
 * The record this recovery is for, as the entry read saw it. A `no-copy`
 * subject carries its supplier source in the type, because the caller that
 * classified it has already established there is one; mode A on that subject
 * needs no runtime check. An `unopened-copy` subject has a durable copy and
 * may or may not have a source, which matters only in the narrow case where
 * that copy has vanished by the time the reservation takes its lock.
 *
 * The subject says what the ENTRY read saw. It does not choose the mode: that
 * comes from the custody the reservation observed under its own lock.
 */
type RecoverySubject =
  | { kind: 'no-copy'; external: ExternalCredential; sourceUrl: string }
  | { kind: 'unopened-copy'; external: ExternalCredential };

/**
 * Mode A needs a supplier source. A `no-copy` subject carries one in its type.
 * An `unopened-copy` subject reaches mode A only when its durable copy went
 * away between the entry read and the lock, and such a row may have no source
 * at all, which is the one case still checked at runtime.
 */
function sourceUrlFor(recordId: string, subject: RecoverySubject): string {
  if (subject.kind === 'no-copy') return subject.sourceUrl;
  if (subject.external.sourceUrl === null) {
    throw new LibraryRecordShapeError(recordId, 'has no source URL to recover');
  }
  return subject.external.sourceUrl;
}

/**
 * What an acquisition produced. Either bytes to hand the shared pipeline, with
 * the checks the acquisition earned on the way, or an outcome already settled
 * by a failure. There is no third state, so the caller threads no mutable
 * optional and asserts nothing about bytes it may not have.
 */
type AcquisitionResult =
  | { outcome: 'settled'; prepared: RecoverInRequestOutcome }
  | { outcome: 'read'; bytes: Uint8Array; checks: AcquisitionChecks };

/**
 * Mode B's acquisition: read the record's own reserved durable copy and prove
 * it intact before anything tries to open it.
 *
 * The preimage is the stored bytes exactly as read, verified through the
 * digest the storage service recorded for them, so the algorithm and base come
 * off the recorded value rather than being restated here. The order matters:
 * a copy that cannot be proven intact is never decrypted, so a corrupt object
 * can never be reported as a wrong key.
 *
 * Why the raw bytes are the right preimage, where the worker's own read
 * (`readStoredCopy` in `verify-generation-job.ts`) has to reconstruct one:
 * mode B is chosen only for custody whose `storageUri` is set, whose
 * `encrypted` is true and which holds no key. The one write in this codebase
 * that produces that combination is the register path's `settleUnopened`,
 * which calls `storeAsFetched(reading.bytes, document, false, ...)` and so
 * hands the storage service the fetched ciphertext verbatim with
 * `encrypt: false`. The digest the service recorded is therefore over exactly
 * the bytes a read gives back, with no envelope to strip and no
 * re-serialisation to redo. The worker's copies can also be opened
 * credentials it re-serialises, which is why its rule differs. If any other
 * write ever produces unopened custody, this preimage rule has to be revisited
 * with it: the two would otherwise disagree, and one of them would report an
 * intact copy as corrupt. The claim rests on reading those write paths rather
 * than on a fixture taken from a running storage service (`storeBinary` with
 * `encrypt: false` has no such vector yet); that evidence gap is recorded as
 * a follow-up.
 *
 * `storageUri` is passed beside the snapshot it came from, already narrowed
 * to non-null by the caller that chose this mode, so this function needs no
 * assertion of its own. The snapshot travels too, because a failure settled
 * here ends with the resume step that this record's custody allows.
 *
 * `earned` is the caller's own record of what this attempt has proved so far,
 * written at each boundary as it is crossed rather than returned at the end.
 * The caller settles a post-acquisition throw with it, so a retrieval that
 * passed before a later step threw is still recorded on the failed
 * generation. Every value handed onward is a copy of it, so nothing
 * downstream aliases a record the caller keeps writing to.
 */
async function acquireStoredCopy(
  ref: { recordId: string; tenantId: string },
  custody: ReverificationCustodySnapshot,
  storageUri: string,
  fetchStoredCopy: (uri: string, timeoutMs: number) => Promise<Uint8Array>,
  timeoutMs: number,
  earned: AcquisitionChecks,
): Promise<AcquisitionResult> {
  const storageDigestMultibase = custody.storageDigestMultibase;
  let bytes: Uint8Array;
  try {
    bytes = await fetchStoredCopy(storageUri, timeoutMs);
  } catch (error) {
    return { outcome: 'settled', prepared: storedCopyFailure(ref, 'read-failed', error, { ...earned }, custody) };
  }
  earned.retrieval = CheckResult.PASS;

  if (storageDigestMultibase === null) {
    return {
      outcome: 'settled',
      prepared: storedCopyFailure(
        ref,
        'no-digest',
        new StoredCopyReadError('terminal', 'the stored copy has no integrity digest'),
        { ...earned },
        custody,
      ),
    };
  }

  let digestMatches: boolean;
  try {
    digestMatches = await MultibaseDigest.fromString(storageDigestMultibase).verify(bytes);
  } catch (error) {
    return {
      outcome: 'settled',
      prepared: storedCopyFailure(
        ref,
        'digest-unreadable',
        new StoredCopyReadError('terminal', 'the stored copy integrity digest could not be checked', error),
        { ...earned },
        custody,
      ),
    };
  }
  if (!digestMatches) {
    earned.digest = CheckResult.FAIL;
    return { outcome: 'settled', prepared: storedCopyDigestMismatch({ ...earned }) };
  }
  earned.digest = CheckResult.PASS;
  return { outcome: 'read', bytes, checks: { ...earned } };
}

/**
 * Removes the durable copy a successful recovery displaced, and records what
 * happened for the operator.
 *
 * The same shape as the library delete's own cleanup, and through the same
 * helper: it runs only after the finalisation transaction has committed, only
 * on the tuple that commit displaced, and it never throws. A failed removal
 * leaves the settled generation and the caller's response exactly as they
 * were, because the replacement is already the record's copy and the retired
 * object is an operator's concern alone.
 *
 * The log line is that operator's only signal, so it names the storage
 * location and the object id whichever way the removal went, and `removal`
 * says which. A line that says the copy remains is the one to act on.
 */
async function removeRetiredCopy(recordId: string, tenantId: string, retired: RetiredRecoveryStorage): Promise<void> {
  const { outcome, errorName } = await removeStoredObject(tenantId, retired);
  const fields = {
    recordId,
    tenantId,
    ...storageCoordinatesForLog(retired),
    removal: outcome,
    ...(errorName === undefined ? {} : { errorName }),
  };
  if (outcome === 'deleted') {
    logger.info(fields, 'Retired recovery copy removed');
    return;
  }
  logger.warn(fields, 'Retired recovery copy remains for operator-managed cleanup');
}

/**
 * The recovery branch's own reserve, acquire, finalise sequence, for both
 * acquisition modes.
 *
 * The reservation claims generation N+1 under the parent lock and returns the
 * custody it observed there. THAT snapshot, not the entry read, chooses the
 * mode: no durable copy takes mode A and fetches the supplier source; an
 * unopened durable copy takes mode B and reads the record's own copy,
 * touching no supplier at all. A row that acquired a copy between the entry
 * read and the lock therefore takes mode B against the copy that now exists,
 * and the same snapshot travels on as the finalisation fence.
 *
 * The fetched-content rule that decides what a body which does not open a
 * credential does to an identity-holding row lives in
 * `finaliseRecoveryGeneration`, not here, because it needs the row re-read
 * under the finalisation lock rather than the snapshot this function started
 * with.
 */
async function recoverExternalRecord(
  common: CommonRecoveryInput,
  expectedGeneration: number,
  subject: RecoverySubject,
  request: RecoveryRequest,
  prepareEnqueue: PrepareEnqueue,
  deps: ReverifyLibraryRecordDependencies,
): Promise<CreateReverificationGenerationResult> {
  const external = subject.external;
  const reserved = await deps.reserveGeneration({
    ...common,
    expectedGeneration,
    ...(request.kind === 'keyed' ? { keyBearing: true } : {}),
  });
  if (reserved.outcome === 'conflict') throw new VerificationInProgressError(reserved.reason, reserved.generation);
  if (reserved.outcome === 'not-applicable') throw new SourceEncryptionNotAllowedError();
  if (reserved.outcome !== 'reserved') return reserved;
  const reservedCustody = reserved.custody;

  // Readied immediately after a successful reservation and before the
  // acquisition, so a queue that will not start settles the reservation rather
  // than leaving a stored copy nothing will ever finalise. This is a queue
  // failure *after* a reservation already exists, so it settles the
  // generation FAILED and answers with it rather than failing the request;
  // a queue that will not start before any reservation exists (the native
  // and protected-copy branches) is unaffected and still fails the request.
  let enqueue: EnqueueVerification;
  try {
    enqueue = await prepareEnqueue();
  } catch (error) {
    const confirmed = await settleReservationOnThrow(
      reserved.checkRunId,
      common.tenantId,
      error,
      'queue-unavailable',
      reserved.custody,
    );
    // Answering 202 with "the settled generation" is only truthful once the
    // settle actually committed. If it did not (a transient database fault
    // on the settle write itself), the run is still `PENDING`: rethrow the
    // original queue failure. A queue failure with no confirmed generation is
    // answered with the sanitised 500, rather than a 202 that promises a
    // settlement that has not happened. The sweep remains the eventual
    // backstop either way.
    if (!confirmed) throw error;
    return { outcome: 'created', generation: reserved.generation, checkRunId: reserved.checkRunId };
  }

  /**
   * What this attempt has proved, declared outside the try because the catch
   * settles with it: a throw AFTER a successful acquisition still has to
   * record the checks that acquisition earned. Lock-discovery exhaustion, a
   * queue insert that fails inside the finalisation transaction and a
   * database fault on the finalisation write all reach the catch with no
   * carrier on the error, and settling those as `noChecksRun()` would publish
   * a run claiming the copy was never read when it was read, proved intact
   * and opened.
   *
   * Written at each boundary as it is crossed: the stored read and the digest
   * check inside `acquireStoredCopy`; then the pipeline's own
   * `onAcquisitionProgress`, which reports the decryption result, and mode A's
   * retrieval, at the moment the body opens and before the duplicate lookup
   * that follows it can throw; then whatever the pipeline's outcome states
   * once it returns, for the arms that settle without opening a body at all.
   * Reading them off the pipeline rather than recomputing them here keeps this
   * identical to what `EncryptionUnavailableError` and
   * `StoreAttemptFailedError` would have carried had the throw happened one
   * step earlier inside the pipeline instead of just after it.
   */
  const earned: AcquisitionChecks = {};

  // Any throw from here on (the acquisition, or finalisation) must still
  // settle the reservation this request made before propagating,
  // exactly as the queue-start failure above does, so a caller-visible error
  // never leaves a generation `PENDING` with no job for the sweep to find
  // thirty-plus minutes later.
  let settled: Awaited<ReturnType<ReverifyLibraryRecordDependencies['finaliseGeneration']>>;
  try {
    const acquiredInput: AcquiredCredentialInput = {
      tenantId: common.tenantId,
      annotations: {
        displayName: external.displayName,
        declaredCredentialType: external.declaredCredentialType,
        ...(external.dateReceived === null ? {} : { dateReceived: external.dateReceived }),
        ...(external.notes === null ? {} : { notes: external.notes }),
      },
      ...(request.kind === 'keyed' ? { decryptionKey: request.decryptionKey } : {}),
    };
    const holdsIdentity = reserved.identity.contentDigest !== null || reserved.identity.duplicateOfRecordId !== null;
    const recoverOptions = {
      mode: 'recover' as const,
      currentRecordId: common.recordId,
      holdsIdentity,
      // The pipeline's own boundary write, matching the two this function
      // makes around `acquireStoredCopy`. Without it the decrypt's result,
      // and in mode A the retrieval that preceded it, would exist only on an
      // outcome the pipeline never gets to return once its duplicate lookup
      // throws, and the catch below would settle the generation as though
      // neither had happened.
      onAcquisitionProgress: (checks: AcquisitionChecks) => {
        Object.assign(earned, checks);
      },
    };

    let prepared: RecoverInRequestOutcome;
    let freshness: SourceFreshness | undefined;

    // Stamped here, after the reservation and the queue preparation and
    // BEFORE the acquisition, never after it. `lastSourceCheckAt` is
    // published as the moment the supplier check was attempted, and
    // `library.md` tells integrators it follows `requestedAt` only by the
    // reservation-and-queue interval, "never by the fetch's own duration".
    // Taking it after the pipeline returned would fold the fetch, the
    // decrypt, the duplicate lookup, the encryption preflight and the store
    // into a number a caller reads as supplier freshness. Mode B stamps
    // nothing at all: it reads this record's own durable copy and makes no
    // supplier observation to date.
    const attemptedAt =
      reservedCustody.storageUri === null && external.sourceDigest !== null ? new Date(Date.now()) : undefined;

    if (reservedCustody.storageUri !== null) {
      const acquired = await acquireStoredCopy(
        common,
        reservedCustody,
        reservedCustody.storageUri,
        deps.fetchStoredCopy,
        deps.storedCopyTimeoutMs?.() ?? readWorkerJobTimeoutSeconds() * 1_000,
        earned,
      );
      prepared =
        acquired.outcome === 'settled'
          ? acquired.prepared
          : await recoverFromStoredCopy(deps, acquiredInput, {
              ...recoverOptions,
              acquisition: {
                from: 'stored-copy',
                // A `FetchedDocument` shaped for a supplier response, filled
                // in for a storage read, so two of its fields state less than
                // their names promise. `finalUrl` is documented as the URL
                // the body was read from after redirects, and the storage URI
                // literally is that here; nothing in the settle pipeline
                // reads it. `contentType` is documented as the response's own
                // header, and the storage read discards response headers, so
                // this is an assumption rather than an observation. It is
                // accepted, and its one consequence is stated here rather
                // than discovered later: when the opened body is NOT a
                // credential, the re-stored receiver-protected copy is
                // written as `<uuid>.bin` with this content type, where the
                // original registration used the supplier's declared type.
                // The record never persisted that type and the ciphertext
                // envelope carries no inner one, so no truer value exists to
                // use.
                document: {
                  bytes: acquired.bytes,
                  finalUrl: reservedCustody.storageUri,
                  contentType: 'application/octet-stream',
                },
                checks: acquired.checks,
                storageUri: reservedCustody.storageUri,
              },
            });
    } else {
      const sourceUrl = sourceUrlFor(common.recordId, subject);
      prepared = await recoverFromSource(
        deps,
        { ...acquiredInput, sourceUrl },
        { ...recoverOptions, acquisition: { from: 'source' } },
      );
      if (attemptedAt !== undefined) {
        freshness = {
          sourceChanged:
            prepared.acquisition.mode === 'source' ? prepared.acquisition.sourceDigest !== external.sourceDigest : null,
          checkedAt: attemptedAt,
        };
      }
    }

    Object.assign(earned, acquisitionChecksOf(prepared.checkRun.checks));

    settled = await deps.finaliseGeneration({
      recordId: common.recordId,
      tenantId: common.tenantId,
      checkRunId: reserved.checkRunId,
      generation: reserved.generation,
      expectedCustody: reservedCustody,
      ...(freshness === undefined ? {} : { freshness }),
      prepared,
      enqueue,
    });
  } catch (error) {
    const confirmed = await settleReservationOnThrow(
      reserved.checkRunId,
      common.tenantId,
      error,
      'fetch-or-finalise',
      reservedCustody,
      recoveryChecksOf(error) ?? earned,
    );
    // A lock-discovery exhaustion is answered the same way a queue that will
    // not start after the reservation already exists is: `202` with the
    // settled generation, exactly like the queue-unavailable case above,
    // because the reservation itself already exists and is already
    // finalised `FAILED` and retryable. Every other unexpected throw still
    // rethrows to the caller's own coded or sanitised failure. Truthful only
    // once the settle write itself actually committed: an unconfirmed settle
    // (the run stays `PENDING`) still rethrows the original error rather
    // than promising a settlement that never happened, the sweep remaining
    // the eventual backstop either way.
    if (confirmed && error instanceof RecoveryLockDiscoveryExhaustedError) {
      return { outcome: 'created', generation: reserved.generation, checkRunId: reserved.checkRunId };
    }
    throw error;
  }

  // Cleanup is outside the recovery catch. The helper already converts
  // storage failures to an outcome, and this boundary also preserves the
  // committed response if the helper itself unexpectedly throws.
  if (settled.outcome === 'created' && settled.retiredStorage !== undefined) {
    try {
      await removeRetiredCopy(common.recordId, common.tenantId, settled.retiredStorage);
    } catch (error) {
      logger.warn(
        {
          recordId: common.recordId,
          tenantId: common.tenantId,
          ...storageCoordinatesForLog(settled.retiredStorage),
          removal: 'storage_delete_failed',
          errorName: errorNameOf(error),
        },
        'Retired recovery copy remains for operator-managed cleanup',
      );
    }
    return { outcome: 'created', generation: settled.generation, checkRunId: settled.checkRunId };
  }
  return settled;
}

/**
 * The reservation this request made can never be finalised now, because the
 * queue could not be started, or because the fetch or the finalisation
 * itself threw. Settled `FAILED` and retryable,
 * with a failure classified from the cause, so a later re-verify reserves
 * and finalises a fresh generation rather than leaving this one `PENDING`
 * until the sweep eventually notices. If the settle itself fails, the
 * original cause is what the caller still needs, so it is logged beside the
 * settle failure rather than replaced by it.
 */
async function settleReservationOnThrow(
  checkRunId: string,
  tenantId: string,
  cause: unknown,
  site: 'queue-unavailable' | 'fetch-or-finalise',
  custody: ReverificationCustodySnapshot,
  checks?: AcquisitionChecks,
): Promise<boolean> {
  const failure = classifyRecoveryFailure(cause, site, custody);
  try {
    await settleCheckRunFailed({
      id: checkRunId,
      tenantId,
      checks: { ...noChecksRun(), ...(checks ?? {}) },
      schemaConformanceMessage: null,
      failure,
    });
    return true;
  } catch (settleError) {
    // Both reduced to `{ name, message }`. The cause is whatever escaped the
    // read, decrypt, store or finalise pipeline, which ran with the
    // supplier's key in scope, and pino renders an unreduced cause chain in
    // full. Under `error` and `cause` rather than `err`, so pino's error
    // serialiser cannot re-expand either (ADR-055 decision 1).
    logger.error(
      { checkRunId, tenantId, error: safeError(settleError), cause: safeError(cause) },
      'Reserved recovery generation could not be settled after it could not be finalised',
    );
    return false;
  }
}

/**
 * The checks an attempt had already earned when it threw, so the settlement
 * this throw forces still records them. Narrowed on the two classes that
 * carry them, never on the presence of a property called `checks`: an
 * unrelated dependency's error carrying that name would otherwise be spread
 * straight into a check-run update.
 */
function recoveryChecksOf(error: unknown): AcquisitionChecks | undefined {
  if (error instanceof EncryptionUnavailableError) return error.checks;
  if (error instanceof StoreAttemptFailedError) return error.checks;
  return undefined;
}

/**
 * The three acquisition results a settlement can carry, taken off the checks
 * an outcome states. Narrowed rather than spread: a check-run's checks also
 * carry results the acquisition never earns, and a settlement that copied
 * those wholesale would publish a verification result no verifier produced.
 */
function acquisitionChecksOf(checks: InitialCheckRunInput['checks']): AcquisitionChecks {
  const { retrieval, digest, decryption } = checks;
  return {
    ...(retrieval === undefined ? {} : { retrieval }),
    ...(digest === undefined ? {} : { digest }),
    ...(decryption === undefined ? {} : { decryption }),
  };
}

/**
 * Why a stored-copy acquisition could not proceed. The three settle the same
 * `STORED_COPY_UNAVAILABLE` code but describe genuinely different
 * states, and only the first of them means the bytes never arrived: the other
 * two record a copy that WAS read back and cannot be proven intact, and their
 * generations keep the `retrieval: pass` they earned. One message for all
 * three would contradict the checks stored beside it.
 */
type StoredCopyFailureReason = 'read-failed' | 'no-digest' | 'digest-unreadable';

function storedCopyMessage(
  reason: StoredCopyFailureReason,
  read: StoredCopyReadError,
  custody: ReverificationCustodySnapshot,
): string {
  if (reason === 'read-failed') return storedCopyReadFailedMessage(read.message, read.kind, custody);
  if (reason === 'no-digest') return STORED_COPY_NO_DIGEST_MESSAGE;
  return STORED_COPY_DIGEST_UNREADABLE_MESSAGE;
}

function storedCopyFailure(
  ref: { recordId: string; tenantId: string },
  reason: StoredCopyFailureReason,
  error: unknown,
  checks: AcquisitionChecks,
  // The custody the reservation observed under its own lock, so a retryable
  // read failure ends with the move that record's custody actually allows.
  custody: ReverificationCustodySnapshot,
): RecoverInRequestOutcome {
  const read =
    error instanceof StoredCopyReadError ? error : new StoredCopyReadError('transient', 'copy read failed', error);
  // The reason never reaches an operator through the settled generation
  // alone, because the caller sees only the message and the code. One error
  // line per failed stored read carries the cause, reduced by `safeError`
  // because the chain can hold key material, beside the classification that
  // decided retryability.
  logger.error(
    {
      recordId: ref.recordId,
      tenantId: ref.tenantId,
      reason,
      classification: read.kind,
      error: safeError(error),
    },
    'The reserved durable copy could not be acquired for recovery',
  );
  return {
    acquisition: { mode: 'stored-copy' },
    encrypted: null,
    details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
    checkRun: {
      state: CheckRunState.FAILED,
      checks,
      failure: {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: storedCopyMessage(reason, read, custody),
        // A copy that was read and cannot be proven intact is terminal
        // whatever the reader would have said: nothing about a repeat of the
        // same request changes a missing or unreadable recorded digest.
        retryable: reason === 'read-failed' && read.kind === 'transient',
      },
    },
  };
}

function storedCopyDigestMismatch(checks: AcquisitionChecks): RecoverInRequestOutcome {
  return {
    acquisition: { mode: 'stored-copy' },
    encrypted: null,
    details: { status: CredentialDetailsStatus.EXTRACTION_PENDING },
    checkRun: {
      state: CheckRunState.FAILED,
      checks,
      failure: {
        code: CheckRunFailureCode.STORED_COPY_CORRUPT,
        message: STORED_COPY_DIGEST_MISMATCH_MESSAGE,
        retryable: false,
      },
    },
  };
}

/**
 * Names the failed reservation's cause honestly rather than defaulting every
 * throw to the same generic message: an encryption or storage-resolution
 * failure names its own cause under `STORAGE_FAILED`; a finalisation that
 * collided twice on the same content identity (the repository's own bounded
 * retry already exhausted) is reported as a collision rather than an
 * unrelated fault; anything else is an unexpected throw, reported generically
 * with the run id already on the log line the caller writes.
 *
 * The four settled failures that end by telling the caller to try again take
 * that closing sentence from {@link recoveryResumeGuidance}, applied to the
 * custody the reservation observed under its own lock, exactly as the
 * reconciliation sweep does for an abandoned run. All four were written when
 * the only recoverable record had no durable copy, where a plain re-verify
 * genuinely is the next step; they are now reachable from a record still
 * holding unopened ciphertext, whose bodyless re-verify this same module
 * refuses `400 DECRYPTION_REQUIRED` before any fetch. Telling that caller to
 * re-verify would name the one action the route will not carry out.
 */
function classifyRecoveryFailure(
  thrown: unknown,
  site: 'queue-unavailable' | 'fetch-or-finalise',
  custody: ReverificationCustodySnapshot,
): CheckRunFailure {
  const resume = recoveryResumeGuidance(custody);
  // The store carrier exists to bring the earned checks out with the throw;
  // it never changes what the throw WAS, so the classification below reads
  // through it and every class-based branch sees exactly what was raised.
  const cause = thrown instanceof StoreAttemptFailedError ? thrown.cause : thrown;
  if (site === 'queue-unavailable') {
    return {
      code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      message: `The job queue could not be started to finalise this recovery. ${resume}`,
      retryable: true,
    };
  }
  if (cause instanceof EncryptionUnavailableError) {
    // The bare cause sentence ("Credential storage encryption is not
    // available.") was written for an immediate 500 on the register path,
    // where the caller reads it in the same breath as their request. Here it
    // lands on a settled generation, read later by a caller polling the
    // detail route who no longer has the request in mind, so it says what
    // became of their record and who has to act before they try again.
    return {
      code: CheckRunFailureCode.STORAGE_FAILED,
      message: `${cause.message} ${ENCRYPTION_UNAVAILABLE_RECOVERY_DETAIL} ${resume}`,
      retryable: true,
    };
  }
  if (cause instanceof StorageKeyMissingError) {
    return { code: CheckRunFailureCode.STORAGE_FAILED, message: cause.message, retryable: true };
  }
  // Classified by class rather than by catching at the storage-resolution
  // call site itself: `resolveStorage` is a dependency the recover pipeline
  // calls through an interface (`RegisterExternalCredentialDependencies`),
  // and isolating a boundary-specific catch there would need either a second
  // classifier duplicated at that call site or threading this one's decision
  // backward into a shared pipeline also used by `register` mode, which owns
  // no equivalent recovery-settlement concept to hand a classification to.
  // These three classes are unambiguous storage-configuration failures
  // wherever they are thrown, so recognising them here is exact, not a guess.
  // Storage is also the only service resolution the recover path ever
  // reaches at all (no other adapter is resolved between the fetch and the
  // finalisation), which is why attributing all three to storage
  // configuration, rather than naming the resolution generically, is safe.
  if (
    cause instanceof ServiceResolutionError ||
    cause instanceof ConfigDecryptionError ||
    cause instanceof ConfigValidationError
  ) {
    return {
      code: CheckRunFailureCode.STORAGE_FAILED,
      message: `This tenant's storage configuration could not be used to recover this record: ${cause.message}`,
      retryable: true,
    };
  }
  if (isContentDigestUniqueViolation(cause)) {
    return {
      code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      message: `This recovery collided twice with a concurrent write to the same content identity. ${resume}`,
      retryable: true,
    };
  }
  if (cause instanceof RecoveryLockDiscoveryExhaustedError) {
    // The error states only what happened; the next step is this function's
    // to choose, from the same custody every other settled failure here uses.
    return {
      code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      message: `${cause.message} ${resume}`,
      retryable: true,
    };
  }
  return {
    code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
    message: `Recovery could not be completed due to an unexpected error. ${resume}`,
    retryable: true,
  };
}

/**
 * The register dependencies the recovery pipeline runs on. `enqueueVerification`
 * is required on that type, but `mode: 'recover'` never reaches the code path
 * that calls it: the result travels back on the outcome instead, and
 * `finaliseRecoveryGeneration` enqueues it itself under its own lock, using the
 * `enqueue` it was given. The no-op below is never invoked; it exists only to
 * satisfy the type.
 */
function registerDepsFor(deps: ReverifyLibraryRecordDependencies) {
  return { ...defaultRegisterDependencies(async () => undefined), fetchDocument: deps.fetchSource };
}

/** Mode A: the shared pipeline over a supplier source this call is about to fetch. */
function recoverFromSource(
  deps: ReverifyLibraryRecordDependencies,
  input: RegisterExternalCredentialInput,
  options: RecoverFromSourceOptions,
): Promise<RecoverInRequestOutcome> {
  if (deps.recoverInRequest !== undefined) return deps.recoverInRequest(input, options);
  return settleInRequest(input, registerDepsFor(deps), options);
}

/** Mode B: the shared pipeline over bytes already read from the record's own durable copy. */
function recoverFromStoredCopy(
  deps: ReverifyLibraryRecordDependencies,
  input: AcquiredCredentialInput,
  options: RecoverFromStoredCopyOptions,
): Promise<RecoverInRequestOutcome> {
  if (deps.recoverInRequest !== undefined) return deps.recoverInRequest(input, options);
  return settleInRequest(input, registerDepsFor(deps), options);
}

function recorded(
  log: typeof logger,
  result: CreateReverificationGenerationResult,
): CreateReverificationGenerationResult {
  log.info(
    { outcome: result.outcome, generation: 'generation' in result ? result.generation : null },
    'Re-verification generation decision recorded',
  );
  return result;
}

function originOf(record: LibraryRecordDetailView): 'native' | 'external' {
  return record.origin === LibraryRecordOrigin.NATIVE ? 'native' : 'external';
}

function custodyOf(record: LibraryRecordDetailView): ReverificationCustodySnapshot {
  if (record.origin === LibraryRecordOrigin.NATIVE) {
    return {
      storageUri: record.credential.storageUri,
      storageDigestMultibase: record.credential.digestMultibase,
      storageExternalId: null,
      decryptionKeyPresent: record.credential.decryptionKey !== null,
      encrypted: null,
    };
  }
  return {
    storageUri: record.external.storageUri,
    storageDigestMultibase: record.external.storageDigestMultibase,
    storageExternalId: record.external.storageExternalId,
    decryptionKeyPresent: record.external.decryptionKey !== null,
    encrypted: record.external.encrypted,
  };
}

/**
 * Compares the supplier source against the digest the register recorded for
 * the pinned copy. Neither the copy nor that digest is written here.
 *
 * A source that cannot be read answers `sourceChanged: null` with the
 * timestamp still set, which is the wire contract's "a comparison was
 * attempted and could not be completed". Only the fetch is caught: a fault in
 * our own digest handling is not a statement about the supplier's server, so
 * it propagates and the request fails instead.
 */
async function checkSourceFreshness(
  log: typeof logger,
  sourceUrl: string,
  sourceDigest: string,
  fetchSource: (href: string) => Promise<FetchedDocument>,
): Promise<SourceFreshness> {
  const checkedAt = new Date(Date.now());
  let document: FetchedDocument;
  try {
    document = await fetchSource(sourceUrl);
  } catch (error) {
    if (error instanceof CredentialDocumentFetchError) {
      log.warn({ outcome: 'not_checked', reason: error.failure.reason }, 'Source freshness could not be checked');
    } else {
      // Guard rejections, DNS faults, timeouts and bad statuses all arrive
      // typed above. What reaches here is an internal fault, which is the
      // case that most needs its cause in the log.
      log.warn({ err: error, outcome: 'not_checked' }, 'Source freshness could not be checked');
    }
    return { sourceChanged: null, checkedAt };
  }
  // Checked through the recorded digest itself, so the algorithm and base are
  // read off the value the register wrote rather than restated here. Restating
  // them would report every source as changed the day either one moved.
  const unchanged = await MultibaseDigest.fromString(sourceDigest).verify(document.bytes);
  log.info({ outcome: unchanged ? 'unchanged' : 'changed' }, 'Source freshness checked');
  return { sourceChanged: !unchanged, checkedAt };
}
