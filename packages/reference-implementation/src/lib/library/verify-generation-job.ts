import { z } from 'zod';
import { readStoredCopyReadTimeoutMs } from '@/lib/config/stored-copy-read-timeout.config';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import {
  decryptCredentialToBytes,
  hasValidEnvelopeStructure,
  isEncryptedEnvelope,
  type EnvelopedVerifiableCredential,
  type IVerifiableCredentialService,
  type VerifyResult,
} from '@uncefact/untp-ri-services';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  ExternalContentKind,
  LibraryRecordOrigin,
  type CheckRun,
} from '@/lib/prisma/generated';
import {
  findCheckRun,
  settleCheckRunComplete,
  settleCheckRunFailed,
  checksOf,
  noChecksRun,
  type CheckResults,
  type CheckRunFailure,
  type CheckRunSettleOutcome,
  type SettleCheckRunCompleteInput,
  type SettleCheckRunFailedInput,
} from '@/lib/prisma/repositories/check-run.repository';
import { type VerifyJobReference } from '@/lib/prisma/repositories/external-credential.repository';
import { getLibraryRecordById } from '@/lib/prisma/repositories/library-record.repository';
import type { LibraryRecordDetailView } from '@/lib/library/library-record-view';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import type { EnqueueOptions, JobContext, JobHandler, JobQueue } from '@/lib/jobs/types';
import { LIBRARY_VERIFY_JOB } from '@/lib/jobs/queue-names';
import { apiLogger } from '@/lib/api/logger';
import { safeError } from '@/lib/api/safe-error';

/**
 * The asynchronous half of registration (#955, ADR-054): the verifier call
 * over the durable copy a register stored, settling the generation the
 * register left pending. Runs on the worker; the web process only enqueues
 * (in the record's transaction) and never works this queue.
 */

/** Re-exported so a caller enqueuing this job takes the name from the module that handles it. */
export { LIBRARY_VERIFY_JOB };

/**
 * A transient failure (storage or the verifier unreachable) is retried on
 * this ladder; the last attempt settles the run FAILED instead. The ladder
 * is minutes long so a short outage settles as a real outcome rather than
 * as a job that outlives the caller's patience; a longer one is what
 * re-verify (#957, #958) exists for. `expireSeconds` bounds one attempt at
 * more than the copy read (10 s) and the verifier call (60 s, raced in the
 * handler because the verifier takes no signal of its own) together.
 */
export const VERIFY_JOB_ENQUEUE_OPTIONS: EnqueueOptions = {
  retry: { limit: 4, backoffSeconds: 30, backoffMaxSeconds: 600 },
  expireSeconds: 120,
};

const logger = apiLogger.child({ module: 'verify-generation-job' });

/**
 * Typed against the reference the register side enqueues, so a field added
 * to one and not the other is a build error rather than a payload every
 * worker rejects.
 *
 * Unknown keys are stripped, not rejected, because a job is durable and a
 * rolling deploy (ADR-054) has an older worker claim jobs a newer web
 * process wrote. The rule that makes stripping safe: a field may be added
 * to this payload only if a worker that ignores it produces the same
 * business outcome (the same verifier instance, the same checks, the same
 * settlement). Observability-only fields qualify. Anything with business
 * effect, whatever its default, is a new queue name, worked only by workers
 * that know it. `VerifyJobReference` is the whole payload; the type-level
 * guard is `src/worker/payload-contract.test.ts`.
 */
const verifyJobReferenceSchema: z.ZodType<VerifyJobReference, z.ZodTypeDef, unknown> = z
  .object({
    tenantId: z.string().min(1),
    recordId: z.string().min(1),
    generation: z.number().int().min(1),
    checkRunId: z.string().min(1),
  } satisfies Record<keyof VerifyJobReference, z.ZodTypeAny>)
  .strip();

/** The ids a payload must still carry for the run it names to be settled at all. */
const settleableReferenceSchema = z.object({ tenantId: z.string().min(1), checkRunId: z.string().min(1) });

/** Reading the stored copy back is bounded like the details backfill's read of the same store. */
const MAX_STORED_COPY_BYTES = 16 * 1024 * 1024;

