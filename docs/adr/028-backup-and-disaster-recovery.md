# ADR: Backup and disaster recovery considerations

## Status

accepted

## Context

The architecture introduces multiple stateful concerns that need backup and recovery planning:

- App databases (one AWS managed instance per environment).
- Observability data (Loki logs and Tempo traces in S3, Prometheus metrics).
- Pulumi state (the source of truth for what infrastructure exists).
- Docker images in ghcr.io (referenced by rollback procedures — images must not be garbage-collected if they might be rollback targets).
- npm packages (immutable on npmjs.org but project should retain its own publish history).
- Repository git history (handled by GitHub).

Without explicit backup planning, recovery from data loss or infrastructure failure is ad-hoc and slow.

## Decision

We address backup and disaster recovery across the following categories:

**App databases:**

- AWS managed databases have automated backups enabled (point-in-time recovery within a retention window, plus daily snapshots).
- Retention: dev 7 days, staging 30 days, prod 90+ days (matching observability retention philosophy — prod data deserves longer history).
- Cross-region backup copy for prod (recoverable from a regional AWS outage).
- Backup restore procedure documented in `docs/release-runbook.md` or a separate disaster-recovery doc.

**Observability data:**

- Loki and Tempo's S3 backends use S3 lifecycle policies to age out data per retention policy by environment label.
- S3 versioning enabled on the backend buckets to protect against accidental deletion or corruption.
- Prometheus storage: depends on whether we stick with vanilla Prometheus (local TSDB) or add Thanos (S3-backed). Vanilla Prometheus has limited retention; metrics older than the local retention window are lost. Acceptable initially; revisit if longer retention becomes a need.
- Grafana dashboards and alert rules: version-controlled as JSON in the repository (or provisioned via Pulumi/Grafana provisioning). Avoid in-Grafana-UI-only changes that aren't backed up.

**Pulumi state:**

- Backed up per Pulumi's backend mechanism: Pulumi Cloud handles backup natively; S3-backed state uses S3 versioning.
- Periodic export of stack state to a separate backup location (manual or scripted) for additional safety.

**Docker images:**

- ghcr.io retention policy must not delete images that prod might roll back to.
- Recommendation: never auto-delete tagged images (only untagged). For tagged images, retain at minimum the last N stable releases (e.g., last 10 stable releases per app) plus all production-deployed versions.
- Audit periodically that referenced rollback targets are still present.

**npm packages:**

- npmjs.org retains all published versions permanently (with deprecation, not deletion). No backup needed on our side.
- GitHub Release artifacts (attached changelogs, release-manifests) serve as a project-side record.

**Repository:**

- GitHub provides primary git hosting and backup.
- Periodic mirror to a secondary location (e.g., a separate Git provider or S3-archived bundle) for protection against GitHub-level disasters.

**Recovery procedures:**

The release runbook (separate ADR) covers release-flow recovery. A separate disaster-recovery doc covers larger-scale recovery (lose a database, lose a region, etc.). Both are kept in the repository's `docs/` directory.

We chose this design because each stateful category has its own appropriate backup mechanism, the costs are bounded (AWS managed DB backups are cheap, S3 versioning is cheap), and explicit documentation removes ad-hoc recovery decisions under pressure.

## Consequences

**What becomes easier:**
- Data loss recovery is a documented procedure rather than panic improvisation.
- Cross-region prod DB backup means a regional outage doesn't lose prod data.
- Image retention discipline preserves rollback targets reliably.

**What becomes harder:**
- Backup storage costs are real (point-in-time recovery on managed DBs, S3 versioning on observability buckets, cross-region backup copies). Bounded but non-zero.
- Periodic recovery drills (testing that backups can actually be restored) are not enforced by tooling — they require team discipline.
- Image retention policies need active monitoring as image counts grow. A bug in the policy could delete a needed rollback target silently.

## Alternatives Considered

### No explicit backup planning; trust managed services

Rejected because some categories (observability data, image retention) aren't automatically protected, and recovery is much easier with a documented procedure than improvised.

### Per-tier backup policies that are radically different (e.g., no backups in dev at all)

Considered. Initial position: same backup mechanisms across tiers (cheap to enable), different retention windows (cost-aware). If dev backup costs become problematic, can reduce retention further or disable entirely.

### Full off-site backups (separate cloud provider)

Considered as a future possibility. Rejected for initial implementation because AWS cross-region backup gives most of the same benefit at lower complexity. Multi-cloud disaster recovery is a future concern.

### Recovery drills as a scheduled workflow

Considered. Worth doing eventually — periodically restore a backup to a test environment and validate. Not required for initial implementation but worth tracking as a future improvement.

## References

- ADR: Pulumi for infrastructure with stack-per-environment
- ADR: Three deployment tiers (dev, staging, prod)
- ADR: Shared single observability stack
- ADR: Prod deploy and rollback mechanism
- ADR: Docker image tagging strategy
- `docs/release-runbook.md`
