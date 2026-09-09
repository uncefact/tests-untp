import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  CheckRunFailureCode,
  LibraryRecordOrigin,
  CheckRunState,
  type ExternalCredential,
} from '@/lib/prisma/generated';
import {
  CredentialDocumentFetchError,
  fetchCredentialDocument,
  type FetchedDocument,
} from '@/lib/credentials/fetch-credential-document';
import { ConfigDecryptionError, ConfigValidationError, NotFoundError, ServiceResolutionError } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
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
  type ReverificationCustodySnapshot,
  type SourceFreshness,
} from '@/lib/prisma/repositories/check-run.repository';
import { isContentDigestUniqueViolation } from '@/lib/prisma/repositories/external-credential.repository';
import type { SqlExecutor } from '@/lib/jobs/types';
import type { VerifyJobReference } from '@/lib/prisma/repositories/external-credential.repository';
import {
  defaultRegisterDependencies,
  settleInRequest,
  EncryptionUnavailableError,
  StorageKeyMissingError,
  type RecoverInRequestOutcome,
  type RegisterExternalCredentialInput,
} from './register-external-credential';

const logger = apiLogger.child({ module: 'reverify-library-record' });

/**
 * Refuses a record that already holds a durable copy of unopened ciphertext
 * (this is the only remaining synchronous 400. A no-copy record
 * now always fetches, per the fetched-content rule, rather than being
 * refused before attempting to; a fetch that returns unopenable ciphertext
 * on a no-copy record settles as a `202` generation with this same code
 * instead, either stored fresh or refusing to replace an identity the row
 * already holds).
 */
export class DecryptionRequiredError extends Error {
  readonly code = 'DECRYPTION_REQUIRED';

  constructor() {
    super(
      "This service holds no usable key for the record's durable copy. Re-verification with a caller-supplied key is not supported yet.",
    );
    this.name = 'DecryptionRequiredError';
  }
}

export type ReverifyLibraryRecordDependencies = {
  getRecord: (recordId: string, tenantId: string) => Promise<LibraryRecordDetailView | null>;
  fetchSource: (href: string) => Promise<FetchedDocument>;
  createGeneration: (input: CreateReverificationGenerationInput) => Promise<CreateReverificationGenerationResult>;
  /** The no-copy branch's own reserve step. */
  reserveGeneration: (
    input: Parameters<typeof reserveRecoveryGeneration>[0],
  ) => ReturnType<typeof reserveRecoveryGeneration>;
  /** The no-copy branch's own finalise step. */
  finaliseGeneration: (
    input: Parameters<typeof finaliseRecoveryGeneration>[0],
  ) => ReturnType<typeof finaliseRecoveryGeneration>;
  /** Test and integration seam for the shared in-request recovery pipeline. */
  recoverInRequest?: (
    input: RegisterExternalCredentialInput,
    currentRecordId: string,
    /** Whether the reservation's snapshot already held a content identity, so the pipeline can skip storing a response that cannot replace it. */
    holdsIdentity: boolean,
  ) => Promise<RecoverInRequestOutcome>;
};

