import { PgBoss, type JobWithMetadata, type SendOptions } from 'pg-boss';
import { JobQueueError } from './errors';
import type { EnqueueOptions, JobContext, JobHandler, JobQueue, RegisterOptions, SqlExecutor } from './types';

/**
 * Options for {@link PgBossJobQueue}. The database arrives by injection;
 * this class reads no environment and owns no connection policy.
 */
export interface PgBossJobQueueOptions {
  connectionString: string;
  /**
   * The Postgres schema pg-boss keeps its tables in. A named schema keeps
   * the queue's tables visibly separate from the application's and makes
   * removal a single `DROP SCHEMA`. Defaults to pg-boss's own default.
   */
  schema?: string;
  /** Applied where {@link EnqueueOptions.retry} is not given. */
  defaultRetry?: { limit: number; backoffSeconds?: number; backoffMaxSeconds?: number };
  /**
   * Receives queue-infrastructure errors and warnings (connection loss,
   * maintenance failures, a LISTEN/NOTIFY setup that fell back to polling)
   * and, on failure, the detail of handler exceptions, which are
   * deliberately not persisted to the queue's tables. Wire this to the
   * application logger; left unset, errors are written to stderr, because
   * an unobserved error stream is how a worker dies silently. Must not
   * throw; a throw from it is swallowed after being written to stderr.
   */
  onError?: (error: Error) => void;
}

type QueuePolicy = 'standard' | 'short';

interface Registration {
  name: string;
  handler: JobHandler<object>;
  options?: RegisterOptions;
}

/** The pg-boss implementation of {@link JobQueue}. */
export class PgBossJobQueue implements JobQueue<SqlExecutor> {
  private readonly boss: PgBoss;
  private readonly defaultRetry?: { limit: number; backoffSeconds?: number; backoffMaxSeconds?: number };
  private readonly onError: (error: Error) => void;
  private readonly registrations: Registration[] = [];
  /**
   * Queues verified to exist in pg-boss, by the policy they actually carry
   * there: 'standard' runs jobs independently; 'short' allows at most one
   * waiting job per singleton key, which is what dedupeKey maps to.
   * Deduplication is a property of the queue in pg-boss, so a queue with
   * the wrong policy silently ignores keys; this map is how a use that
   * contradicts the queue's real policy is caught and thrown instead.
   */
  private readonly knownQueues = new Map<string, QueuePolicy>();
  /** In-flight creations, so concurrent first sends to one queue serialise. */
  private readonly creating = new Map<string, Promise<void>>();
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private started = false;
  /**
   * Set when a shutdown failed partway: pg-boss stops workers before the
   * operations that can reject, so the instance is neither running nor
   * cleanly stopped. Only a successful stop() retry clears it.
   */
  private stopFailed = false;

