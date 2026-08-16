# ADR: The seed fails loudly when configuration for a category it was asked to seed is missing

- **Date:** 2026-08-16
- **Status:** accepted
- **Update (2026-08-16):** the summary decision 6 describes is also emitted on a mid-run failure (a category whose configuration resolved but whose own write then failed), not only on the default-mode preflight abort and on success. It also distinguishes a category that completed only some of its work (for example, some but not all render template files found) from one that fully seeded, reporting the former under a `categoriesPartial` bucket with the specifics named, rather than folding it into `categoriesSeeded`. The summary also now covers the system tenant, the core data models, and the custom seed, not only the categories a missing environment variable can gate.
- **Update (2026-08-16):** decision 2 is tightened. A missing required environment variable always triggers the fail-loud posture, even when the same category also contains an invalid value or names an unrecognised adapter type: the presence of a missing variable is decided independently of any other problem in the category, so a second, unrelated mistake can never downgrade an absent variable out of the fail-loud posture. An invalid value with nothing missing keeps its original behaviour (`'other'`, not fail-loud).

## Context

Issue #771 asks for this because a half-configured deployment currently starts successfully and only reveals itself much later, when someone tries to issue or resolve a credential and hits a missing service instance, DID, or render template. Fixing that at seed time is what unblocks treating a green container start as evidence the deployment is usable.

The seed (`prisma/seed.ts`, run from the container entrypoint) creates the system tenant, registrars, identifier schemes, data models, service instances for the IDR, storage and VC services, the default DID, and render templates. Several of those categories need environment variables: `DATA_ENCRYPTION_KEY` for any service instance, the `SYSTEM_IDR_*`, `SYSTEM_STORAGE_*` and `SYSTEM_VC_*` groups for their respective services, and `SYSTEM_DID` for the default DID. Render templates additionally need the storage service to have been seeded.

Today every one of those cases is a warning and a skip. The seed exits zero, the entrypoint proceeds, and the container reports healthy. `documentation/docs/reference-implementation/operations/startup.md` documents this as the intended contract, under "Seed contents": each category is independent, and a category whose variable is missing is skipped with a warning while the rest proceed.

The cost is that the signal is a log line nobody reads at the moment it matters. An operator who mistypes a variable name, or whose secret injection silently fails, gets a running system that cannot do its job, and discovers this through a downstream failure whose message points at the symptom rather than the missing variable.

The custom seed, which loads an operator-supplied manifest in the same run, already takes the opposite posture: a configuration-level problem (unparseable YAML, a schema violation, render templates requested with no storage service available) exits non-zero and stops the boot. So the two halves of the same seed currently disagree about what a missing prerequisite means.

A partial seed is nonetheless a real workflow. An operator may deliberately bring the system up with only some services configured and add the rest later through the application, and that use must remain available as a stated choice rather than an accident.

## Decision

**1. A category whose required environment variables are missing fails the seed by default.** The seed exits non-zero, and because the entrypoint runs under `set -e`, the container does not start. This inverts the current default because a container that starts without the configuration it needs is indistinguishable, from the outside, from one that started correctly, and the difference only surfaces when a user's request fails.

**2. Only missing variables carry this meaning; operational failures keep the behaviour they have today.** A variable that is absent is a deployment mistake the operator can fix before the system serves traffic. A storage service that is unreachable, an unknown adapter type, an invalid value, or a database error are different failures with different remedies, and today's broad `try`/`catch` blocks label all of them "configuration not available". Widening the fail-loud posture to cover them would turn a transient dependency outage into a failed deployment, so the change narrows those catches instead of repurposing them.

**3. Configuration is resolved for every category before any category executes, and a default-mode failure happens before the seed writes anything or calls any external service.** The seed's later steps create a DID in the VC service and upload template objects to storage, neither of which is covered by the database transaction. Attempting every category and failing at the end would leave those external effects behind on a boot that then failed, so the check has to precede the work rather than accumulate alongside it.

**4. All missing variables are reported together, not the first one found.** An operator fixing a deployment wants the complete list in one boot cycle rather than discovering the next missing variable after each redeploy.

