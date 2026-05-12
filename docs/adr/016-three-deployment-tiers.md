# ADR: Three deployment tiers (dev, staging, prod) with separate AWS environments

## Status

accepted

## Context

The reference implementation and playground need a deployment topology that supports:

- **Fast feedback for the team.** Developers want to see their changes running in a real environment quickly, not just locally.
- **Release-candidate validation.** Before promoting to production, an RC needs to be validated against a realistic, deployed environment.
- **Stable production.** External implementers and stakeholders point at the public deployment. Stability matters more than freshness.

Each tier has different characteristics:
- Different audiences (team vs external testers vs end users).
- Different update cadences (continuous vs RC vs deliberate).
- Different stability expectations.
- Different blast radius for failures.

A single environment cannot serve all three needs. The team needs continuous fast feedback; production needs deliberate stable deploys; the gap between them is staging for pre-release validation.

## Decision

We adopt three deployment tiers, each with its own Pulumi stack and its own AWS environment (separate VPCs, separate AWS managed databases):

| Tier | Image source | Deploy trigger | Approval | Database |
|---|---|---|---|---|
| Dev | `:dev` rolling tag | Every push to `main` → auto | None | Own AWS managed DB |
| Staging | `:rc` during RC cycles, current stable between | RC publish → auto | None during RC | Own AWS managed DB |
| Prod | Pinned exact `:X.Y.Z` | Manual `workflow_dispatch` | Required reviewer | Own AWS managed DB |

Each tier deploys both `reference-implementation` and `playground`. Database migrations run via Prisma at app entry point. GitHub Environments scope secrets and approval gates per tier.

**Dev:** continuous, automated, no human in the loop after merge. Watchtower or equivalent polls the `:dev` tag on the dev EC2 instance and pulls/restarts on changes.

**Staging:** automated during RC cycles. When an RC publishes (Changesets pre mode produces a new `:rc` tag), staging deploys automatically. Outside RC cycles, staging runs the current stable. Audience includes internal team validating the RC and external SaaS vendors doing pre-release integration testing.

**Prod:** manual workflow_dispatch with required reviewer approval. Pinned to exact versions (`:X.Y.Z`), never rolling tags. Stage D smoke tests run automatically post-deploy with auto-rollback on failure (separate ADR).

Each tier has its own database (separate AWS managed instance). Schema migrations propagate through the tiers as releases promote: dev gets schema first, then staging on RC, then prod on stable.

We chose this design because the three audiences (team, RC testers, end users) have genuinely different needs that cannot be served by fewer tiers, and isolating each tier's infrastructure (separate VPCs, separate DBs) bounds blast radius — a dev environment failure cannot affect prod.

## Consequences

**What becomes easier:**
- Developers get continuous feedback in a real environment without releasing.
- RC validation has a dedicated staging environment, not a shared environment with active development.
- Prod is protected by an explicit approval gate; no accidental production deploys.
- Database isolation per tier means dev migrations can't corrupt prod data.
- Each tier's deploy automation matches its risk profile — automatic where speed matters, manual where stability matters.

**What becomes harder:**
- Three AWS environments to provision and maintain. Pulumi handles most of this, but cost (three databases, three sets of EC2 instances) is real.
- Schema migration discipline matters across tiers — migrations must be backward-compatible with the previous version's code in case of rollback (separate ADR on migration discipline).
- "Why is staging behaving differently than dev?" debugging requires recognizing that environments are real, not identical.
- Three Pulumi stacks for apps means three stack outputs, three sets of secrets, three sets of deployment configurations.

## Alternatives Considered

### Two tiers (dev + prod, no staging)

Rejected because RC validation has nowhere to happen. Either RCs deploy to prod (defeats the purpose of RCs) or they don't deploy anywhere (validation is impossible against a real environment).

### Single environment

Rejected for obvious reasons — no separation between active development, pre-release validation, and production.

### Four or more tiers (e.g., dev + integration + staging + prod)

Rejected as overkill for the team size and audience. Three tiers covers the meaningful audience distinctions. Additional tiers add infrastructure cost and operational overhead without clear benefit.

### Shared database between dev and staging

Rejected. Staging is a pre-release validation environment and needs realistic data, including data accumulated from RC testing. Dev is an active-development environment where data is throwaway. Sharing a database means staging's data is polluted by dev experiments, defeating staging's purpose.

### Prod auto-deploys on stable release

Considered. Rejected in favour of manual deploy with required approval, because the audience (UN agencies, government pilots) makes prod deploys more sensitive than typical SaaS. Manual deploy provides a coordination point for announcements, maintenance windows, and final review. Auto-rollback on Stage D smoke failure mitigates the "manual deploys rot" concern by keeping the deploy path exercised.

## References

- ADR: Pulumi for infrastructure with stack-per-environment
- ADR: Dev build workflow
- ADR: Staging deploy and RC quality gate
- ADR: Prod deploy and rollback mechanism
- ADR: Database migration discipline for rollback safety