/** Inside the attempt's expiry (VERIFY_JOB_ENQUEUE_OPTIONS.expireSeconds) with room for the copy read before it. */
const VERIFIER_CALL_TIMEOUT_MS = 60_000;

/**
 * How reading the stored copy back failed. `transient`: storage could not be
 * reached or answered as temporarily unable, so a later attempt may read it.
 * `terminal`: storage answered and the copy is absent, refused or too large
 * to read, which no retry changes.
 */
export class StoredCopyReadError extends Error {
  constructor(
    readonly kind: 'transient' | 'terminal',
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'StoredCopyReadError';
  }
}

export type VerifyGenerationDependencies = {
  findRun: (recordId: string, generation: number, tenantId: string) => Promise<CheckRun | null>;
  getRecord: (recordId: string, tenantId: string) => Promise<LibraryRecordDetailView | null>;
  /**
   * Reads the stored copy back as bytes. The copy lives on this deployment's
   * own storage service. Bytes rather than text because an OPAQUE copy is
   * whatever the supplier served, and its integrity digest covers those exact
   * bytes: a UTF-8 decode and re-encode would change any body that is not
   * valid UTF-8 and report an intact copy as corrupt.
   */
  fetchStoredCopy: (uri: string) => Promise<Uint8Array>;
  revealStoredKey: (stored: string) => string | null;
  verifyDigest: (expected: string, data: Uint8Array) => Promise<boolean>;
  resolveVerifier: (tenantId: string) => Promise<IVerifiableCredentialService>;
  settleComplete: (input: SettleCheckRunCompleteInput) => Promise<CheckRunSettleOutcome>;
  settleFailed: (input: SettleCheckRunFailedInput) => Promise<CheckRunSettleOutcome>;
};

export function defaultVerifyGenerationDependencies(): VerifyGenerationDependencies {
  return {
    findRun: findCheckRun,
    getRecord: getLibraryRecordById,
    fetchStoredCopy: fetchStoredCopyBytes,
    revealStoredKey: revealDecryptionKey,
    verifyDigest: async (expected, data) => MultibaseDigest.fromString(expected).verify(data),
    resolveVerifier: async (tenantId) => (await resolveVcService(tenantId)).service,
    settleComplete: settleCheckRunComplete,
    settleFailed: settleCheckRunFailed,
  };
}

/**
 * What an operator must be told when a failure settles, beyond the caller's
 * own message. `classification` names what was observed, so a log search can
 * separate an absent object from one that failed its digest. Absent when the
 * failure is the caller's to resolve and nothing in the deployment is wrong.
 */
type OperatorSignal = { classification: string; message: string };

/**
 * A verification that could not run, carrying the failure the run settles
 * with. Job retry and the caller's `retryable` are two different questions:
 * the subclass fixes both, so a transient failure (retried by the queue,
 * `retryable: true` for the caller) and a terminal one (settled at once,
 * `retryable: false`) cannot be built the other way round.
 */
abstract class VerificationError extends Error {
  readonly failure: CheckRunFailure;
  readonly operator?: OperatorSignal;
  /**
   * What the worker had established when this was thrown: the copy was
   * retrieved, decrypted, and its digest checked. A failed settlement records
   * those results rather than the run's stored ones, so a generation created
   * with every check NOT_RUN does not report the copy as never fetched
   * beside a failure that only makes sense once it was.
   */
  checks?: CheckResults;

  constructor(
    failure: Omit<CheckRunFailure, 'retryable'>,
    retryable: boolean,
    cause: unknown,
    operator?: OperatorSignal,
  ) {
    super(failure.message, cause !== undefined ? { cause } : undefined);
    this.failure = { ...failure, retryable };
    this.operator = operator;
  }
}

/** The copy or the verifier was unreachable: rethrown while retries remain, settled on the final attempt. */
class TransientVerificationError extends VerificationError {
  constructor(failure: Omit<CheckRunFailure, 'retryable'>, cause: unknown, operator?: OperatorSignal) {
    super(failure, true, cause, operator);
    this.name = 'TransientVerificationError';
  }
}

