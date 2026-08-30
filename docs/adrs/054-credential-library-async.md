# ADR-054: Library work that outlives a request runs in the web container, kept safe by the database

- **Date:** 2026-08-25
- **Status:** proposed

## Context

Some of the library's work takes longer than a caller should wait. Registering an external credential fetches it from its source, stores a durable copy, and verifies it, and the verification leans on an external service whose latency we do not control. Re-verification does the same for a record we already hold. The contract handles this by accepting the work and letting the caller poll: a verification generation can sit `pending`, and the caller reads the record until it settles.

Accepting work is a promise, and this deployment has nowhere special to keep promises. The topology is one Next.js container against Postgres. ADR-033 records that adding a worker process, a message broker, or a cron container is undesirable, and the only background work in the codebase today is the seeded-scheme refresh interval registered in the Next.js startup hook (`instrumentation.node.ts`).

A process like this restarts routinely: deploys, crashes, the platform rescheduling the container. Whatever the process was doing at that moment is gone. If the promise to verify lived only in that process's memory, a restart would silently eat it, and a caller would poll a `pending` record forever.

So the question is: what makes accepted work safe when the only place it can run is the web server itself?

## Decision

1. **The promise is a database row, committed before the caller hears "accepted".**
   A request that accepts slow work first writes the generation as `pending` and commits, then responds. The database always knows about every piece of accepted work, so a crash can lose computation, never the fact that the work was owed.

2. **On the happy path, the accepting request does the work itself.**
   After responding, the same request continues in-process: it claims the generation, runs it, and settles it. A polling caller sees the result as soon as the computation finishes, not on some timer's schedule.

3. **A claim is a lease in the database with an owner token, the pattern ADR-051 already records for idempotency keys, applied to generations.**
   ADR-051 settled this shape for retried issuance and registration: a claim serialised by the database, an owner token returned to the claimant, and every later write conditional on the token still being current. A generation is worked the same way. Claiming is one conditional update, take the generation only if nobody holds it or the holder has gone stale, and the final result only lands if the claimant still owns the lease. A process that stalled, lost its lease, and woke up later can finish computing, but it cannot overwrite the result of whoever took over.

4. **A sweep recovers what crashes leave behind. It runs at startup and on an interval, and it is recovery, not the delivery mechanism.**
   The sweep is registered in the Next.js startup hook, the same way the refresh interval already is, so recovery does not depend on a request happening to arrive. It picks up two kinds of leftover: `pending` rows nobody ever claimed, and claimed rows whose lease went stale. Its cadence is its own, chosen for this job, not borrowed from the refresh interval's.

5. **Staleness is derived from the work's own timeout, and two rules keep it honest.**
   A lease counts as stale after a fixed multiple of the verification pipeline's total timeout, counted from when the lease was taken, the same discipline as ADR-051's rule that each wait is measured from the point that starts it. The multiple is greater than one, so a lease is never taken from a pipeline that could still legitimately be running. The bound is longer than one sweep interval, jitter included, so a stale lease is found within a predictable time of going stale. The numbers themselves are set where the pipeline timeout is defined (#957).

6. **The sweep re-runs what it can and honestly fails what it cannot, decided by what the work still needs.**
   If everything the remaining work needs is durable, the sweep re-runs the generation. Verification may then run more than once, which is acceptable.
   If the remaining work still needs a decryption key the caller sent, it cannot be re-run: a caller's key lives only in memory for the life of its request and is never stored (the custody ADR in this set records why). The sweep settles that generation as failed, with a code telling the caller to send the key again, and the record is left in a state where sending it again works.

7. **A job resource, if one ever exists, points at records and holds no results.**
   A verification result lives on the record's generations and nowhere else. The batch-issuance substrate (#663) is the named place a real queue and job resource would live if this model is ever outgrown; a job there may say how far along it is and which records it touched, never what verification concluded, so a consumer can never read the same status from two places that disagree.

## Consequences

Positive:

- A restart never loses accepted work, only in-flight computation, and the sweep turns the surviving rows back into work without anyone asking.
- Callers see results at compute speed, not sweep speed.
- Two processes can never both settle the same generation, so results are single-writer by construction.
- There is no new infrastructure to deploy, monitor, or explain. The moving parts are rows, one conditional update, and an interval the codebase already knows how to run.

Negative:

- Verification throughput is tied to the web container. A workload that outgrows it graduates to the #663 substrate; there is no intermediate stretch of this model.
- Keyless work is at-least-once, so the verification pipeline must tolerate being run twice for the same generation.
- A caller whose key-bearing request is interrupted by a crash has to send the key again. That is the price of never storing it, and we accept it knowingly.
- The sweep's interval and the staleness bound are two more numbers an operator can get wrong; the rules in point 5 bound them, but the numbers still have to be chosen (#957).

## Alternatives considered

**A worker process, message broker, or cron container.** Rejected. ADR-033 already rejects new infrastructure for background work in this deployment, and nothing here needs what a broker buys: the queue is a table, the delivery guarantee is a conditional update, and the consumer is the process we already run.

**An in-memory queue inside the web container.** Rejected. It is the exact failure this ADR exists to prevent: the promise dies with the process, and a caller polls a `pending` record that no one will ever settle.

**Deliver work on the sweep's schedule instead of in the accepting request.** Rejected. Settlement would arrive on the scan cadence rather than at compute speed, so every caller's poll loop would wait out the interval even when nothing went wrong. The sweep stays what it is: the net under the happy path, not the path.

**A claim without an owner token.** Rejected, and already rejected once: ADR-051 records that a first implementation without conditional ownership let an abandoned-then-returning request overwrite the row that had since changed hands. The conditional update alone stops two processes claiming at once, but not a stalled claimant writing after its lease was taken. Without the token, a slow worker and its replacement can both settle the same generation, in either order, and the record's history stops being trustworthy.

**Persist the caller's key so key-bearing work could be re-run after a crash.** Rejected here and decided properly in the custody ADR: it turns a secret we were shown for a moment into stored key material with custody obligations, to save one resubmission.

## Not decided here

- The staleness multiple, the sweep cadence, and their configuration. #957 sets them, under point 5's rules.
- Everything about keys: why a caller's key is never stored, and what state a crashed key-bearing generation leaves the record in. The custody ADR in this set.
- The batch substrate itself. #663 owns it; point 7 only constrains what its job resource may carry.

## References

- ADR-033 — the no-new-infrastructure constraint and the startup-hook interval this sweep copies.
- ADR-052 — the surface whose register and re-verify operations create this work.
- ADR-053 — the record and generation model the rows in this ADR belong to.
- ADR-051 — the claim-with-owner-token pattern this ADR applies to generations.
- #957 — re-verification: owns the pipeline timeout and the numbers derived from it.
- #955 — registration: the poll-until-settled contract the happy path serves.
- #663 — the batch-issuance substrate, the named exit if this model is outgrown.
