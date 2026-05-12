# ADR: Database migration discipline for rollback safety

## Status

accepted

## Context

The reference implementation uses Prisma for database management. Prisma migrations run at app entry point — when a new version of the app starts, it applies any pending migrations before serving traffic. This is a clean pattern for deploys but creates a constraint for rollbacks.

Migrations are typically forward-only. If an app version `N+1` ships a migration that adds a column, the app writes to that column. Rolling back to app version `N` — which doesn't know about the column — can leave the system in an inconsistent state:

- Old code reading new data may break or misbehave silently.
- Destructive migrations (column drops, table renames, type changes) cannot be undone by simply running an "inverse" migration without losing or corrupting data.

The prod deploy and rollback mechanism (separate ADR) assumes rollback is sometimes the right answer. For that to be true, migrations must be designed for rollback safety.

## Decision

We adopt the **expand/contract migration pattern** (also called "parallel change") for any schema change that the app will eventually require. We also formalise a **no-rollback marking** for releases that include changes that cannot be safely rolled back.

**Expand/contract pattern for adding a required column:**

1. **Expand release.** Migration adds the column as nullable (or with a default). App version writes to it but does not depend on it being non-null. Old code (the previous version) continues to work because the column is nullable. **This release is rollback-safe** — rolling back to the previous version leaves the column populated but unused.

2. **Backfill** (often a separate step, possibly out-of-band). Populate the column for existing rows that were created before the expand release.

3. **Contract release.** App version requires the column. Migration makes it non-nullable. **This release is rollback-safe to the expand version** but not to versions before that. Rolling back to a version that doesn't write the column would create new rows with NULLs that would fail the NOT NULL constraint.

**Expand/contract for removing a column:**

1. **Expand release.** App stops reading the column but still writes it (for backward compatibility with the previous version). Migration leaves the column in place.

2. **Drop release.** App no longer reads or writes the column. Migration removes the column. **This is a destructive migration** — rollback to the expand version is unsafe because the previous version's writes would now have nowhere to go.

**No-rollback marking:**

Destructive migrations (column drops, table renames, type changes that lose information) are marked **`no-rollback`** in the changelog and release notes:

```markdown
## reference-implementation 2.4.0

### Breaking changes
- Renamed `legacy_credential_id` column to `credential_id` (destructive migration; **no-rollback**)

### ...
```

The release runbook (`docs/release-runbook.md`) documents that:
- `no-rollback` releases cannot be rolled back via the standard rollback workflow.
- Recovery from a problematic `no-rollback` release is fix-forward only.
- The rollback workflow may still complete successfully but leave the system in an inconsistent state — explicit override is required.

**Code review checks for migration safety:**

- PRs that modify Prisma schema are flagged for migration review.
- Reviewer checks: is this expand-phase or contract-phase? Is rollback compatibility documented in the PR description? Does the changeset reflect `no-rollback` for destructive migrations?
- Optionally, CI can run the previous version's tests against the new schema as a backward-compatibility check (not required initially but possible to add).

We chose this design because it makes rollback safety a contributor responsibility that is reviewable in PRs, rather than a property assumed at deploy time. The expand/contract pattern is well-established and well-understood; adopting it explicitly avoids ad-hoc decisions per migration.

## Consequences

**What becomes easier:**
- Most schema changes can be safely rolled back, which makes the auto-rollback-on-smoke-failure mechanism (separate ADR) useful in the common case.
- Migration discipline is explicit, reviewable, and consistent — not left to per-PR judgment.
- `no-rollback` releases are flagged in advance, so deploy decisions for them can account for the elevated risk.

**What becomes harder:**
- Schema changes often require two releases (expand, then contract) rather than one. Cognitively more work for contributors.
- The backfill step between expand and contract is sometimes operationally significant (for large tables) and must be planned.
- Destructive changes are still sometimes necessary; the `no-rollback` marking acknowledges this rather than forbidding it.
- Code review now includes a migration-safety check, adding to maintainer load.

## Alternatives Considered

### Forward-only releases, no rollback support

Rejected because rollback is sometimes the right answer (catastrophic bugs, security issues requiring immediate revert). Supporting rollback for the common case is valuable; the cost (expand/contract discipline) is bounded.

### Run inverse migrations on rollback

Rejected because inverse migrations for destructive changes are inherently lossy or impossible. Pretending they exist creates a false sense of safety.

### Allow ad-hoc per-PR migration decisions

Rejected because inconsistency in migration safety produces unpredictable rollback behaviour. A consistent pattern (expand/contract by default) is better than per-PR judgment.

### Hard-block `no-rollback` releases in CI

Rejected because destructive migrations are sometimes legitimate (cleanup of deprecated columns, schema simplification after a deprecation cycle). Flagging is better than forbidding.

## References

- ADR: Prod deploy and rollback mechanism
- ADR: Three deployment tiers (dev, staging, prod)
- `docs/release-runbook.md`
- "Refactoring Databases" by Scott Ambler and Pramod Sadalage (general reference for expand/contract pattern)