/** A failure no retry can change: the run settles FAILED with it at once. */
class TerminalVerificationError extends VerificationError {
  constructor(failure: Omit<CheckRunFailure, 'retryable'>, cause?: unknown, operator?: OperatorSignal) {
    super(failure, false, cause, operator);
    this.name = 'TerminalVerificationError';
  }
}

export function verifyGenerationHandler(deps: VerifyGenerationDependencies): JobHandler<VerifyJobReference> {
  return async (payload, context) => {
    const parsed = verifyJobReferenceSchema.safeParse(payload);
    if (!parsed.success) {
      // A payload this process cannot read will not read better on a retry.
      // The run it names must not stay pending for ever on the strength of
      // a log line, so when the ids are readable it is settled as failed and
      // the caller can re-verify.
      logger.error({ jobId: context.jobId, issues: parsed.error.issues }, 'Verify job payload is not a run reference');
      const ids = settleableReferenceSchema.safeParse(payload);
      if (ids.success) {
        report(
          logger.child({ jobId: context.jobId, ...ids.data }),
          await deps.settleFailed({
            id: ids.data.checkRunId,
            tenantId: ids.data.tenantId,
            checks: noChecksRun(),
            failure: {
              code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
              message: 'Verification could not be scheduled for this generation; re-verify to run it again.',
              retryable: true,
            },
          }),
        );
      }
      return;
    }
    const job = parsed.data;
    const log = logger.child({ jobId: context.jobId, attempt: context.attempt, ...job });

    const run = await deps.findRun(job.recordId, job.generation, job.tenantId);
    if (run === null) {
      log.warn('Verify job names a run that does not exist; the record was probably deleted');
      return;
    }
    if (run.id !== job.checkRunId) {
      log.error(
        { expectedCheckRunId: job.checkRunId, actualCheckRunId: run.id },
        'Verify job reference does not match the stored generation; nothing was settled',
      );
      return;
    }
    if (run.state !== CheckRunState.PENDING) {
      log.info({ state: run.state }, 'Verify job found its run already settled; nothing to do');
      return;
    }
    const record = await deps.getRecord(job.recordId, job.tenantId);
    if (record === null) {
      log.warn('Verify job names a record that does not exist; the record was probably deleted');
      return;
    }

    let checks: CheckResults;
    try {
      checks = await verifyStoredCopy(record, run, deps, context);
    } catch (error) {
      if (error instanceof TransientVerificationError && !context.isFinalAttempt) {
        log.warn(
          { error: safeError(error), code: error.failure.code },
          'Verification could not run; the job will be retried',
        );
        throw error;
      }
      if (error instanceof VerificationError) {
        if (error.operator !== undefined) {
          // The caller's message tells them to re-verify; this line is the
          // separate signal for whoever runs the deployment, at a level their
          // alerting reads, carrying what was observed rather than a guess at
          // the cause. The child logger already binds the record, tenant,
          // generation and run.
          log.error(
            {
              classification: error.operator.classification,
              code: error.failure.code,
              readFailure: storedCopyReadDetail(error),
            },
            error.operator.message,
          );
        }
        log.warn(
          { error: safeError(error), code: error.failure.code, readFailure: storedCopyReadDetail(error) },
          'Verification could not run; settling the generation as failed',
        );
        report(
          log,
          await deps.settleFailed({
            id: run.id,
            tenantId: job.tenantId,
            checks: error.checks ?? checksOf(run),
            failure: error.failure,
          }),
        );
        return;
      }
      throw error;
    }
    report(log, await deps.settleComplete({ id: run.id, tenantId: job.tenantId, checks }));
  };
}

function report(log: typeof logger, outcome: CheckRunSettleOutcome): void {
  switch (outcome.outcome) {
    case 'applied':
      log.info('Generation settled');
      return;
    case 'superseded':
      log.warn('Generation was settled by another attempt before this one; nothing changed');
      return;
    case 'missing':
      log.warn('Generation no longer exists; the record was deleted before this attempt settled it');
      return;
  }
}