  constructor(options: PgBossJobQueueOptions) {
    validateRetry(options.defaultRetry, 'defaultRetry');
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      // Workers are woken by LISTEN/NOTIFY the moment a job lands; polling
      // stays on as the correctness floor.
      useListenNotify: true,
      queueCacheIntervalSeconds: 5,
      ...(options.schema !== undefined ? { schema: options.schema } : {}),
    });
    this.defaultRetry = options.defaultRetry;
    const report = options.onError ?? ((error: Error) => console.error('job queue error:', error));
    // The reporter must never take the queue down with it: a throw from a
    // caller-supplied handler inside a worker callback would reject the
    // whole batch and persist the reporting exception as job output.
    this.onError = (error: Error) => {
      try {
        const result = report(error) as unknown;
        if (result instanceof Promise) {
          result.catch((reporterError: unknown) => console.error('job queue error handler rejected:', reporterError));
        }
      } catch (reporterError) {
        console.error('job queue error handler threw:', reporterError);
      }
    };
    // pg-boss is an EventEmitter; an unhandled 'error' event would crash
    // the process, so the stream is always observed, and 'warning' carries
    // operationally important facts (a failed LISTEN setup among them).
    // The cast is load-bearing only under @types/node 20, whose EventEmitter
    // is not generic; once @types/node surfaces EventEmitter<PgBossEventMap>,
    // drop the cast so event-name typos are caught again.
    const emitter = this.boss as unknown as {
      on(event: string, listener: (payload: Error | { message?: string }) => void): void;
    };
    emitter.on('error', (payload) =>
      this.onError(
        payload instanceof Error
          ? payload
          : // pg-boss emits plain objects here ({ message, stack, queue,
            // worker }); keep the message and the full payload as cause.
            new Error(payload?.message ?? String(payload), { cause: payload }),
      ),
    );
    emitter.on('warning', (payload) =>
      this.onError(
        new Error(
          `job queue warning: ${payload instanceof Error ? payload.message : payload?.message ?? String(payload)}`,
        ),
      ),
    );
  }

  async enqueueWithin<P extends object>(
    tx: SqlExecutor,
    name: string,
    payload: P,
    options?: EnqueueOptions,
  ): Promise<void> {
    validateEnqueueOptions(options);
    await this.ensureQueue(name, this.queuePolicy(options));
    await this.boss.send(name, payload, { ...this.sendOptions(options), db: tx });
  }

  async enqueue<P extends object>(name: string, payload: P, options?: EnqueueOptions): Promise<void> {
    validateEnqueueOptions(options);
    await this.ensureQueue(name, this.queuePolicy(options));
    await this.boss.send(name, payload, this.sendOptions(options));
  }

  async schedule(name: string, cron: string, payload?: object): Promise<void> {
    await this.ensureQueue(name, 'standard');
    // Cron ticks are dispatched by pg-boss without a singleton key. On a
    // deduplicating queue every unkeyed send shares one empty key, so ticks
    // would collapse into each other; ensureQueue('standard') above rejects
    // that combination before a schedule can be recorded.
    await this.boss.schedule(name, cron, payload ?? null, {});
  }

  async unschedule(name: string): Promise<void> {
    await this.boss.unschedule(name);
  }

  register<P extends object>(name: string, handler: JobHandler<P>, options?: RegisterOptions): void {
    if (this.started || this.startPromise !== undefined) {
      // Registration after start would silently never run; fail where the
      // mistake is.
      throw new JobQueueError({
        code: 'jobs.register-after-start',
        message: `register('${name}') called after start(); register all handlers first`,
      });
    }
    if (this.registrations.some((registration) => registration.name === name)) {
      // A second handler for one name would compete with the first for its
      // jobs, splitting the queue nondeterministically between them.
      throw new JobQueueError({
        code: 'jobs.duplicate-registration',
        message: `register('${name}') called twice; each job name has exactly one handler`,
      });
    }
    // Validated here rather than at start(), so a bad registration fails at
    // the line that wrote it and can never abort a boot after an earlier
    // registration's workers have begun claiming jobs.
    const concurrency = options?.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new JobQueueError({
        code: 'jobs.invalid-registration',
        message: `register('${name}'): concurrency must be a positive integer`,
        received: options?.concurrency,
      });
    }
    if (options?.perKeyConcurrency !== undefined) {
      if (!Number.isInteger(options.perKeyConcurrency) || options.perKeyConcurrency < 1) {
        throw new JobQueueError({
          code: 'jobs.invalid-registration',
          message: `register('${name}'): perKeyConcurrency must be a positive integer`,
          received: options.perKeyConcurrency,
        });
      }
      if (options.perKeyConcurrency > concurrency) {
        throw new JobQueueError({
          code: 'jobs.invalid-registration',
          message: `register('${name}'): perKeyConcurrency (${options.perKeyConcurrency}) cannot exceed concurrency (${concurrency})`,
        });
      }
    }
    this.registrations.push({ name, handler: handler as JobHandler<object>, options });
  }

  async start(): Promise<void> {
    // A start arriving during a shutdown waits the shutdown out first, so
    // it can never resolve against workers the pending stop then removes.
    // (Guarded, not optional-chained: an unconditional await would yield
    // even with no stop in flight, letting a concurrent caller interleave
    // before startPromise is assigned.)
    if (this.stopPromise !== undefined) {
      await this.stopPromise.catch(() => undefined);
    }
    if (this.stopFailed) {
      // The failed shutdown already removed workers, so resolving against
      // the old start state would report a queue that is not working.
      throw new JobQueueError({
        code: 'jobs.stop-incomplete',
        message: 'a shutdown failed partway; retry stop() until it succeeds before starting again',
      });
    }
    // Concurrent starts share one boot; a second caller waits on the first
    // rather than booting a duplicate set of workers.
    this.startPromise ??= (async () => {
      try {
        await this.boot();
      } catch (error) {
        // A failed boot must not leave pg-boss's timers and connections
        // holding the process open; release them fully before clearing the
        // in-flight marker, so a concurrent retry cannot boot into the
        // middle of this cleanup. The boot error stays the caller's error.
        this.started = false;
        try {
          await this.boss.stop({ graceful: false });
        } catch (stopError) {
          // The cleanup itself failed, so the instance is half torn down
          // exactly as after a failed public stop(): take the same latch so
          // stop() stays retryable and start() refuses until it succeeds.
          this.stopFailed = true;
          this.onError(stopError instanceof Error ? stopError : new Error(String(stopError)));
        }
        this.startPromise = undefined;
        throw error;
      }
    })();
    await this.startPromise;
  }

  private async boot(): Promise<void> {
    await this.boss.start();
    // Phase one: create, verify, and converge every registered queue before
    // any worker exists, so a boot that fails validation has processed
    // nothing that a stop cannot undo.
    for (const registration of this.registrations) {
      if (registration.options?.deadLetterQueue !== undefined) {
        await this.ensureQueue(registration.options.deadLetterQueue, 'standard');
      }
      const policy: QueuePolicy = registration.options?.dedupeWaiting ? 'short' : 'standard';
      await this.ensureQueue(registration.name, policy);
      // The registration is the whole authority on the queue's
      // configuration pg-boss lets us change after creation, and
      // createQueue leaves an existing queue untouched, so converge it:
      // the dead-letter link both ways (declare it, or clear one left
      // behind) and the notify wake-up flag a foreign creator may lack.
      await this.boss.updateQueue(registration.name, {
        deadLetter: registration.options?.deadLetterQueue ?? null,
        notify: true,
      });
    }
    // Phase two: every declaration held; start the workers.
    for (const registration of this.registrations) {
      await this.boss.work(
        registration.name,
        {
          includeMetadata: true,
          perJobResults: true,
          // localConcurrency is pg-boss's independent-workers knob: each
          // worker fetches, runs, and settles one job on its own. Batched
          // fetching is deliberately not used: jobs in a pg-boss batch
          // share one timeout and abort signal, settle only when the whole
          // batch returns, and job ids are reused across retries, so no
          // settlement issued from inside a batch callback can be scoped
          // to the attempt that produced it.
          batchSize: 1,
          // New jobs wake workers via LISTEN/NOTIFY; the tight poll is the
          // floor that drains an already-queued backlog, whose size only
          // reaches pg-boss's stats (and so its burst mode) on a monitor
          // cycle too slow to lean on.
          pollingIntervalSeconds: 0.5,
          notifyPollingIntervalSeconds: 0.5,
          ...(registration.options?.concurrency !== undefined
            ? { localConcurrency: registration.options.concurrency }
            : {}),
          // localGroupConcurrency is the strict in-process cap (synchronous
          // accounting, so concurrent workers cannot race past it). The
          // database-coordinated alternative (groupConcurrency, mutually
          // exclusive with it in pg-boss) is approximate even within one
          // process because concurrent fetches race its active-count check.
          ...(registration.options?.perKeyConcurrency !== undefined
            ? { localGroupConcurrency: registration.options.perKeyConcurrency }
            : {}),
        },
        async (jobs: JobWithMetadata<object>[]) =>
          Promise.all(
            jobs.map(async (job) => {
              const context: JobContext = {
                jobId: job.id,
                attempt: job.retryCount + 1,
                isFinalAttempt: job.retryCount >= job.retryLimit,
                signal: job.signal,
              };
              try {
                await registration.handler(job.data, context);
                return { id: job.id, status: 'completed' as const };
              } catch (error) {
                // The failure is recorded without the exception's text: job
                // rows and their dead-letter copies persist as plain text,
                // and exception messages routinely carry URLs, inputs, and
                // other material the confidentiality contract keeps out of
                // the queue's tables. The detail goes to the error channel.
                this.onError(
                  error instanceof Error
                    ? error
                    : new Error(`job '${registration.name}' ${job.id} failed: ${String(error)}`),
                );
                return { id: job.id, status: 'failed' as const };
              }
            }),
          ),
      );
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    if (this.startPromise === undefined && !this.started && !this.stopFailed) return;
    // Wait out an in-flight start (whatever its outcome) so stop never
    // returns while a boot is still bringing workers up behind it.
    await this.startPromise?.catch(() => undefined);
    if (!this.started && !this.stopFailed) return;
    // Concurrent stops share one shutdown; started flips only on success so
    // a failed stop can be retried.
    this.stopPromise ??= this.boss.stop({ graceful: true }).then(
      () => {
        this.started = false;
        this.startPromise = undefined;
        this.stopPromise = undefined;
        this.stopFailed = false;
      },
      (error: unknown) => {
        // A failed shutdown is indeterminate (pg-boss removes workers
        // before the operations that can reject): stay stoppable by
        // clearing the in-flight marker, and record the failure so start()
        // refuses to resolve against the half-torn-down state.
        this.stopPromise = undefined;
        this.stopFailed = true;
        throw error;
      },
    );
    await this.stopPromise;
  }

  private queuePolicy(options?: EnqueueOptions): QueuePolicy {
    return options?.dedupeKey !== undefined ? 'short' : 'standard';
  }

  private sendOptions(options?: EnqueueOptions): SendOptions {
    const retry = options?.retry ?? this.defaultRetry;
    return {
      ...(options?.dedupeKey !== undefined ? { singletonKey: options.dedupeKey } : {}),
      ...(options?.fairnessKey !== undefined ? { group: { id: options.fairnessKey } } : {}),
      ...(options?.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
      ...(options?.expireSeconds !== undefined ? { expireInSeconds: options.expireSeconds } : {}),
      ...(retry !== undefined
        ? {
            retryLimit: retry.limit,
            ...(retry.backoffSeconds !== undefined ? { retryDelay: retry.backoffSeconds, retryBackoff: true } : {}),
            ...(retry.backoffMaxSeconds !== undefined ? { retryDelayMax: retry.backoffMaxSeconds } : {}),
          }
        : {}),
    };
  }

  /**
   * pg-boss requires a queue to exist before jobs are sent to it or worked
   * from it, and whether `dedupeKey` deduplicates is a property of the
   * QUEUE (its policy), not of the send. Creation is create-if-absent in
   * pg-boss (a losing racer's options are silently ignored), so after
   * creating, the policy the queue ACTUALLY carries is read back and
   * cached; a use that contradicts it fails loudly, because the silent
   * alternative is dedupe keys that look respected and are inert.
   */
  private async ensureQueue(name: string, policy: QueuePolicy): Promise<void> {
    const known = this.knownQueues.get(name);
    if (known !== undefined) {
      if (known !== policy) {
        throw new JobQueueError({
          code: 'jobs.queue-policy-mismatch',
          message:
            `queue '${name}' is '${known}' but this use needs '${policy}': ` +
            `use dedupeKey on every send to a deduplicating queue, and never schedule one`,
        });
      }
      return;
    }
    // Concurrent first uses of one name share the first caller's creation;
    // every waiter re-runs the check above against the cached result.
    const inFlight = this.creating.get(name);
    if (inFlight !== undefined) {
      await inFlight;
      return this.ensureQueue(name, policy);
    }
    const creation = this.boss
      .createQueue(name, { policy, notify: true })
      .then(async () => {
        const stored = await this.boss.getQueue(name);
        if (stored === null) {
          throw new JobQueueError({
            code: 'jobs.queue-create-failed',
            message: `queue '${name}' was not found after creating it`,
          });
        }
        const storedPolicy: string = stored.policy ?? 'standard';
        if (storedPolicy !== 'standard' && storedPolicy !== 'short') {
          // A queue created by another client under a policy this adapter
          // does not model would be worked under wrong assumptions; refuse
          // it rather than quietly treating it as standard.
          throw new JobQueueError({
            code: 'jobs.unsupported-queue-policy',
            message: `queue '${name}' exists with policy '${storedPolicy}', which this job queue does not support`,
          });
        }
        this.knownQueues.set(name, storedPolicy);
      })
      .finally(() => {
        this.creating.delete(name);
      });
    this.creating.set(name, creation);
    await creation;
    return this.ensureQueue(name, policy);
  }
}

function validateRetry(
  retry: { limit: number; backoffSeconds?: number; backoffMaxSeconds?: number } | undefined,
  label: string,
): void {
  if (retry === undefined) return;
  if (!Number.isInteger(retry.limit) || retry.limit < 0) {
    throw new JobQueueError({
      code: 'jobs.invalid-retry',
      message: `${label}.limit must be a non-negative integer`,
      received: retry.limit,
    });
  }
  for (const field of ['backoffSeconds', 'backoffMaxSeconds'] as const) {
    const value = retry[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new JobQueueError({
        code: 'jobs.invalid-retry',
        message: `${label}.${field} must be a positive integer`,
        received: value,
      });
    }
  }
  if (retry.backoffMaxSeconds !== undefined && retry.backoffSeconds === undefined) {
    // Without a starting delay there is no backoff ladder for the cap to
    // apply to, and the underlying store rejects the combination.
    throw new JobQueueError({
      code: 'jobs.invalid-retry',
      message: `${label}.backoffMaxSeconds requires ${label}.backoffSeconds`,
    });
  }
}

function validateEnqueueOptions(options: EnqueueOptions | undefined): void {
  if (options === undefined) return;
  validateRetry(options.retry, 'retry');
  if (
    options.expireSeconds !== undefined &&
    (!Number.isInteger(options.expireSeconds) || options.expireSeconds < 1 || options.expireSeconds > 24 * 60 * 60)
  ) {
    throw new JobQueueError({
      code: 'jobs.invalid-enqueue-options',
      message: 'expireSeconds must be a positive integer of at most 24 hours',
      received: options.expireSeconds,
    });
  }
  if (options.fairnessKey !== undefined && options.fairnessKey.length === 0) {
    throw new JobQueueError({
      code: 'jobs.invalid-enqueue-options',
      message: 'fairnessKey must be a non-empty string',
    });
  }
}
