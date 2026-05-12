# ADR: Four-stage testing strategy (A through D)

## Status

accepted

## Context

End-to-end testing matters at multiple points in the development and release lifecycle, and each point catches a different class of failure:

- **At PR time**, against a local containerized stack — catches regressions before merge.
- **After dev deploy**, against the deployed dev environment — catches deployment/infra issues that don't manifest in local CI.
- **After staging deploy**, against the deployed staging environment — gates RC quality.
- **After prod deploy**, against the deployed prod environment — final validation that the release reached prod healthy.

Scheduled or cron-driven testing (often called Stage E) is a fifth option, useful for catching drift over time (cert expiry, external API changes), but mostly substitutes for inadequate coverage in the other stages.

## Decision

We adopt a four-stage testing strategy. No Stage E.

**Stage A — PR-level QA against local containerized stack.**
- Runs on every PR as a required status check.
- Matrix per package (separate ADR on PR checks workflow), affected-filtered via Turbo.
- Cypress E2E per app, with each app's full Docker Compose stack spun up on a dedicated runner.
- Library packages run unit and integration tests only — no E2E.
- This is the primary correctness gate. PRs cannot merge without it passing.

**Stage B — Post-dev-deploy E2E against deployed dev environment.**
- Runs after every `:dev` Docker image deploy to the dev environment.
- Full Cypress E2E suite against the deployed dev URL.
- Reports failures to Slack as signals (not merge blockers — main has already merged).
- Catches deployment, infrastructure, and environmental issues that don't appear in local CI.

**Stage C — Post-staging-deploy E2E against staging environment.**
- Runs after every RC publish that deploys to staging.
- Full Cypress E2E suite against the deployed staging URL.
- **This is the RC quality gate.** A failed Stage C means the RC isn't ready for promotion to stable.
- Outcome surfaces in the Slack release channel and on the Version Packages PR (or wherever RC status is tracked).

**Stage D — Post-prod-deploy smoke tests against production.**
- Runs after every manual prod deploy.
- **Minimal smoke subset only** — health check, version check, basic read-only flows. Not full E2E (don't want to mutate prod data).
- Under 2 minutes.
- **Failure triggers automatic rollback** to the previous pinned version (separate ADR).

**E2E test architecture supporting these stages:**
- Cypress-based, tests live per app in `packages/<package>/e2e/`.
- Each app owns its own E2E suite, exercises its own stack.
- E2E suite is **parameterizable by target URL**: same tests run against `localhost` (Stage A), `dev.untp.example.org` (Stage B), `staging.untp.example.org` (Stage C). Stage D smoke tests are a separate, smaller subset targeting prod.
- Tests must be idempotent and parallel-safe.
- Cross-package integration tests deferred until foundation is in place.

We chose this strategy because each stage catches a different failure class and together they cover the lifecycle without redundancy. Stage E was rejected (separate consideration below).

## Consequences

**What becomes easier:**
- Failures are isolated to the stage they appear in, which constrains the search space for debugging.
- Stage A's matrix per package keeps PR feedback fast despite comprehensive coverage.
- Stage C provides a clear RC quality gate — promotion decisions have an authoritative signal.
- Stage D's auto-rollback means a bad prod deploy gets reverted without manual intervention.

**What becomes harder:**
- Four test runs per release flow (A on PR, B on main merge, C on RC, D on prod deploy) — more CI usage overall, though each stage has clear value.
- Stage D smoke tests must be carefully designed to validate health without mutating prod data. Read-only flows, idempotent checks. More design discipline than full E2E.
- E2E suite parameterization (one suite, multiple targets) requires discipline in test authoring: no hardcoded URLs, no environment-specific assumptions, idempotent and parallel-safe.
- Staging Stage C results need a clear surfacing mechanism (Slack, PR comments, status checks). Otherwise it's a quality gate that nobody looks at.

## Alternatives Considered

### Add Stage E (scheduled / cron-driven E2E)

Rejected because A-D collectively cover the failure cases Stage E was meant to catch. Specifically:

- "Catches things that change over time" — covered by Stage B running on every push to main (drift is detected within hours, not days).
- "Catches cert expiry, external API changes" — better handled by dedicated monitoring (Icinga, Grafana alerts) than by running full E2E on a schedule.
- "Continuous confidence that staging is healthy" — Stage C runs whenever an RC ships, which is the time confidence matters.

The cost of Stage E (CI minutes, flake triage, alert fatigue) outweighs the marginal coverage. Drop it.

### Skip Stage B (no post-dev-deploy E2E)

Rejected because deployment failures often differ from local-test failures (real DNS, real DB, real network paths, real secrets). Stage B is the first time the code runs in a deployed environment. Skipping it pushes those failures to Stage C, where they're more expensive to discover.

### Full E2E in Stage D (not just smoke tests)

Rejected because Stage D runs against production. Full E2E often involves mutating data, which is unacceptable in prod. Smoke tests must be read-only and idempotent.

### Skip Stage A E2E (rely on unit/integration tests only at PR time)

Rejected because E2E catches integration bugs that unit tests miss. Per-package matrix runners make Stage A E2E tractable.

## References

- ADR: PR checks workflow with static matrix and combined Turbo filter
- ADR: Dev build workflow
- ADR: Staging deploy and RC quality gate
- ADR: Prod deploy and rollback mechanism
- ADR: Deployment tiers and environments
