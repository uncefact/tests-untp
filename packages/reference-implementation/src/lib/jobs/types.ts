/**
 * Contracts every implementation and every handler must honour:
 *
 * - **At-least-once.** A handler may run more than once for the same job and
 *   must tolerate the re-run.
 * - **Final-attempt settlement.** A handler is invoked at most once with
 *   {@link JobContext.isFinalAttempt} true, and settles its own domain state
 *   there (for example, failing a verification generation with a named
 *   code). That invocation is not guaranteed to complete: it can be aborted
 *   ({@link JobContext.signal}: expiry, shutdown) or lost outright (process
 *   death, queue retention expiring during a retry backoff), so settlement
 *   work belongs in a `finally` where the handler can manage it, and the
 *   application owns reconciling records left unsettled by a lost attempt.
 *   Domain correctness never depends on a dead-letter mechanism.
 * - **Payloads are JSON.** A payload is serialised to JSON at enqueue and the
 *   handler receives the round-tripped value, so only plain JSON-safe data
 *   survives (no Dates, class instances, or BigInt).
 * - **Payloads and failure output never carry sensitive material.** Work
 *   that needs a caller-supplied secret (for example, a decryption key) runs
 *   inside the request that carried the secret and is never enqueued, and an
 *   implementation persists no handler exception text, because job rows and
 *   their dead-letter copies are long-lived plain text.
 * - **Payloads carry references, never content.** A payload holds identifiers
 *   and parameters (a tenant id, a record id, a flag); the handler loads the
 *   substance from its store. Payloads persist in plain text in the queue's
 *   tables and outlive the job when dead-lettered, so credential content or
 *   personal data placed in one becomes an unencrypted long-lived copy
 *   outside the protections its home store gives it.
 */

/** Facts about the running attempt, passed to every handler. */
export interface JobContext {
  jobId: string;
  /** 1-based: the first run of a job is attempt 1. */
  attempt: number;
  /**
   * True when no retry remains if this attempt fails. The attempt itself can
   * still be cut short; see the final-attempt settlement contract above.
   */
  isFinalAttempt: boolean;
  /** Fires when the queue asks the handler to stop (shutdown, expiry). */
  signal: AbortSignal;
}

export type JobHandler<P> = (payload: P, context: JobContext) => Promise<void>;

export interface EnqueueOptions {
  /**
   * At most one waiting job per key: while a job with this key sits waiting
   * to be picked up for the first time, another enqueue with the same key is
   * a no-op. The slot covers first-time waiting only. A job that is running,
   * or waiting out a retry backoff, does not hold it, so "refresh X"
   * collapses while queued but a request arriving mid-run or mid-retry
   * still gets a fresh job.
   */
  dedupeKey?: string;
  /** Do not run before this time. */
  startAfter?: Date;
  /**
   * How failures are retried. `limit` is the number of retries after the
   * first attempt; 0 means the job is never retried. `backoffSeconds` is the
   * starting delay of an exponential backoff; `backoffMaxSeconds` caps each
   * individual delay (choose the limit and delays together so the whole
   * ladder fits inside the queue's retention of the job).
   * Omitted, the implementation's default applies.
   */
  retry?: { limit: number; backoffSeconds?: number; backoffMaxSeconds?: number };
  /**
   * The most seconds one attempt may run before the queue aborts it via
   * {@link JobContext.signal} and treats it as failed. Omitted, the
   * implementation's default applies. Set it above the handler's real
   * worst case: an expired final attempt is one of the lost-settlement
   * cases the application must reconcile.
   */
  expireSeconds?: number;
  /**
   * Groups this job under a key (typically the tenant id) for the per-key
   * running cap declared at registration. The cap bounds how much capacity
   * one key's jobs occupy at once; it does not reorder waiting jobs, so it
   * is a concurrency limit, not a scheduling-fairness guarantee.
   */
  fairnessKey?: string;
}