/**
 * The storage read failure behind a verification failure, or null. The
 * caller-facing message says only that the copy could not be read; the
 * attempt that settles the generation is the one an operator reads, and on
 * that attempt nothing else names the HTTP status or the size that caused it.
 * Only the wrapper's own message is taken, never the chain below it.
 */
function storedCopyReadDetail(error: VerificationError): string | null {
  return error.cause instanceof StoredCopyReadError ? error.cause.message : null;
}

/**
 * Runs the checks over the record's pinned copy, and hands whatever it had
 * established to the failure it raises. A re-verification generation is
 * created with every check NOT_RUN (#957), so without this a verifier outage
 * would tell the caller the copy was never retrieved and a digest mismatch
 * would report its own check as not run.
 */
async function verifyStoredCopy(
  record: LibraryRecordDetailView,
  run: CheckRun,
  deps: VerifyGenerationDependencies,
  context: JobContext,
): Promise<CheckResults> {
  const progress: { checks: CheckResults } = { checks: checksOf(run) };
  try {
    return await runStoredCopyChecks(record, deps, context, progress);
  } catch (error) {
    if (error instanceof VerificationError) error.checks = progress.checks;
    throw error;
  }
}

async function runStoredCopyChecks(
  record: LibraryRecordDetailView,
  deps: VerifyGenerationDependencies,
  context: JobContext,
  progress: { checks: CheckResults },
): Promise<CheckResults> {
  const base = progress.checks;
  const copy = copyOf(record);

  if (copy.storageUri === null) {
    // A pending generation is only ever created alongside a stored copy, so
    // this is a broken invariant; it settles as a copy that cannot be read.
    throw new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message:
          'No durable copy exists for this record, so there is nothing to verify; re-verify to fetch the source again.',
      },
      undefined,
      {
        classification: 'no-durable-copy',
        message: 'A pending verification generation exists for a record with no durable copy recorded',
      },
    );
  }

  // Read the object before using the recorded content kind. A missing or
  // corrupt object must be reported as a custody failure even when the row
  // says it once held HTML or another non-credential body.
  const stored = await readStoredCopy(
    copy.storageUri,
    copy.decryptionKey,
    copy.contentKind === ExternalContentKind.CREDENTIAL,
    deps,
    context,
  );
  const checks = {
    ...base,
    retrieval: CheckResult.PASS,
    decryption: stored.encrypted ? CheckResult.PASS : base.decryption,
  };
  progress.checks = checks;
  if (copy.storageDigestMultibase === null) {
    throw new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: 'The durable copy has no integrity digest recorded; an operator must inspect the stored record.',
      },
      undefined,
      {
        classification: 'digest-missing',
        message: 'A durable copy is recorded with no integrity digest, so it cannot be checked',
      },
    );
  }
  let digestMatches: boolean;
  try {
    digestMatches = await deps.verifyDigest(copy.storageDigestMultibase, stored.digestInput);
  } catch (error) {
    throw new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: 'The durable copy integrity digest could not be checked; an operator must inspect the stored record.',
      },
      error,
      {
        classification: 'digest-uncheckable',
        message: 'The recorded integrity digest could not be read, so the durable copy could not be checked',
      },
    );
  }
  if (!digestMatches) {
    // The comparison ran and answered no, so the check failed rather than
    // going unrun. Recorded before the throw so the settlement carries it.
    progress.checks = { ...checks, digest: CheckResult.FAIL };
    throw new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_CORRUPT,
        message: 'The durable copy failed its integrity digest check; an operator must inspect the stored object.',
      },
      undefined,
      {
        classification: 'digest-mismatch',
        message: 'A durable copy read back does not match the digest recorded when it was stored',
      },
    );
  }
  const checked = { ...checks, digest: CheckResult.PASS };
  progress.checks = checked;

  if (copy.contentKind !== ExternalContentKind.CREDENTIAL) {
    // The body was fetched and stored but is not an enveloped credential. The
    // proof check fails by definition; the verifier is not asked to sign off.
    return { ...checked, proof: CheckResult.FAIL };
  }
  // readStoredCopy throws `unreadable` for a CREDENTIAL copy whose content is
  // not a JSON object, so a copy that reaches this line always carries one.
  // Whether that object is a verifiable credential is the verifier's call: an
  // intact copy that is not one settles COMPLETE with the proof check failed.
  const credential = stored.credential as EnvelopedVerifiableCredential;

  let result: VerifyResult;
  try {
    // Resolving the tenant's verifier and calling it are one unavailability
    // for the caller: neither ran a check. The call has no signal of its own,
    // so it is bounded here; a hung request must not hold a worker slot past
    // the attempt's expiry or keep the final attempt from settling.
    result = await withTimeout(
      deps.resolveVerifier(record.record.tenantId).then((verifier) => verifier.verify(credential)),
      VERIFIER_CALL_TIMEOUT_MS,
      'the verifier call',
    );
  } catch (error) {
    throw new TransientVerificationError(
      {
        code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        message: 'The verification service could not be reached or failed; re-verify once it is available.',
      },
      error,
    );
  }
  // The verifier takes no signal, so an attempt the queue has abandoned is
  // caught here, after the call, rather than settling a result the queue
  // already counts as failed.
  throwIfAborted(context);
  return { ...checked, ...verifierChecks(result) };
}

