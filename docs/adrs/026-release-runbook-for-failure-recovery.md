# ADR: Release runbook for failure recovery

- **Date:** 2026-05-12
- **Status:** superseded by [031](./031-per-package-tag-triggered-npm-release.md)
- **Update (2026-05-15):** Failure recovery is now handled by the `unpublish-or-deprecate` workflow described in ADR 031. The two outcomes (npm unpublish within the 72 h window; npm deprecate beyond it) are wired into the same `workflow_dispatch`-only workflow that authenticates via OIDC Trusted Publishing.

## Context

Even with good release tooling (Changesets, Pulumi, automated workflows), things can go wrong:

- A bad npm version gets published.
- A bad Docker image gets pushed.
- A release event releases the wrong set of packages.
- A prod deploy fails in a way smoke tests didn't catch.

Without a documented recovery procedure, the team responds ad-hoc under pressure, which is when mistakes compound. The runbook is most useful before it is needed.

## Decision

We maintain `docs/release-runbook.md` with documented procedures for the common failure modes:

**Bad npm version published:**

1. Run `npm deprecate @untp/<pkg>@<bad-version> "<reason>"`. This doesn't remove the package but adds a warning on `npm install`.
2. Open a hotfix PR with a patch-level changeset.
3. Merge through the normal release flow. The next release is the fix.
4. Do **not** attempt to `npm unpublish` and republish the same version. Once published, the version content is effectively immutable from consumers' perspective; republishing produces inconsistent state across consumer caches and lockfiles.

**Bad Docker image pushed:**

1. Identify the last known good version (e.g., `:2.3.5`).
2. Re-point rolling tags to the known-good image:
   ```bash
   docker pull ghcr.io/uncefact/reference-implementation:2.3.5
   docker tag ghcr.io/uncefact/reference-implementation:2.3.5 ghcr.io/uncefact/reference-implementation:latest
   docker push ghcr.io/uncefact/reference-implementation:latest
   # Repeat for :2.3, :2 as appropriate
   ```
3. Open a hotfix PR with the fix.
4. Ship via normal release flow. The new image gets all rolling tags.

**Bad release event** (wrong packages published, wrong version bumps):

1. Default to fix-forward — most cases are fixable with another release. Wrong version bump? Ship a patch that does the right thing. Extra package published? Add a deprecation notice and move on.
2. Revert + re-release only if actively broken. Revert the release commit on `main` (restoring the previous `package.json` versions), then start over. Old git tags remain pointing at the bad release as historical artefacts.
3. Nuclear options (force-push to remove a release commit) only in extreme cases (security issue, leaked secrets), with coordination among maintainers.

**Rolling back prod:**

- **Automatic:** Stage D smoke test failure triggers automatic rollback to the previous Pulumi-pinned version. No manual action needed unless the auto-rollback itself fails.
- **Manual:** Trigger the "Rollback Prod" workflow from GitHub Actions UI. Select app, optionally specify target version (defaults to previous), provide required reason, approve via GitHub Environment.
- **When rollback isn't possible:** releases marked `no-rollback` in changelog (destructive migrations) cannot be rolled back. Fix-forward only.
- **Verifying rollback:** check Pulumi stack output matches target version, check Grafana dashboards for error rate and latency, run manual smoke test if auto-smoke didn't complete.

**General principles:**

- Don't panic. Most failures are fixable by another release.
- Don't try to mutate already-published artefacts. Ship forward instead.
- Ask before destructive actions (force-pushes, unpublishes, manual database modifications).
- Document what went wrong in the next release notes — postmortems live with the project's history.

We chose to write this down because the failure modes are predictable, the recovery procedures are well-defined, and the consequences of getting recovery wrong (especially under pressure) are bad enough to justify pre-investing in clarity.

## Consequences

**What becomes easier:**
- A maintainer facing a release problem has a documented procedure rather than improvising.
- New maintainers learn the recovery story alongside the release flow.
- Failure conversations point to the runbook rather than re-litigating procedures.

**What becomes harder:**
- The runbook must be kept up to date as the architecture changes. Stale runbooks are worse than no runbook because they recommend procedures that no longer apply.
- Edge cases (unusual failure modes not covered) require judgment, and the runbook can't anticipate everything. The general principles section is the catch-all.

## Alternatives Considered

### Trust maintainers to figure it out under pressure

Rejected because pressure makes mistakes more likely, not less. The runbook is cheap to write and the value compounds.

### Embed recovery procedures in the release workflow itself (e.g., auto-recovery for every failure mode)

Rejected because not every failure has a clean automated recovery. Auto-rollback on smoke failure (separate ADR) is automated where it makes sense. The rest is intentional human judgment with documented procedures.

### Use a wiki or external doc instead of in-repo markdown

Rejected. The runbook should live with the code so it's discoverable to maintainers working in the repo and so it stays in sync via the same PR review as other documentation.

## References

- ADR: Changesets for version management and publishing
- ADR: Docker image tagging strategy
- ADR: Prod deploy and rollback mechanism
- ADR: Database migration discipline for rollback safety
- `docs/release-runbook.md`
