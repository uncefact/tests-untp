# ADR: CI/CD workflow inventory

## Status

proposed

## Context

The repository's CI/CD needs to handle multiple concerns: PR validation, release management, deployment to three environments, documentation publishing, and rollback support. Each concern has different triggers, different success criteria, and different concurrency requirements.

A single mega-workflow is hard to reason about and debug. Too many fragmented workflows create cross-workflow trigger problems (separate ADR on release workflow correctness). The right granularity is workflow-per-concern, with explicit triggers and explicit concurrency control per workflow.

## Decision

We adopt the following workflow inventory:

**1. PR checks** (triggered by `pull_request`)
- `quality` job: repo-wide `format:check` + `lint:check`.
- `qa` matrix job: per-package build/test/E2E with Turbo combined filter.
- `changeset-check` job: `pnpm changeset status --since=origin/main`.
- Concurrency: `pr-${{ github.event.pull_request.number }}`, `cancel-in-progress: true`.

**2. Release** (triggered by `push` to `main`)
- Single workflow handling Changesets-driven npm publish, multi-arch Docker build and push, git tagging, GitHub release creation.
- Concurrency: `release`, `cancel-in-progress: false` (never cancel in-flight releases).
- Conditional steps for stable vs RC tag sets based on Changesets pre-mode state.

**3. Dev build + deploy + Stage B E2E** (triggered by `push` to `main`)
- Builds `:dev` Docker images for both apps.
- Deploys to dev environment.
- Runs Stage B Cypress E2E against deployed dev.
- Concurrency: `dev-build`, `cancel-in-progress: true` (newer builds supersede).

**4. Staging deploy + Stage C E2E** (triggered by RC publish events)
- Deploys `:rc` Docker images to staging environment.
- Runs Stage C Cypress E2E against deployed staging.
- Outcome surfaces as RC quality gate (Slack notification, status on Version Packages PR).
- Concurrency: `staging-deploy`, `cancel-in-progress: false`.

**5. Prod deploy + Stage D smoke + auto-rollback** (triggered by manual `workflow_dispatch`)
- Required reviewer approval via GitHub Environment.
- Pre-deploy image existence verification.
- Pulumi deploy to prod.
- Stage D smoke tests against prod.
- Auto-invokes rollback workflow on smoke failure.
- Creates audit git tag `prod/<app>@<version>` on success.
- Slack notifications throughout.
- Concurrency: `prod-deploy`, `cancel-in-progress: false`.

**6. Prod rollback** (triggered by manual `workflow_dispatch` or auto-invoked from workflow 5)
- Required reviewer approval (skipped on auto-invocation since approval already given for the deploy).
- Required `reason` input.
- Target version verification.
- Pulumi rollback apply.
- Post-rollback smoke tests.
- Slack notification.
- Concurrency: shares `prod-deploy` group with workflow 5.

**7. Docs deploy** (triggered by `push` to `main` with path filter)
- Path filter: `apps/docs/**`, root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `.github/workflows/deploy-docs.yml`.
- Builds Docusaurus site, deploys to docs hosting target.
- Concurrency: `deploy-docs`, `cancel-in-progress: true`.

**8. Snapshot docs version** (triggered by manual `workflow_dispatch`)
- Inputs: which Docusaurus instance (reference-implementation / playground / test-suite), version label.
- Runs `pnpm docusaurus docs:version:<instance> <version>`.
- Commits result, opens PR.

We chose this inventory because each workflow has a single, clear responsibility and the trigger model fits the concern. Concurrency is explicit per workflow, matched to whether interruption is acceptable.

## Consequences

**What becomes easier:**
- Debugging failures: each workflow's logs are scoped to its concern.
- Concurrency behaviour is explicit, matched to the workflow's risk profile.
- Triggers are clear — no implicit cross-workflow chaining via `GITHUB_TOKEN` token semantics.
- Adding a new workflow doesn't require restructuring existing ones.

**What becomes harder:**
- Eight workflow files to maintain. Some shared logic (checkout, setup-node, pnpm install) is duplicated across workflows. Mitigated by reusable workflow patterns (`workflow_call`) if duplication becomes painful.
- Cross-workflow coordination (e.g., release workflow's Docker publish triggering staging deploy on RC) requires explicit mechanism. For this architecture, the staging deploy is triggered by the release workflow itself rather than by a separate tag-triggered workflow, avoiding `GITHUB_TOKEN` cross-workflow issues.
- Onboarding new contributors requires explaining the workflow inventory.

## Alternatives Considered

### Single mega-workflow with conditional logic

Rejected. Difficult to reason about, harder to debug per-concern, and concurrency control becomes complex (the same workflow can't have different cancel-in-progress behaviour per branch).

### Split each workflow further (e.g., separate "build" and "test" workflows for PRs)

Rejected. Each split introduces a cross-workflow coordination concern. The current split is at the right granularity — each workflow is a complete, coherent concern.

### Tag-triggered separate workflow for Docker builds (separate from release workflow)

Rejected because `GITHUB_TOKEN`-created tags don't trigger downstream workflows by default. Working around this requires a PAT or GitHub App token, adding operational complexity. Doing the Docker build inside the release workflow avoids this entirely.

### Use a separate CI tool (CircleCI, Buildkite) for some workflows

Rejected. GitHub Actions handles all of these cases adequately and keeps CI configuration co-located with code. Mixing CI tools adds complexity without benefit.

## References

- ADR: Release workflow correctness measures
- ADR: PR checks workflow with static matrix and combined filter
- ADR: Prod deploy and rollback mechanism
- ADR: RC cycles via Changesets pre mode
- ADR: Multi-instance Docusaurus for documentation