type StoredCopy = {
  encrypted: boolean;
  digestInput: Uint8Array;
  credential: EnvelopedVerifiableCredential | null;
};

type CopyMetadata = {
  storageUri: string | null;
  storageDigestMultibase: string | null;
  decryptionKey: string | null;
  contentKind: ExternalContentKind | null;
};

function copyOf(record: LibraryRecordDetailView): CopyMetadata {
  if (record.origin === LibraryRecordOrigin.NATIVE) {
    return {
      storageUri: record.credential.storageUri,
      storageDigestMultibase: record.credential.digestMultibase,
      decryptionKey: record.credential.decryptionKey,
      contentKind: ExternalContentKind.CREDENTIAL,
    };
  }
  return {
    storageUri: record.external.storageUri,
    storageDigestMultibase: record.external.storageDigestMultibase,
    decryptionKey: record.external.decryptionKey,
    contentKind: record.external.contentKind,
  };
}

async function readStoredCopy(
  uri: string,
  storedKey: string | null,
  expectsCredential: boolean,
  deps: VerifyGenerationDependencies,
  context: JobContext,
): Promise<StoredCopy> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchStoredCopy(uri);
  } catch (error) {
    if (error instanceof StoredCopyReadError && error.kind === 'terminal') {
      throw new TerminalVerificationError(
        {
          code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
          message: `The durable copy could not be read back from storage (${error.message}); this needs an operator to inspect the stored object.`,
        },
        error,
        {
          classification: 'copy-absent-or-refused',
          message: 'A durable copy could not be read back from storage and no retry will change that',
        },
      );
    }
    throw new TransientVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: 'The durable copy could not be read back from storage; re-verify once storage is available.',
      },
      error,
    );
  }
  throwIfAborted(context);

  // A copy that cannot be opened as the document that was stored is
  // UNAVAILABLE rather than CORRUPT, even though a physical fault can produce
  // either: the digest preimage of a credential copy is the compact JSON of
  // the parsed object, so a body that does not parse has no preimage to
  // compare and the digest check never runs. CORRUPT is reserved for a copy
  // whose comparison ran and answered no.
  const unreadable = (detail: string, cause?: unknown) =>
    new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: `The durable copy could not be opened (${detail}); this needs an operator to inspect the stored object.`,
      },
      cause,
      {
        classification: 'copy-unreadable',
        message: `A durable copy was retrieved and could not be opened (${detail})`,
      },
    );

  // The bytes are the copy. They are decoded only to classify (is this JSON,
  // is it an encrypted envelope, is it a credential object), and the decoded
  // text is never digested or re-encoded back into a digest input.
  let parsed: unknown;
  let encrypted = false;
  let plaintextBytes = bytes;
  try {
    parsed = JSON.parse(asText(bytes));
  } catch (error) {
    if (expectsCredential) throw unreadable('it is not valid JSON', error);
    return { encrypted: false, digestInput: plaintextBytes, credential: null };
  }
  if (isEncryptedEnvelope(parsed)) {
    encrypted = true;
    if (storedKey === null) {
      // The copy is present and intact, so this is not an object an operator
      // can repair. What is missing is a key, and the form that carries one
      // is not built yet, so the caller is told that rather than sent to
      // storage. This message describes a record that does have a durable
      // copy: the route's own DECRYPTION_REQUIRED refusal
      // (`DecryptionRequiredError` in reverify-library-record.ts) covers that
      // same has-a-copy case synchronously, before this worker code ever
      // runs, not a no-copy sibling; a no-copy record is always reserved and
      // fetched rather than refused this way. The two deliberately share
      // this exact wording, so keep them in sync.
      throw new TerminalVerificationError({
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message:
          "This service holds no usable key for the record's durable copy. Re-verification with a caller-supplied key is not supported yet.",
      });
    }
    if (!hasValidEnvelopeStructure(parsed)) throw unreadable('its encrypted envelope is corrupted');
    let key: string | null;
    try {
      key = deps.revealStoredKey(storedKey);
    } catch (error) {
      throw new TransientVerificationError(
        {
          code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
          message:
            'The service could not unlock its stored decryption key; contact the operator, then re-verify once access is restored.',
        },
        error,
        {
          // A rotated-away key and a damaged envelope fail identically here,
          // so this says what was observed and points at the command that
          // tells the two apart, rather than asserting either.
          classification: 'stored-key-unwrap-failed',
          message:
            'A stored decryption key did not unwrap under the active DATA_ENCRYPTION_KEY; run audit:encryption to see which stored envelopes are affected',
        },
      );
    }
    if (key === null) throw unreadable('the stored key is empty');
    try {
      // Bytes, not the string form: the storage service digested the
      // plaintext it was handed, and a copy whose plaintext is not valid
      // UTF-8 does not survive a decode and re-encode.
      plaintextBytes = decryptCredentialToBytes({
        cipherText: parsed.cipherText,
        key,
        iv: parsed.iv,
        tag: parsed.tag,
        type: parsed.type,
      });
    } catch (error) {
      throw unreadable('the held key does not open it', error);
    }
    if (!expectsCredential) {
      // The storage service takes a non-credential body through its binary
      // endpoint, and the envelope that endpoint serves back decrypts to the
      // base64 of the stored bytes rather than to the bytes. A credential
      // goes through the credential endpoint instead and decrypts to its own
      // JSON. So the recorded content kind decides the encoding, and the
      // digest covers the bytes underneath it either way. Both observations
      // are pinned against the running service in
      // .claude/reviews/957-digest-preimage-evidence.md.
      const decoded = decodeBase64(asText(plaintextBytes));
      if (decoded === null) throw unreadable('its decrypted content is not the encoded copy the service serves');
      plaintextBytes = decoded;
    }
    try {
      parsed = JSON.parse(asText(plaintextBytes));
    } catch (error) {
      if (expectsCredential) throw unreadable('its decrypted content is not valid JSON', error);
      return { encrypted, digestInput: plaintextBytes, credential: null };
    }
  }
  if (expectsCredential && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw unreadable('its content is not a JSON object');
  }
  // The storage service digests what it was handed, before it encrypts, so an
  // encrypted and a plain store of the same body return the same digest. A
  // credential was handed over as the compact JSON of the object, so it is
  // re-serialised here to reproduce that preimage. Everything else was handed
  // over as bytes, so those bytes are the preimage exactly, once the base64
  // an encrypted non-credential copy is served as has been decoded above.
  // Pinned by the vector in verify-generation-job.digest-preimage.test.ts,
  // which carries a digest the storage service itself produced.
  const digestInput = expectsCredential ? new TextEncoder().encode(JSON.stringify(parsed)) : plaintextBytes;
  return {
    encrypted,
    digestInput,
    credential: expectsCredential ? (parsed as EnvelopedVerifiableCredential) : null,
  };
}

