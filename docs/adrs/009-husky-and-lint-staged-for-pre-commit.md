# ADR: Husky and lint-staged for pre-commit hooks

- **Date:** 2026-05-12
- **Status:** accepted

## Context

Local pre-commit hooks are useful for catching formatting and lint issues at the earliest possible moment, before they reach CI. Running format/lint across the entire repository on every commit is too slow; running them only on staged files is fast and targeted.

Husky and lint-staged are the standard tools for this pattern in Node.js monorepos. They already exist in the repository for code quality concerns.

The question is what role Husky should play in the new architecture — specifically whether it should also enforce changeset presence at commit or push time.

## Decision

Husky retains its existing role: a `pre-commit` hook that runs `lint-staged`, which in turn runs Prettier (write mode) and ESLint (fix mode) against staged files only.

Husky does **not** enforce changeset presence. That concern is handled by the three-layer enforcement design in a separate ADR (CLAUDE.md instructions, Claude Code local hook, CI status check).

Specifically:

- `pre-commit` hook runs `lint-staged`.
- No `pre-push` hook for changeset checking.
- `lint-staged` config uses modifying tools (`prettier --write`, `eslint --fix`) directly on staged file paths.

We chose this scoping because pre-commit is the right lifecycle event for per-file formatting and lint fixing, but it is a poor lifecycle event for changeset enforcement (changesets are PR-scoped, not commit-scoped). Mixing concerns into Husky would couple unrelated enforcement into a single mechanism that is also bypassable.

## Consequences

**What becomes easier:**
- Formatting and lint issues are auto-fixed at commit time without contributor intervention.
- CI's `format:check` and `lint:check` jobs have minimal failures because Husky has already fixed most issues locally.
- Husky's scope is narrow and focused — it does one thing.

**What becomes harder:**
- Husky's protection is bypassable via `git commit --no-verify` or by contributors who don't install Husky. The CI layer is the authoritative gate, and Husky is purely a developer-experience convenience.
- Contributors who haven't installed Husky may push code that fails CI's formatting check unnecessarily. Onboarding documentation should make Husky installation a clear early step.

## Alternatives Considered

### Use Husky for both pre-commit (format/lint) and pre-push (changeset check)

Rejected because pre-push is bypassable and adds a third local layer (alongside Claude Code's hook and CI) that doesn't catch anything CI doesn't already catch. The CI layer is authoritative; another local layer is redundant complexity.

### Replace Husky with a different git hook manager (simple-git-hooks, lefthook, etc.)

Rejected because Husky already works in the repository. Migrating to a different tool adds risk for no functional benefit.

### No pre-commit hooks at all, rely entirely on CI

Rejected because the developer experience cost is real — running CI just to discover a formatting issue that auto-fixes locally in milliseconds is bad feedback. The local layer earns its keep as a UX improvement even though it is not authoritative.

## References

- ADR: Changeset enforcement via three layers
- ADR: Script naming convention with `:check` / `:fix` suffixes
