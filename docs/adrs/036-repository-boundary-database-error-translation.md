# ADR-036: Database Error Translation at the Repository Boundary

- **Date:** 2026-07-02
- **Status:** accepted
- **Update (2026-08-12):** ADR-042 settles the status a pre-checked reference that vanishes before the write returns (the pre-check's own), a question this ADR left to per-call-site context (#781).

## Context

Reference implementation API routes that perform constrained database writes (unique indexes, foreign keys, records deleted concurrently) let the ORM's errors propagate to the central error mapper's generic branch, which returned the raw error message to the client as a 500. This leaked internal detail (the ORM in use, table and column names, query shape) and returned an unhelpful status for what is semantically a conflict (#706). A full audit of the API surface found the same gap across most write routes, plus three modules that had each grown an identical private duck-type guard for the ORM's unique-constraint error code (#708 tracks the route-by-route adoption).

Two questions needed settling: where ORM errors are translated into the application's domain errors, and what an unmapped database error looks like to a client.

## Decision

Database errors are translated at the repository boundary, and an unmapped database error surfaces as a generic 500 that reveals nothing about the database.

1. **A shared helper owns detection and mapping.** `src/lib/prisma/db-errors.ts` provides duck-typed guards for Prisma's request error codes (unique constraint, foreign key, record not found) and `mapDatabaseError(error, context)`, which throws the matching domain error (`ConflictError`, `NotFoundError`, `ValidationError`) carrying an entity-specific message from the caller's context, and rethrows anything the context does not cover. Detection is duck-typed on the documented error `code` rather than `instanceof` against generated client classes, because errors crossing transaction callbacks do not reliably satisfy `instanceof` and the helper stays decoupled from the generated client. The module lives in the Prisma tree because its input is Prisma's error surface; it maps into the domain error vocabulary in `src/lib/api/errors.ts`.
2. **Repositories are the persistence boundary.** A repository function performing a constrained write wraps the ORM call and calls `mapDatabaseError` with the wording the violation means for its entity (for example, a unique-constraint violation on identifier creation becomes a 409 "An identifier with this value already exists for the scheme"). ORM errors do not escape the repository layer. Routes stay thin: they let domain errors propagate and document the resulting statuses in Swagger.
3. **The HTTP error mapper carries a sanitised backstop.** `handleRouteError` detects any database error that reaches it unmapped, logs the full detail server-side under a distinct message (`Unhandled database error`), and returns a generic 500 body that never echoes error text, so responses do not name the database or its internals. The distinct log line is the operational detector for repositories missing a mapping. The mapper's pre-existing final fallback still returns `Error.message` for non-database errors; sanitising that branch is a separate decision outside this ADR's scope.
4. **Constraint violations are caught, not predicted.** Uniqueness is enforced by the database constraint and translated after the fact. Pre-checking (find-then-insert) races concurrent writers and gives false confidence; the constraint is the only authoritative check.

## Consequences

- Easier: every caller of a repository (routes, seed scripts, service-layer code) gets correct conflict semantics by construction, rather than per-route discipline. Adoption for #708 is one change per repository function instead of one per route.
- Easier: unmapped gaps are discoverable in production by alerting on the `Unhandled database error` log line.
- Easier: the three previously duplicated private unique-constraint guards are one shared implementation.
- Harder: a repository cannot vary conflict wording per calling surface; the entity's message is the message. If a surface ever needs different wording, it must catch the domain error and rewrap it, which is deliberate friction.
- Harder: repository unit tests carry the mapping assertions (ORM rejection becomes domain error), which adds a test obligation to every constrained write.

## Alternatives Considered

- **Translation at the route layer** (each handler wraps its repository calls and supplies request-specific wording). Rejected: it protects only the HTTP surface, leaving seeds and service-layer callers to leak raw ORM errors; it spreads try/catch boilerplate across handlers; and it depends on per-route discipline, which the API-surface audit showed does not hold here (fifteen routes had already missed it). Repositories in this codebase also already throw domain errors (`NotFoundError`, `ValidationError`), so route-level translation would cut against the established layering.
- **A global filter mapping unique-constraint violations to a generic 409** ("resource already exists") with no per-call context. Rejected: it loses the entity-specific message, and it can mislabel, since a unique-constraint violation from a nested write inside a transaction is not necessarily a conflict on the resource the request created.
- **Check-then-insert to pre-empt constraint violations.** Rejected: the check races concurrent writers, and wrapping both statements in a transaction does not close the race. At PostgreSQL's default READ COMMITTED isolation (which Prisma's `$transaction` inherits), two concurrent transactions each see no existing row and both proceed to insert; the second to commit still violates the constraint. Closing the race transactionally would require SERIALIZABLE isolation plus retry handling for serialisation failures, and row locking cannot help because the row being guarded does not exist yet. The pre-check therefore adds a query without removing the failure mode; the constraint violation still occurs and still needs handling.
- **A distinct "database error" message on the sanitised 500.** Rejected: the caller cannot act differently on "database error" versus "unexpected error", so the specificity has no client value, while naming the database gives a probing client information for free. The distinction lives in the server-side log line instead.

## References

- #706 (this change), #708 (route-by-route adoption)
- ADR-034, ADR-035 (error reporting and structured throws in `@uncefact/untp-utils`; same philosophy, different package)
- Prisma error reference: https://www.prisma.io/docs/orm/reference/error-reference
