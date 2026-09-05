import { z } from 'zod';
import {
  decryptCredential,
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
  type CheckRun,
} from '@/lib/prisma/generated';
import {
  findCheckRun,
  settleCheckRunComplete,
  settleCheckRunFailed,
  CHECK_NAMES,
  noChecksRun,
  type CheckResults,
  type CheckRunFailure,
  type CheckRunSettleOutcome,
  type SettleCheckRunCompleteInput,
  type SettleCheckRunFailedInput,
} from '@/lib/prisma/repositories/check-run.repository';
import {
  getExternalCredentialById,
  type ExternalCredentialRecord,
  type VerifyJobReference,
} from '@/lib/prisma/repositories/external-credential.repository';
import { revealDecryptionKey } from '@/lib/credentials/decryption-key-protection';
import { resolveVcService } from '@/lib/services/resolve-vc-service';
import type { EnqueueOptions, JobContext, JobHandler, JobQueue } from '@/lib/jobs/types';
import { LIBRARY_VERIFY_JOB } from '@/lib/jobs/queue-names';
import { apiLogger } from '@/lib/api/logger';

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
  getRecord: (recordId: string, tenantId: string) => Promise<ExternalCredentialRecord | null>;
  /** Reads the stored copy back as text. The copy lives on this deployment's own storage service. */
  fetchStoredCopy: (uri: string) => Promise<string>;
  revealStoredKey: (stored: string) => string | null;
  resolveVerifier: (tenantId: string) => Promise<IVerifiableCredentialService>;
  settleComplete: (input: SettleCheckRunCompleteInput) => Promise<CheckRunSettleOutcome>;
  settleFailed: (input: SettleCheckRunFailedInput) => Promise<CheckRunSettleOutcome>;
};

export function defaultVerifyGenerationDependencies(): VerifyGenerationDependencies {
  return {
    findRun: findCheckRun,
    getRecord: getExternalCredentialById,
    fetchStoredCopy: fetchStoredCopyText,
    revealStoredKey: revealDecryptionKey,
    resolveVerifier: async (tenantId) => (await resolveVcService(tenantId)).service,
    settleComplete: settleCheckRunComplete,
    settleFailed: settleCheckRunFailed,
  };
}

/**
 * A verification that could not run, carrying the failure the run settles
 * with. Job retry and the caller's `retryable` are two different questions:
 * the subclass fixes both, so a transient failure (retried by the queue,
 * `retryable: true` for the caller) and a terminal one (settled at once,
 * `retryable: false`) cannot be built the other way round.
 */
abstract class VerificationError extends Error {
  readonly failure: CheckRunFailure;

  constructor(failure: Omit<CheckRunFailure, 'retryable'>, retryable: boolean, cause: unknown) {
    super(failure.message, cause !== undefined ? { cause } : undefined);
    this.failure = { ...failure, retryable };
  }
}

/** The copy or the verifier was unreachable: rethrown while retries remain, settled on the final attempt. */
class TransientVerificationError extends VerificationError {
  constructor(failure: Omit<CheckRunFailure, 'retryable'>, cause: unknown) {
    super(failure, true, cause);
    this.name = 'TransientVerificationError';
  }
}

/** A failure no retry can change: the run settles FAILED with it at once. */
class TerminalVerificationError extends VerificationError {
  constructor(failure: Omit<CheckRunFailure, 'retryable'>, cause?: unknown) {
    super(failure, false, cause);
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
        log.warn({ err: error, code: error.failure.code }, 'Verification could not run; the job will be retried');
        throw error;
      }
      if (error instanceof TransientVerificationError || error instanceof TerminalVerificationError) {
        log.warn(
          { err: error, code: error.failure.code },
          'Verification could not run; settling the generation as failed',
        );
        report(
          log,
          await deps.settleFailed({
            id: run.id,
            tenantId: job.tenantId,
            checks: checksOf(run),
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

/** The run's stored checks, the base every settlement merges its results into. */
function checksOf(run: CheckRun): CheckResults {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, run[name]])) as CheckResults;
}

async function verifyStoredCopy(
  record: ExternalCredentialRecord,
  run: CheckRun,
  deps: VerifyGenerationDependencies,
  context: JobContext,
): Promise<CheckResults> {
  const base = checksOf(run);
  const { external } = record;

  if (external.storageUri === null) {
    // A pending generation is only ever created alongside a stored copy, so
    // this is a broken invariant; it settles as a copy that cannot be read.
    throw new TerminalVerificationError({
      code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
      message:
        'No durable copy exists for this record, so there is nothing to verify; re-verify to fetch the source again.',
    });
  }

  if (external.contentKind !== ExternalContentKind.CREDENTIAL) {
    // The body was fetched and stored but is not an enveloped credential (a
    // page, an empty body, JSON of another shape). The proof check fails by
    // definition; the verifier is not asked to sign off on a non-credential.
    return { ...base, proof: CheckResult.FAIL };
  }

  const credential = await readCredential(external.storageUri, external.decryptionKey, deps, context);
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
  return { ...base, ...verifierChecks(result) };
}

async function readCredential(
  uri: string,
  storedKey: string | null,
  deps: VerifyGenerationDependencies,
  context: JobContext,
): Promise<EnvelopedVerifiableCredential> {
  let text: string;
  try {
    text = await deps.fetchStoredCopy(uri);
  } catch (error) {
    if (error instanceof StoredCopyReadError && error.kind === 'terminal') {
      throw new TerminalVerificationError(
        {
          code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
          message: `The durable copy could not be read back from storage (${error.message}); this needs an operator to inspect the stored object.`,
        },
        error,
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

  const unreadable = (detail: string, cause?: unknown) =>
    new TerminalVerificationError(
      {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: `The durable copy could not be opened (${detail}); this needs an operator to inspect the stored object.`,
      },
      cause,
    );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw unreadable('it is not valid JSON', error);
  }
  if (isEncryptedEnvelope(parsed)) {
    if (storedKey === null) throw unreadable('it is encrypted and no key is held for it');
    if (!hasValidEnvelopeStructure(parsed)) throw unreadable('its encrypted envelope is corrupted');
    let key: string | null;
    try {
      key = deps.revealStoredKey(storedKey);
    } catch (error) {
      throw unreadable('the stored key could not be unwrapped', error);
    }
    if (key === null) throw unreadable('the stored key is empty');
    let plaintext: string;
    try {
      plaintext = decryptCredential({
        cipherText: parsed.cipherText,
        key,
        iv: parsed.iv,
        tag: parsed.tag,
        type: parsed.type,
      });
    } catch (error) {
      throw unreadable('the held key does not open it', error);
    }
    try {
      parsed = JSON.parse(plaintext);
    } catch (error) {
      throw unreadable('its decrypted content is not valid JSON', error);
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw unreadable('its content is not a JSON object');
  }
  return parsed as EnvelopedVerifiableCredential;
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
async function fetchStoredCopyText(uri: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(uri, { signal: AbortSignal.timeout(10_000) });
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
  return Buffer.concat(chunks).toString('utf8');
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
