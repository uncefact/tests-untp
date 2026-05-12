# ADR: Manual prod deploy with automated rollback on smoke test failure

## Status

accepted

## Context

Production deploys for the reference implementation and playground need to balance two competing concerns:

- **Deliberate human oversight.** The audience (UN agencies, government pilots, SaaS vendors integrating against UNTP) makes prod deploys more sensitive than typical SaaS. A bad prod deploy is more visible and has higher reputational cost.
- **Fast recovery from failures.** If a bad deploy reaches prod, the time between "smoke tests failed" and "we've reverted" is when users are affected. Manual recovery during that window is stressful and slow.

The architecture needs to be explicit about both how prod is deployed and how rollback happens.

## Decision

**Prod deploys are manual** via `workflow_dispatch` with required reviewer approval.

**Smoke tests run automatically post-deploy**, and **failure triggers automatic rollback** to the previous pinned version. Manual rollback is also available via a separate workflow.

**Prod deploy workflow:**

1. Manual `workflow_dispatch` trigger with target version input.
2. GitHub Environment (`prod`) requires reviewer approval.
3. Pre-deploy verification: confirms target image exists in ghcr.io. Fails fast on typos or missing builds.
4. Pulumi deploy: updates `prod` stack config with target version and applies. Prisma migrations run on app entry point (apps already do this).
5. Stage D smoke tests run automatically post-deploy (read-only, idempotent, minimal subset).
6. **Auto-rollback on smoke failure:** if smoke tests fail, the workflow invokes the rollback workflow with `target_version=<previous>` and `reason="Auto-rollback: smoke test failure on deploy of <new version>"`.
7. On success, an audit git tag is created: `prod/<app>@<version>`.
8. Slack notifications fire on deploy start, deploy success, smoke test failure, rollback triggered, rollback success.

**Prod rollback workflow** (manual or auto-invoked):

1. `workflow_dispatch` with app, optional `target_version` (defaults to previous from Pulumi state), required `reason` field.
2. GitHub Environment requires reviewer approval (skipped when invoked from the deploy workflow's auto-rollback path, since approval was already given for the deploy).
3. Verifies target image exists in ghcr.io.
4. Pulumi updates the `prod` stack config and applies.
5. Smoke tests run post-rollback to confirm the rollback target is healthy.
6. Slack notification with who triggered, target version, reason, outcome.

**Concurrency:** `concurrency: { group: prod-deploy, cancel-in-progress: false }`. Deploys and rollbacks share a serialised lane — no two prod operations can race.

**Migration discipline for rollback safety:**

Database migrations must be backward-compatible with the previous app version. The standard pattern is **expand/contract** (parallel change):

- **Expand release:** migration adds a column as nullable. App version writes to it but doesn't depend on it. Old code still works because the column is nullable.
- **Backfill** (separate step): populate the column for existing rows.
- **Contract release:** app version requires the column. Migration makes it non-nullable.

This means any single version's migrations are safe to roll back to the previous version's code.

For destructive migrations (column drops, table renames, etc.), rollback is unsafe. These releases are **marked `no-rollback` in the changelog/release notes**, signalling that the only recovery path is fix-forward.

We chose this design because manual prod deploys provide the human oversight the audience expects, while automatic smoke-failure rollback closes the most stressful window — the minutes between bad deploy and recovery. The two together give us deliberate deploys with fast recovery, addressing both concerns.

## Consequences

**What becomes easier:**
- Maintainers have explicit control over what reaches prod and when. No surprise deploys.
- Bad deploys are recovered automatically without manual intervention for the common case (smoke test failure).
- The rollback path is exercised continuously (via auto-rollback) rather than rotting from disuse.
- Audit trail is comprehensive: GitHub Environment approval logs, git tags, Slack notifications, Pulumi state history.

**What becomes harder:**
- Migration authoring requires the expand/contract discipline. Contributors must think about rollback compatibility, which is a real cognitive cost.
- `no-rollback` releases are real — some legitimate operations (destructive schema changes) cannot be rolled back. Worth documenting clearly so the runbook reflects reality.
- Manual approval gate means somebody has to actually click the button. Not friction in normal operation but a coordination point for off-hours emergencies.
- Rollback to a specific historical version requires that the target image still exists in ghcr.io. Image retention policies must not delete images that prod might roll back to.

## Alternatives Considered

### Auto-deploy on stable release (no manual gate)

Considered. Rejected for this project because the audience and reference-implementation role make a deliberate "yes, deploy now" decision valuable. The Version Packages PR merge is the release decision, but it is not necessarily the deploy decision — sometimes you want a release available without immediately deploying it (e.g., coordinated rollout, customer notification). Auto-deploy conflates the two.

### Manual deploy, manual rollback (no auto-recovery)

Rejected because the window between bad deploy and manual rollback is when users are affected. Auto-rollback on smoke failure closes that window cheaply.

### Auto-deploy with delay and cancellation window

Considered. A middle ground: auto-deploy 15-30 minutes after stable release, cancelable during the delay. Rejected because it adds complexity (cancellation UX, delay handling) for a benefit that the simpler manual-approval design already provides via the GitHub Environment review.

### Manual rollback only, no auto-rollback even on smoke failure

Rejected because the recovery window is stressful and slow. Smoke test failure is an unambiguous signal that the deploy is bad; automating recovery on that signal is unambiguously good.

### Forward-only releases (no rollback support at all)

Rejected. Even with good migration discipline, rollback is sometimes the right answer (catastrophic bug, security issue requiring immediate revert). Supporting it is cheap (just deploy a previous pinned version); the discipline is in the migration design, not in the rollback mechanism.

## References

- ADR: Three deployment tiers (dev, staging, prod)
- ADR: Four-stage testing strategy (A through D)
- ADR: Pulumi for infrastructure with stack-per-environment
- ADR: Release runbook for failure recovery
- `docs/release-runbook.md`