export function defaultReverifyLibraryRecordDependencies(): ReverifyLibraryRecordDependencies {
  return {
    getRecord: getLibraryRecordById,
    fetchSource: (href) => fetchCredentialDocument(href),
    createGeneration: createReverificationGeneration,
    reserveGeneration: reserveRecoveryGeneration,
    finaliseGeneration: finaliseRecoveryGeneration,
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
 * Decides what a bodyless re-verification does with a record, prepares the
 * in-request work, and asks the repository to lock, recheck and append the
 * generation.
 *
 * This is the only owner of the precedence a caller sees: the record must
 * exist under the tenant, a pending generation is joined rather than
 * duplicated, and an external record is refused when the branch its stored
 * custody implies is unavailable. The route reads the request and projects
 * the answer, and repeats none of these decisions.
 *
 * The worker owns every read of the pinned copy. The protected external
 * branch only checks the supplier source here, and never replaces the copy.
 *
 * The no-copy external branch is a reserve-then-finalise
 * pair rather than one transaction: {@link reserveRecoveryGeneration} claims
 * generation N+1 as `PENDING` with no job under the parent's lock and
 * commits, so a concurrent caller joins that reservation instead of starting
 * a second fetch (criterion 5); the source is then fetched and, on success,
 * stored, entirely outside any transaction; {@link finaliseRecoveryGeneration}
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
 */
export async function reverifyLibraryRecord(
  recordId: string,
  tenantId: string,
  prepareEnqueue: PrepareEnqueue,
  deps: ReverifyLibraryRecordDependencies = defaultReverifyLibraryRecordDependencies(),
): Promise<ReverifyLibraryRecordResult> {
  const current = await deps.getRecord(recordId, tenantId);
  if (current === null) throw new NotFoundError('No such credential record.', 'NOT_FOUND');

  const log = logger.child({ recordId, tenantId, origin: originOf(current) });
  log.info('Re-verification entered');
  if (current.checkRun?.state === CheckRunState.PENDING) {
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
      await recoverNoCopyRecord(
        common,
        current.checkRun.generation,
        { ...external, sourceUrl: external.sourceUrl },
        prepareEnqueue,
        deps,
      ),
    );
  }
  if (external.decryptionKey === null) {
    if (external.encrypted === true) throw new DecryptionRequiredError();
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
 * The no-copy branch's own reserve/fetch/finalise sequence.
 * Every eligible no-copy row fetches; the fetched-content rule that
 * decides what a non-credential response does to an identity-holding row
 * lives in `finaliseRecoveryGeneration`, not here, because it needs the row
 * re-read under the finalisation lock rather than the snapshot this function
 * started with.
 */
async function recoverNoCopyRecord(
  common: CommonRecoveryInput,
  expectedGeneration: number,
  external: ExternalCredential & { sourceUrl: string },
  prepareEnqueue: PrepareEnqueue,
  deps: ReverifyLibraryRecordDependencies,
): Promise<CreateReverificationGenerationResult> {
  const reserved = await deps.reserveGeneration({ ...common, expectedGeneration });
  if (reserved.outcome !== 'reserved') return reserved;

  // Readied immediately after a successful reservation and before the fetch,
  // so a queue that will not start settles the reservation rather than
  // leaving a stored copy nothing will ever finalise. This is a queue
  // failure *after* a reservation already exists, so it settles the
  // generation FAILED and answers with it rather than failing the request;
  // a queue that will not start before any reservation exists (the native
  // and protected-copy branches) is unaffected and still fails the request.
  let enqueue: EnqueueVerification;
  try {
    enqueue = await prepareEnqueue();
  } catch (error) {
    const confirmed = await settleReservationOnThrow(reserved.checkRunId, common.tenantId, error, 'queue-unavailable');
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

  // Any throw from here on (the fetch, or finalisation) must still
  // settle the reservation this request made before propagating,
  // exactly as the queue-start failure above does, so a caller-visible error
  // never leaves a generation `PENDING` with no job for the sweep to find
  // thirty-plus minutes later.
  try {
    const attemptedAt = external.sourceDigest === null ? undefined : new Date(Date.now());
    const prepared = await recoverInRequest(
      {
        tenantId: common.tenantId,
        sourceUrl: external.sourceUrl,
        annotations: {
          displayName: external.displayName,
          declaredCredentialType: external.declaredCredentialType,
          ...(external.dateReceived === null ? {} : { dateReceived: external.dateReceived }),
          ...(external.notes === null ? {} : { notes: external.notes }),
        },
      },
      common.recordId,
      deps,
      // The reservation's own identity snapshot, read under the row lock it
      // took to claim generation N+1, not the entry read this function
      // started with: those two reads can straddle a concurrent identity
      // change, and it is the reservation's own lock that the fetch this
      // reservation authorises must treat as authoritative.
      reserved.identity.contentDigest !== null || reserved.identity.duplicateOfRecordId !== null,
    );
    const freshness =
      attemptedAt === undefined
        ? undefined
        : {
            sourceChanged: prepared.sourceDigest === undefined ? null : prepared.sourceDigest !== external.sourceDigest,
            checkedAt: attemptedAt,
          };

    return await deps.finaliseGeneration({
      recordId: common.recordId,
      tenantId: common.tenantId,
      checkRunId: reserved.checkRunId,
      generation: reserved.generation,
      ...(freshness === undefined ? {} : { freshness }),
      prepared,
      enqueue,
    });
  } catch (error) {
    const confirmed = await settleReservationOnThrow(reserved.checkRunId, common.tenantId, error, 'fetch-or-finalise');
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
): Promise<boolean> {
  const failure = classifyRecoveryFailure(cause, site);
  try {
    await settleCheckRunFailed({
      id: checkRunId,
      tenantId,
      checks: noChecksRun(),
      failure,
    });
    return true;
  } catch (settleError) {
    logger.error(
      { checkRunId, tenantId, err: settleError, cause },
      'Reserved recovery generation could not be settled after it could not be finalised',
    );
    return false;
  }
}

/**
 * Names the failed reservation's cause honestly rather than defaulting every
 * throw to the same generic message: an encryption or storage-resolution
 * failure names its own cause under `STORAGE_FAILED`; a finalisation that
 * collided twice on the same content identity (the repository's own bounded
 * retry already exhausted) is reported as a collision rather than an
 * unrelated fault; anything else is an unexpected throw, reported generically
 * with the run id already on the log line the caller writes.
 */
function classifyRecoveryFailure(cause: unknown, site: 'queue-unavailable' | 'fetch-or-finalise'): CheckRunFailure {
  if (site === 'queue-unavailable') {
    return {
      code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
      message: 'The job queue could not be started to finalise this recovery. Re-verify to try again.',
      retryable: true,
    };
  }
  if (cause instanceof EncryptionUnavailableError || cause instanceof StorageKeyMissingError) {
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
      message:
        'This recovery collided twice with a concurrent write to the same content identity. Re-verify to try again.',
      retryable: true,
    };
  }
  if (cause instanceof RecoveryLockDiscoveryExhaustedError) {
    return { code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE, message: cause.message, retryable: true };
  }
  return {
    code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
    message: 'Recovery could not be completed due to an unexpected error. Re-verify to try again.',
    retryable: true,
  };
}

async function recoverInRequest(
  input: RegisterExternalCredentialInput,
  currentRecordId: string,
  deps: ReverifyLibraryRecordDependencies,
  holdsIdentity: boolean,
): Promise<RecoverInRequestOutcome> {
  if (deps.recoverInRequest !== undefined) return deps.recoverInRequest(input, currentRecordId, holdsIdentity);
  // `enqueueVerification` on RegisterExternalCredentialDependencies is a
  // required field, but `mode: 'recover'` never reaches the code path that
  // calls it: the result travels back on the outcome instead, and
  // `finaliseRecoveryGeneration` enqueues it itself under its own lock, using
  // the `enqueue` it was given. The no-op below is never invoked; it exists
  // only to satisfy the type.
  const registerDeps = defaultRegisterDependencies(async () => undefined);
  return settleInRequest(
    input,
    { ...registerDeps, fetchDocument: deps.fetchSource },
    { mode: 'recover', currentRecordId, holdsIdentity },
  );
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
    };
  }
  return {
    storageUri: record.external.storageUri,
    storageDigestMultibase: record.external.storageDigestMultibase,
    storageExternalId: record.external.storageExternalId,
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