export interface RegisterOptions {
  /** How many jobs of this name one worker process runs at once. Default 1. */
  concurrency?: number;
  /**
   * Declare that this job's queue deduplicates waiting jobs by
   * {@link EnqueueOptions.dedupeKey}. Deduplication is a property of the
   * queue, so the worker declares it here and every enqueue to the queue
   * must then carry a key; a keyed send to an undeclared queue fails loudly
   * rather than silently not deduplicating.
   */
  dedupeWaiting?: boolean;
  /**
   * At most this many jobs run at once per {@link EnqueueOptions.fairnessKey},
   * enforced strictly within one worker process. Cannot exceed
   * {@link RegisterOptions.concurrency}: the per-key cap carves slots out of
   * the worker pool, so a cap larger than the pool is a misdeclaration and
   * is rejected at registration. Replicas do not coordinate
   * the cap between them, so a key's fleet-wide bound is this value times
   * the number of worker replicas. Slots left by one key's queue-full go to
   * other keys' jobs.
   */
  perKeyConcurrency?: number;
  /**
   * Operational telemetry only: when a job exhausts its retries, copy its
   * payload to this queue. Domain state never depends on it; a handler
   * settles its own outcome on the final attempt. Omitting it clears any
   * link a previous registration declared: the registration is the whole
   * authority on the queue's dead-letter configuration.
   */
  deadLetterQueue?: string;
}

/**
 * The transaction handle {@link JobQueue.enqueueWithin} accepts: one method,
 * so any SQL client or ORM transaction can be adapted to it.
 */
export interface SqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * `Tx` is the transaction handle the implementation's store uses; each
 * implementation names its own (the pg-boss implementation takes a
 * {@link SqlExecutor}).
 *
 * Every sending and scheduling method requires {@link start} to have been
 * called first on this instance.
 */
export interface JobQueue<Tx = SqlExecutor> {
  /**
   * Enqueue atomically with the caller's own writes, inside the caller's
   * open transaction: the records and the job both commit, or neither does.
   * There is no state where a record exists with no job to process it, or a
   * job runs for records that rolled back.
   */
  enqueueWithin<P extends object>(tx: Tx, name: string, payload: P, options?: EnqueueOptions): Promise<void>;

  /** Enqueue in its own transaction. */
  enqueue<P extends object>(name: string, payload: P, options?: EnqueueOptions): Promise<void>;

  /**
   * Run `name` on a cron schedule. However many worker replicas run, each
   * tick dispatches once. Ticks are dispatched without a dedupe key, so a
   * queue declared as deduplicating cannot be scheduled; scheduling one
   * fails loudly.
   */
  schedule(name: string, cron: string, payload?: object): Promise<void>;

  /** Remove a schedule created by {@link schedule}. */
  unschedule(name: string): Promise<void>;

  /**
   * Create the queue for `name` now, if it does not exist, with the policy
   * a deduplicating or plain queue needs. A process that only sends (the
   * web process) calls this at boot so its first transactional send is one
   * insert inside the caller's transaction rather than queue creation on
   * first use, which would hold that transaction open for the creation.
   * Idempotent, and consistent with a later registration of the same name:
   * a policy that contradicts the queue's real one fails loudly.
   */
  declareQueue(name: string, options?: Pick<RegisterOptions, 'dedupeWaiting'>): Promise<void>;

  /**
   * Declare the handler for a job name. Registration is local mutation;
   * handlers start running when {@link start} is called. Each name is
   * registered at most once.
   */
  register<P extends object>(name: string, handler: JobHandler<P>, options?: RegisterOptions): void;

  /**
   * Start the queue. The web process calls this to enqueue and schedule; a
   * worker process registers handlers first and this starts them working.
   * Every registration is validated against the store before any handler
   * runs, so a failed start has processed nothing.
   */
  start(): Promise<void>;

  /** Stop working and release resources. Safe to call more than once. */
  stop(): Promise<void>;
}