/**
 * The verifier reports one outcome and, on failure, one reason (#759 owns
 * finer granularity). A verified credential passed proof, status and the
 * temporal check; a failed one records the check its reason names as
 * failed and leaves the other two as not run, because the verifier did not
 * say whether it reached them.
 */
function verifierChecks(result: VerifyResult): Pick<CheckResults, 'proof' | 'status' | 'temporal'> {
  if (result.verified) {
    return { proof: CheckResult.PASS, status: CheckResult.PASS, temporal: CheckResult.PASS };
  }
  const notRun = { proof: CheckResult.NOT_RUN, status: CheckResult.NOT_RUN, temporal: CheckResult.NOT_RUN };
  // The adapter's error codes are the strings 'status', 'integrity' and
  // 'temporal' (services VerificationErrorCode); anything else is treated
  // as the proof failing, the adapter's own default.
  const type = result.error?.type;
  switch (String(type)) {
    case 'status':
      return { ...notRun, status: CheckResult.FAIL };
    case 'temporal':
      return { ...notRun, temporal: CheckResult.FAIL };
    case 'integrity':
      return { ...notRun, proof: CheckResult.FAIL };
    default:
      // A code this build does not know reads as a proof failure, the
      // adapter's own default, and says so, so a new code is not silent.
      logger.warn(
        { errorType: type ?? null },
        'Verifier reported a failure with no known type; recorded as a proof failure',
      );
      return { ...notRun, proof: CheckResult.FAIL };
  }
}

