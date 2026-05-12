# ADR: Changeset enforcement via three layers

## Status

proposed

## Context

Changesets only works if PRs actually include changeset files. Without enforcement, contributors will forget, especially external contributors unfamiliar with the convention. A PR that lands on `main` without a changeset means the affected packages will not be released until somebody notices and writes one retroactively.

The repository expects contributions from a mix of audiences:

- Maintainers familiar with the conventions.
- External SaaS vendors contributing adapters via PR.
- Contributors using Claude Code to draft PRs.

Each audience has different defaults. Pure CI-side enforcement is sufficient as an authoritative gate but produces a poor experience for Claude-driven contributions (failure feedback comes late, after the contributor has finished the PR).

## Decision

We enforce changeset presence via three layers, each catching a different population:

**Layer 1: `CLAUDE.md` instructions.** A top-level `CLAUDE.md` file in the repository instructs Claude Code that every PR affecting a releasable package must include a changeset. The file describes bump-level criteria, format, and references the marker file location.

**Layer 2: Local Claude Code hook with marker file.** A Claude Code hook intercepts PR creation locally and checks for a marker file at `.claude/.changeset-verified` (gitignored). If absent, the hook blocks PR creation. Claude writes the changeset, creates the marker, then proceeds. The marker is a local-machine state file, not committed.

**Layer 3: CI status check (authoritative).** A required GitHub Actions status check runs `pnpm changeset status --since=origin/main` on every PR. If no changeset exists for the changes since main, the check fails. Branch protection requires this check to pass before merge.

Empty changesets (`pnpm changeset --empty`) cover legitimate non-releasing changes (docs-only PRs, internal `components` refactors with no consumer impact, CI config changes). They are markers saying "I considered this and decided no version bump is needed."

Husky pre-commit hooks retain their existing role of running lint-staged for formatting and lint fixing. They do **not** handle changeset enforcement — Claude Code and CI cover that more appropriately.

We chose this three-layer design because each layer catches a different failure mode: Claude-driven work is caught at authoring time, the CI check is the unbypassable backstop, and the local marker provides fast feedback to Claude without coupling enforcement to a tool (Husky) that not all contributors will have installed.

## Consequences

**What becomes easier:**
- Claude-driven contributions self-enforce — Claude writes the changeset as part of drafting the PR, never reaching CI without one.
- External human contributors hit a clear CI failure with an actionable message rather than landing a PR that maintainers have to fix manually.
- The system has a single authoritative gate (CI) so policy is enforceable regardless of local tooling state.
- Husky's role stays minimal, focused on what pre-commit hooks are actually good at (per-file formatting and lint fixes).

**What becomes harder:**
- The marker file is local state — a contributor running Claude Code on a fresh checkout starts without it, which is the expected behaviour but worth documenting.
- The CI check needs careful tuning so it doesn't fire on PRs that legitimately don't need changesets (docs-only, etc.). Empty changesets handle this but require contributors to know to use them.
- Maintaining `CLAUDE.md` accurately is a soft requirement — if it drifts from the actual changeset format, Claude will write malformed changesets. Tied to keeping conventions stable.

## Alternatives Considered

### CI status check only, no local enforcement

Rejected because it produces poor feedback timing for Claude-driven contributions. Claude can finish drafting a PR, push, and only then discover the missing changeset via failing CI. The local hook catches this at authoring time when it is cheap to fix.

### Husky pre-push hook for changeset check

Rejected because pre-push is a poor lifecycle event for this — by push time the PR is effectively done, and pre-push hooks are easily bypassed (`--no-verify`, missing Husky install, web UI commits). Adding another local layer that is bypassable in the same way as Claude's hook gains nothing.

### Auto-generate changesets via Claude Code action on PR open

Rejected as the primary mechanism because it makes Claude authoritative for bump-level decisions, which is a judgment call (breaking vs additive is sometimes subtle). The current design has Claude assist and the human maintainer review; auto-generation without review risks wrong bump levels landing silently.

### No enforcement, rely on maintainer review

Rejected because it does not scale and depends on maintainer attention. With external contributors and Claude-driven work, missed changesets would be frequent.

## References

- ADR: Changesets for version management and publishing
- ADR: Husky and lint-staged for pre-commit hooks
- `CLAUDE.md` at repository root