**5. `SEED_ALLOW_PARTIAL=true` restores the skip behaviour as a chosen state.** The variable is read as the exact string `true`, and this is stated as a new contract rather than inherited from a convention: the existing `SKIP_*` flags do not parse uniformly (the entrypoint's `SKIP_MIGRATIONS`, `SKIP_BACKFILLS` and `SKIP_SEED` proceed only when the value is exactly `false`, while `SKIP_CUSTOM_SEED` skips only when the value is exactly `true`). One variable covers the whole seed rather than one per category, because the workflow it serves is a single intent, "bring this up with what is configured and add the rest later", and per-category flags would multiply deployment configuration for a distinction nobody has needed.

**6. Every run ends with one structured summary naming the categories seeded, the categories skipped, and the variables responsible.** This holds on success as well as failure, so an operator confirming a good deployment reads the same record as one diagnosing a bad one, and neither has to reconstruct the outcome from scattered log lines. In default mode the aggregate error carries the same object.

## Consequences

An operator who misconfigures a deployment learns at deploy time, from a message naming each missing variable and the category it gates, instead of from a failed credential issuance later.

A deployment that relies on today's silent partial seed across restarts will fail to start after upgrading until `SEED_ALLOW_PARTIAL=true` is set. This is a breaking change for those deployments and is why the change carries a migration note; the documented startup paths (copying `.env.example` before starting Compose, and the E2E Compose stack) populate every variable and are unaffected.

The seed gains a separation between resolving configuration and executing categories. That is a structural change to a file that is currently one long procedure, and it makes the categories individually testable, but it also means the file no longer reads top to bottom as the order things happen.

Making that separation testable also splits the executable from the logic. `prisma/seed.ts` exports `main` and no longer runs itself; a new `prisma/seed-cli.ts` owns the process-level concerns (catching, the exit code, disconnecting) and is what the container entrypoint and the `prisma.seed` script now invoke. Anything that invoked `seed.ts` directly must move to `seed-cli.ts`, and the seed's script-relative paths (the `.env` lookup and the render-template directory) now derive from the running script's path rather than the module's own URL.

Narrowing the existing catch blocks makes the failure modes distinguishable, at the cost of more branches in code that previously handled everything the same way.

The seed still leaves a partially populated database when an operational failure interrupts it mid-run, because DID creation and template upload cannot be rolled back with the database writes. The upserts are idempotent, so a corrected re-run converges; the change does not make the seed transactional and does not claim to.

## Alternatives Considered

**Keep warn-and-skip and rely on a health check or startup probe to detect the missing pieces.** Rejected. It defers the signal to a second mechanism that must independently know what "fully configured" means, duplicating the seed's own knowledge of which categories need which variables, and it leaves the window where the container reports healthy while being unusable.

**Fail on the first missing variable rather than collecting them.** Rejected. Each redeploy would reveal one more missing variable, turning a single misconfiguration into several deploy cycles, and the information needed to list them all is available at the same moment as the first.

**Attempt every category, then fail at the end if any were skipped.** Rejected. The later categories create a DID in the VC service and upload objects to storage before their database rows exist. A run that did that work and then exited non-zero would leave external state behind for a boot that failed, which is harder to reason about than refusing before any of it happens.

**A per-category opt-in (for example `SEED_ALLOW_PARTIAL_DID`).** Rejected. It multiplies deployment configuration to express a distinction the supported workflow does not draw: the case being served is bringing the system up with whatever is configured, not permitting one specific category to be absent while forbidding another.

**Extend the fail-loud posture to every failure the current catch blocks cover, including an unreachable storage service.** Rejected. Compose starts the storage service without waiting for it to become healthy, so the seed can legitimately run before storage accepts uploads. Treating that as fatal would make a documented startup path fail intermittently for a reason the operator cannot fix by changing configuration.

## References

- Issue [#771](https://github.com/uncefact/tests-untp/issues/771), which asks for this posture change, the opt-in, and the summary.
- Issue [#762](https://github.com/uncefact/tests-untp/issues/762), which catches invalid configuration at application boot; this ADR covers missing configuration at seed time.
- `documentation/docs/reference-implementation/operations/startup.md`, "Seed contents", whose statement that a category with a missing variable is skipped with a warning is superseded by this decision and updated alongside it.
- ADR-033, which records the custom seed's architecture; its loader already exits non-zero on configuration-level problems, and this decision brings the core seed into line.
