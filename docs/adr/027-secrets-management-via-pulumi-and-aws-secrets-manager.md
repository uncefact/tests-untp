# ADR: Secrets management via Pulumi and AWS Secrets Manager

## Status

proposed

## Context

The architecture introduces multiple categories of secrets that need management:

- NPM_TOKEN for publishing packages to npmjs.org.
- TURBO_TOKEN for Turbo Remote Cache (if Vercel-hosted).
- AWS credentials for Pulumi to provision infrastructure.
- ghcr.io tokens (typically handled via `GITHUB_TOKEN`).
- OTel collector auth between host agents and the central gateway.
- App-level secrets (database connection strings, signing keys, third-party API credentials).
- Pulumi state encryption keys.

These secrets have different lifecycles, rotation needs, and access patterns. A single mechanism handling all of them poorly is worse than the right mechanism per category.

## Decision

We use **Pulumi-managed secrets backed by AWS Secrets Manager** as the canonical secret store for infrastructure and app secrets. GitHub Actions secrets handle CI-time concerns (NPM_TOKEN, TURBO_TOKEN).

**Categorisation:**

| Secret category | Storage | Rotation |
|---|---|---|
| App runtime secrets (DB creds, signing keys, API keys) | AWS Secrets Manager, referenced by Pulumi | Rotate in AWS Secrets Manager, Pulumi picks up on next apply |
| Pulumi stack secrets (config values for stack apply) | Pulumi config (encrypted) with values backed by AWS Secrets Manager where appropriate | Rotate in source location |
| CI publish tokens (NPM_TOKEN, TURBO_TOKEN) | GitHub Actions Secrets, scoped per environment via GitHub Environments | Rotate in source service, update in GitHub Secrets |
| Provider credentials (AWS for Pulumi) | GitHub Actions OIDC where possible, falling back to Actions Secrets | OIDC is rotation-free; Secrets require manual update |
| Container registry (ghcr.io) | `GITHUB_TOKEN` via workflow permissions | Handled by GitHub automatically |
| Pulumi state encryption | Pulumi Cloud or KMS-backed S3 backend | Per backend's mechanism |

**Patterns:**

- App configuration reads secrets from environment variables, populated at container startup from AWS Secrets Manager via Pulumi-templated values. Apps never see Secret Manager directly — they read env vars.
- Rotation is triggered in the source location (AWS Secrets Manager UI or API). Pulumi's next `up` propagates updated values to deployed infrastructure. App restarts may be required for some changes (database credentials typically require restart; some other secrets can be hot-reloaded if apps support it).
- GitHub Environments scope CI secrets per deployment tier — `dev`/`staging`/`prod` have different NPM_TOKEN or different env-specific keys.
- OIDC for AWS authentication where supported, to avoid long-lived AWS credentials in GitHub.

**What we don't do:**

- Secrets in code or in committed config files.
- Secrets in plaintext environment files on EC2 instances (Pulumi templating handles this from Secrets Manager).
- Sharing a single set of secrets across all environments — each tier has its own.

We chose this design because AWS Secrets Manager is the standard AWS-native mechanism for secret storage with rotation support, Pulumi integrates with it cleanly via stack config references, and GitHub Actions Secrets + Environments handles CI-time concerns appropriately scoped.

## Consequences

**What becomes easier:**
- Secrets rotation is a first-class operation in AWS Secrets Manager rather than a Pulumi config edit.
- GitHub Environments provide approval gates and scoped secrets per tier, matching the deployment-tier architecture.
- OIDC for AWS authentication removes long-lived credentials from GitHub.
- App code is decoupled from secret storage — apps read env vars.

**What becomes harder:**
- Multiple secret stores (AWS Secrets Manager + GitHub Actions Secrets) means rotation procedures are different per category. The runbook documents which secret lives where.
- AWS Secrets Manager has per-secret pricing — many small secrets cost more than a few large structured ones. Worth grouping related secrets per environment.
- Onboarding new contributors requires explaining the secret architecture and where to find / how to rotate each category.

## Alternatives Considered

### HashiCorp Vault

Rejected because AWS Secrets Manager covers the use case adequately and self-hosting Vault adds operational burden the team can avoid. If multi-cloud became a concern, Vault is a candidate for reconsideration.

### All secrets in Pulumi config (encrypted)

Rejected because secret rotation in Pulumi config requires a Pulumi config edit and apply for every rotation. AWS Secrets Manager treats rotation as a first-class concern.

### All secrets in GitHub Actions Secrets

Rejected because GitHub Actions Secrets are CI-time only. App runtime secrets need to live in the runtime environment (AWS), not in GitHub.

### Per-environment isolated secret stores (not just per-environment values within a shared store)

Considered. Rejected for initial setup because AWS Secrets Manager's tagging and IAM scoping can isolate per-environment secrets within a single AWS account. If the project later splits to multiple AWS accounts per environment, isolated stores follow naturally.

## References

- ADR: Pulumi for infrastructure with stack-per-environment
- ADR: Three deployment tiers (dev, staging, prod)
- ADR: CI/CD workflow inventory
- AWS Secrets Manager documentation
- Pulumi secrets documentation
