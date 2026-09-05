# ADR-054: Background work runs on a worker, and Postgres is the queue

- **Date:** 2026-08-31
- **Status:** accepted — supersedes ADR-033's in-process execution model and one ADR-055 statement on key-bearing recovery; both carry dated update lines pointing here.
- **Update (2026-09-05):** #985 landed decision 1's worker container and entrypoint, and the boot and stop contract it needed is recorded on the Startup operations page (`documentation/docs/reference-implementation/operations/startup.md`, "Worker Boot"). Four facts about it are not derivable from the decisions above. The worker runs no migrations, backfills or seed, and instead checks at boot that every migration its own build ships is already applied, so a database ahead of the worker passes and a rolling deploy's older worker still starts. It refuses to boot without `DATA_ENCRYPTION_KEY`, which decision 6 does not cover because that key belongs to the deployment rather than to a caller. It serves no HTTP, so it proves itself by publishing a heartbeat file whose age the container health check reads, and an unhealthy worker is a signal for an orchestrator rather than a reason for the process to exit. Its stop is bounded by a job drain inside a process deadline inside the container's grace period, so the runtime never kills a worker that is still shutting down on its own terms. The version-skew window named under Consequences also gains a queue-side rule, because a worker strips payload keys it does not recognise. A new payload field may only be observability and must be optional, and anything with business effect is a new queue name instead, a rule the type guard in `packages/reference-implementation/src/worker/payload-contract.test.ts` holds each payload to. Decision 7 is not executed. The conformity-scheme refresh still runs on the in-process interval in the web boot, and moving it onto the queue is outstanding.

## Context

The reference implementation is one Next.js container against Postgres. ADR-033 recorded that adding a worker process, a message broker, or a cron container was undesirable, and at the time the whole inventory of background work was one small task: the conformity-scheme refresh, run on an in-process interval in the Next.js startup hook. ADR-033 itself flagged that interval's limit: every replica runs it, so it only works while the deployment is single-replica.

