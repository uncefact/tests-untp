# ADR: Script naming convention with `:check` / `:fix` suffixes

- **Date:** 2026-05-12
- **Status:** accepted

## Context

Across the repository's packages, scripts that verify code quality (format, lint) have inconsistent names. The root `lint` script does double duty across packages; some packages have a `format` that writes, some have a `format:check`, and behaviour varies. This inconsistency causes:

- CI workflows hardcoding the wrong script name and either checking when they should write or writing when they should check.
- Contributors running `pnpm format` locally and accidentally modifying files when they expected a check, or vice versa.
- The PR checks matrix (ADR 014) cannot invoke a uniform task across packages without first standardising names.

## Decision

We standardise script naming across all packages with explicit suffixes:

- **`format:check`** — `prettier --check .` (verify only, exits non-zero on issues)
- **`format:fix`** — `prettier --write .` (modify files)
- **`lint:check`** — `eslint .` (verify only)
- **`lint:fix`** — `eslint . --fix` (modify files)

Conventions:

- CI always uses `:check` variants. CI is the authoritative gate; it verifies, it never modifies.
- Developers locally use `:fix` variants for active editing.
- lint-staged uses the modifying tools directly (`prettier --write`, `eslint --fix`) on staged files at commit time, because lint-staged passes specific file paths rather than invoking package scripts.

We chose this because the `:check` / `:fix` suffix pair makes the intent of every script invocation explicit and uses a single uniform suffix for the modifying variant regardless of which underlying tool flag (`--write` for Prettier, `--fix` for ESLint) the script wraps. The simpler decision rule ("`:check` to verify, `:fix` to modify") is easier to internalise than a split where Prettier scripts use `:write` and ESLint scripts use `:fix`.

## Adoption notes

This ADR records the target convention across the workspace. The initial implementation ships as part of the "Bundle B" CI restructure and applies the convention at the **root** `package.json` level only:

- `format:check` and `format:fix` already existed and run Prettier scoped to a `packages/**/*.{js,jsx,ts,tsx,json,css,scss,md}` glob, not a bare `.`. They are unchanged in this chunk.
- `lint:check` (renamed from `lint`) is a composite that runs root-level ESLint over `packages/` plus delegates to the reference implementation's own `lint` (which runs `prisma generate && tsc && eslint .` to cover Prisma-generated types). It is not a pure `eslint .` invocation as described in the Decision section above; the Decision section describes the target convention for new per-package scripts.
- `lint:fix` is new and runs root-level ESLint with `--fix`. It does not yet delegate into the reference implementation; that is a follow-up.

Per-package script standardisation is deferred to a follow-up so the matrix can ship without bundling ESLint configuration work for packages that do not currently have it (`untp-test-suite-mocha`, `@test-untp/vc-test-suite`). The CI quality job uses the root-level scripts, which is sufficient to enforce the convention at the gate.

## Consequences

**What becomes easier:**

- CI scripts cannot accidentally modify files because they use `:check` variants exclusively.
- Local developer intent is explicit. `pnpm format:fix` is unambiguous.
- The PR checks matrix can invoke a uniform task across packages.

**What becomes harder:**

- One-time migration cost: every package's `package.json` needs script renames, and any existing CI workflows or contributor habits need updating.
- Slightly longer script names than `pnpm format` alone.

## Alternatives Considered

### Use `format` for check and `format:fix` for write (asymmetric)

Rejected because it is confusing: the unmodified name doing one thing and the suffixed name doing another lacks symmetry, and contributors regularly run the wrong one.

### Use `format` for write and `format:check` for check (current state in some packages)

Rejected because the dangerous variant (write) is the default invocation. A contributor typing `pnpm format` to check formatting will accidentally modify files. The safer variant should not require a suffix.

### Single `format` script that detects context (CI vs local) and behaves accordingly

Rejected because magic-context detection is brittle and hides intent. Explicit naming is clearer.

## References

- ADR 007: Turborepo for build orchestration and caching
- ADR 014: PR checks workflow with static matrix and combined filter
