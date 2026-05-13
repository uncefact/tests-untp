# ADR: Release workflow correctness measures

- **Date:** 2026-05-12
- **Status:** accepted
- **Update (2026-05-13):** `release.yml` currently triggers on `push: branches: main`. PR #611 proposes switching it to `push: next` with Changesets-driven OIDC publishing, but is not yet merged. The pnpm migration on this branch converted the workflow's install step from yarn to pnpm without touching the trigger or the correctness measures (idempotency, single concurrency group, etc.), which are unchanged.

## Context

The repository has previously experienced a bug where Docker images were built from the wrong commit — the workflow that triggered on a release didn't check out the expected SHA, resulting in an image whose contents did not correspond to the tagged version. This is a class of failure that is silent (the image is published successfully) but corrupting (the image's contents are wrong).

Cross-workflow triggers in GitHub Actions have a subtle pitfall: the default `GITHUB_TOKEN` does not trigger downstream workflows. A release workflow that creates a git tag using the default token will not cause a tag-triggered Docker build workflow to run. The standard workaround (using a Personal Access Token or GitHub App token) adds operational complexity.

Concurrency between simultaneous releases can produce race conditions if not explicitly controlled.

## Decision

We adopt the following correctness measures in release workflows:

**Single release workflow, not split across tag triggers.** All release work (npm publish, Docker build and push, git tagging, GitHub release creation) happens in one workflow triggered by push to `main`. The workflow uses `changesets/action` outputs (`published`, `publishedPackages`) to determine whether and what to release. Conditional steps within the same workflow handle Docker builds for affected apps.

This avoids the `GITHUB_TOKEN`-doesn't-trigger-downstream-workflows problem entirely — there is no downstream workflow.

**Explicit SHA checkout with verification.** The checkout step uses `ref: ${{ github.sha }}` rather than relying on the default checkout behaviour, which can resolve a tag or branch to an unexpected commit. A verification step runs immediately after checkout:

```yaml
- name: Verify checkout
  run: |
    ACTUAL=$(git rev-parse HEAD)
    if [ "$ACTUAL" != "${{ github.sha }}" ]; then
      echo "❌ Wrong checkout. Expected ${{ github.sha }}, got $ACTUAL"
      exit 1
    fi
```

This catches the wrong-commit bug at the start of the workflow rather than after the bad image has been published.

**Concurrency control.** The release workflow uses `concurrency: { group: release, cancel-in-progress: false }`. Two pushes that hit `main` in quick succession do not race — the second waits for the first. `cancel-in-progress: false` ensures an in-flight release is never cancelled, because cancellation mid-publish would produce a partial release (some npm packages published, some Docker images not built, no clean rollback).

Other workflows have their own concurrency groups:
- Dev build: `cancel-in-progress: true` (newer builds supersede older).
- Docs deploy: `cancel-in-progress: true`.
- PR checks: `cancel-in-progress: true`, grouped by PR number.
- Prod deploy/rollback: `cancel-in-progress: false`.

**Supply-chain provenance.**

- npm provenance: `id-token: write` permission and `NPM_CONFIG_PROVENANCE: true` env var. Generates verifiable attestations linking the published npm package to the source commit and the workflow that built it.
- Docker provenance and SBOM: `provenance: true` and `sbom: true` on `docker/build-push-action`. Attaches signed provenance attestation and Software Bill of Materials to every image.

**Node version pinning.** `actions/setup-node` reads `.nvmrc` via `node-version-file: '.nvmrc'`. Single source of truth across local development, CI, and Docker builds.

We chose these measures because each addresses a specific failure mode we have either experienced (wrong-commit builds) or that is well-known in the GitHub Actions ecosystem (cross-workflow triggers, concurrent releases, supply-chain integrity).

## Consequences

**What becomes easier:**
- The wrong-commit class of bug is structurally prevented — the verification step fails loudly if checkout state diverges from expected.
- Releases are atomic: the single workflow either completes successfully or fails partway. There is no scenario where npm publishes succeed but Docker builds never trigger because of a token issue.
- Supply-chain consumers (other projects, security tools) can verify the provenance of published artefacts.
- Concurrent pushes to main do not corrupt releases.

**What becomes harder:**
- The release workflow is larger and more complex than a chain of smaller workflows. Debugging a failure requires reading through more YAML.
- Long-running release workflow occupies a CI runner for the full duration. Acceptable given release frequency.
- Provenance attestations require specific permissions (`id-token: write`) which must be granted explicitly in the workflow.

## Alternatives Considered

### Split into multiple workflows triggered by tag pushes

Rejected because the `GITHUB_TOKEN`-doesn't-trigger-downstream-workflows issue would require a PAT or GitHub App token for the Changesets action to push tags that trigger downstream builds. This adds a long-lived secret to manage. The single-workflow design avoids the problem entirely.

### Rely on default checkout behaviour without SHA verification

Rejected — this is the failure mode the repository has previously experienced. Adding the explicit SHA pin plus verification step is cheap insurance against a recurrence.

### `cancel-in-progress: true` for release workflow

Rejected because cancelling an in-flight release mid-publish is worse than letting two releases run sequentially. Partial releases are nasty to recover from.

### Skip provenance and SBOM

Rejected because the project is a reference implementation for an open standard. Supply-chain trust matters for downstream consumers, and the cost of generating provenance is near-zero (one config flag).

## References

- ADR: Changesets for version management and publishing
- ADR: Docker image tagging strategy
- ADR: CI/CD workflow inventory
- GitHub documentation on `GITHUB_TOKEN` and workflow triggers
- npm provenance documentation