/**
 * Reads this deployment's own stored copy. A plain fetch rather than the
 * guarded resolver, for the reason the details backfill gives: the URI was
 * written by our storage adapter, not supplied by a caller, and a
 * deployment's storage service legitimately lives on a private address.
 */
async function fetchStoredCopyBytes(uri: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(uri, { signal: AbortSignal.timeout(readStoredCopyReadTimeoutMs()) });
  } catch (error) {
    throw new StoredCopyReadError('transient', 'storage could not be reached', error);
  }
  if (!response.ok) {
    // 408, 429 and the temporary 5xx may clear; every other status is
    // storage answering that the object is not there or cannot be served.
    const transient = [408, 429, 500, 502, 503, 504].includes(response.status);
    throw new StoredCopyReadError(transient ? 'transient' : 'terminal', `storage returned HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_STORED_COPY_BYTES) {
    throw new StoredCopyReadError(
      'terminal',
      `the copy of ${declared} bytes exceeds the ${MAX_STORED_COPY_BYTES}-byte read limit`,
    );
  }
  // Read in chunks and stop at the cap, counting bytes, so a body with no or
  // a wrong Content-Length cannot be buffered whole before it is refused.
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_STORED_COPY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new StoredCopyReadError('terminal', `the copy exceeds the ${MAX_STORED_COPY_BYTES}-byte read limit`);
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The copy decoded for classification only. Invalid sequences become U+FFFD,
 * which is what makes this unusable as a digest input and harmless as a way
 * to ask whether the body is JSON.
 */
function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

/**
 * The bytes a base64 string encodes, or null when the string is not base64.
 * `Buffer.from(text, 'base64')` accepts almost anything and silently drops
 * what it cannot read, so the result is re-encoded and compared: a string
 * that does not round-trip was never base64, and the copy is unreadable
 * rather than quietly digested as whatever survived.
 */
function decodeBase64(text: string): Uint8Array | null {
  const encoded = text.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  return Buffer.from(bytes).toString('base64') === encoded ? bytes : null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function throwIfAborted(context: JobContext): void {
  if (context.signal.aborted) {
    throw new TransientVerificationError(
      {
        code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        message: 'Verification was interrupted before it finished; re-verify to run it again.',
      },
      context.signal.reason,
    );
  }
}

/** Registers the library's handlers on a worker's queue (#985 owns the process that calls this). */
export function registerLibraryJobs(
  queue: JobQueue,
  deps: VerifyGenerationDependencies = defaultVerifyGenerationDependencies(),
): void {
  queue.register<VerifyJobReference>(LIBRARY_VERIFY_JOB, verifyGenerationHandler(deps), { concurrency: 4 });
}