That inventory has outgrown the constraint. The credential library needs verification work that outlives a request: registering an external credential fetches, stores, and verifies it while the caller polls (#955), and re-verification does the same for records we already hold (#957). Bulk issuance (#663) is a fan-out of long work by definition. Each of these, built without a worker, has to either run inside a web request and hope the process survives it, or hand-roll its own claim and retry machinery in the web container. The idempotency work (ADR-051) already built claim machinery for request deduplication; the library's verification would have needed a second, different machine for background retries.

For an application whose only stateful dependency is Postgres, the established pattern is to make Postgres the queue: a claims table worked with `SELECT ... FOR UPDATE SKIP LOCKED`, consumed by a worker process. Mature libraries package that pattern with retries, backoff, scheduling, and completed-job retention (`pg-boss` and Graphile Worker in Node), and the pattern is mainstream enough that Rails made a database-backed queue its default from Rails 8. A broker (Redis, RabbitMQ) buys lower latency at the price of a second stateful service every operator must run, and nothing here needs that latency at this time.

So the question is: where does background work run, now that there is more of it than one interval?

## Decision

1. **A dedicated worker runs background work: the same image, a second container, a different entrypoint.**
   The web container serves requests; the worker consumes jobs. This supersedes ADR-033's no-worker constraint, and only that: ADR-033's other decisions stand, and it gains an update line pointing here.
   The worker is the same image so there is one build, one version, and one set of dependencies; what differs is the process each container starts. The worker container and entrypoint land with #985.

2. **Postgres is the queue. There is no broker.**
   The jobs live in the same database as everything else, serialised by the database itself. The deployment's only stateful dependency stays Postgres, which is the property that makes this stack cheap to operate and to hand to others.

3. **`pg-boss` provides the machinery, behind a `JobQueue` interface application code depends on; we do not hand-roll it.**
   Claiming, retries with backoff, scheduled jobs, and completed-job retention are solved problems, and hand-rolling them is how the codebase ends up with three claim machines. `pg-boss` is chosen over Graphile Worker for its retention model: pg-boss keeps completed jobs for a configurable window, where Graphile Worker deletes them on success, and that window is what lets an operator answer "what ran" without a second logging store. Application code enqueues, registers handlers, and schedules through the `JobQueue` interface (`packages/reference-implementation/src/lib/jobs`), so the library behind the interface can be replaced without touching callers.

4. **When a request commits state whose progression depends on a job, the job is enqueued in that same transaction.**
   The job row and the `pending` state it will settle are rows in one database, so one commit covers both (`enqueueWithin`). A caller is never told "accepted" on the strength of anything less than a committed row, and a crash can lose in-flight computation, never the fact that work was owed. Work with no accepting record (a fire-and-forget task, a scheduled tick) legitimately enqueues outside any caller transaction.

5. **A job carries references to records, never domain truth, content, or secrets.**
   What a verification concluded lives on the record's generations (ADR-053) and nowhere else. A job resource, including #663's, says how far along it is and which records it touched; a consumer can never read the same status from two places that could disagree. Payloads name records and parameters, never credential content, personal data, or key material, and handler exception text is never persisted either, because job rows and their dead-letter copies are long-lived plain text in the queue's tables, outside the protections the records' own stores give them.

6. **Work is at-least-once, and work that cannot be retried says so when it is enqueued.**
   A handler must tolerate running twice for the same job; that is the price of never losing accepted work. Work whose repeat would mislead is enqueued with a retry limit of zero: it fails once, with a code that tells the caller how to resume, instead of retrying into a lie. Work that needs a caller-supplied secret is never enqueued at all. A job payload is a persisted row, so enqueueing the secret would store it, and ADR-055 forbids exactly that. The work runs inside the request that carried the secret instead. This replaces ADR-055's statement that key-bearing recovery runs as a non-retryable job; the custody rules themselves (the key is never persisted, failure names a resume code) are unchanged.

8. **The application reconciles work the queue loses; the dead-letter queue is telemetry, never correctness.**
   A final attempt is not guaranteed to complete: it can be aborted by expiry or shutdown, lost to process death, or deleted when queue retention passes during a retry backoff. Transactional enqueue preserves the record that says work is owed, not the job's execution. So each feature that leaves records `pending` owns a reconciliation path for records whose job never settled them, and no domain outcome ever depends on a payload reaching the dead-letter queue, which exists so an operator can see what failed.

7. **Scheduled work moves onto the queue.**
   The conformity-scheme refresh leaves the instrumentation-hook interval and becomes a scheduled job, which fixes the multi-replica flaw ADR-033 accepted: the queue dispatches each tick to one worker, however many replicas exist. Anything periodic that arrives later starts here rather than adding another interval.

## Consequences

Positive:

- Long work has one home with retries, scheduling, and recovery owned by one library, instead of each feature hand-rolling a claim machine in the web container.
- Web latency and background throughput are scheduled and scaled independently: each container gets its own replica count and its own resource controls, instead of competing inside one process.
- The deployment stays honest to its one-stateful-dependency shape: an operator still runs "the app and a database", just as two app processes now.
- Bulk issuance (#663) starts on an existing substrate instead of building one.

Negative:

- Every deployment gains a container: compose files, the deployed topology, health checks, logs, and docs all learn about the worker, and that cost lands on every operator, which is exactly why ADR-033 declined it while the inventory was one interval.
- Deploys now have a version-skew window: old worker and new web, or the reverse, against one schema. Migrations have to stay compatible one step in each direction, which is the discipline expand-and-contract already asks for.
- The local dev loop runs two processes.
- `pg-boss` becomes a load-bearing dependency; its job tables live in our database and its semantics are part of our operational story.

## Alternatives considered

**Keep everything in-process in the web container.** Rejected, and it was the previous draft of this decision. It ties background throughput to web traffic's container, relies on the runtime letting a request keep computing after it has responded, and forces each feature to hand-roll its own retry and sweep machinery. It was the right call when the inventory was one interval; the inventory changed.

**A broker: Redis with BullMQ, or RabbitMQ.** Rejected. A second stateful service in every deployment, bought for latency and throughput this workload does not need; sizing beyond that is measured when real handlers exist, not assumed here.

**Batched job fetching for throughput.** Rejected. Jobs fetched together in `pg-boss` share one timeout and one abort signal, and their outcomes are recorded only when the whole batch callback returns, so a finished job waits on its slowest batch-mate, and a callback that times out or dies fails jobs whose handlers succeeded. Job ids are reused across retries, so no settlement issued from inside a batch callback can be scoped to the attempt that produced it. Workers therefore fetch and settle one job at a time, and throughput scales by worker count and replicas, which is decision 1's scaling model anyway.

**Hand-roll `SKIP LOCKED` without a library.** Rejected. The claiming query is the easy tenth of the problem; retries, backoff, scheduling, retention, and the operational edge cases are the rest, and they are exactly what the mature libraries have already paid for.

**Serverless functions for the long work.** Rejected. The reference implementation is self-hosted by its operators; a design that only works with a cloud function runtime stops being deployable as "a compose file and a database".

## Not decided here

- The job resource's API shape for bulk operations. #663 owns it, under decision 5's constraint.
- Worker sizing, per-queue concurrency, and retry policies per job type. Implementation detail of the tickets that add each job.
- The non-retryable key-bearing semantics themselves. ADR-055 records them; decision 6 only gives them a home.

## References

- ADR-033 — the execution model this supersedes in part, and the multi-replica flaw its own text records.
- #985 — the worker container and entrypoint.
- ADR-051 — the request-idempotency claims that stay as they are; request dedup is not queueing.
- ADR-053 — the generations that hold verification truth.
- ADR-055 — key custody, and the non-retryable class.
- #955, #957 — the library verification work that rides this substrate.
- #663 — bulk issuance, the substrate's largest planned consumer.
- #984 — the `JobQueue` interface and `pg-boss` adapter this records.
- pg-boss: https://github.com/timgit/pg-boss
