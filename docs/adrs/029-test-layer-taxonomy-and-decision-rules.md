# ADR: Test layer taxonomy and decision rules

- **Date:** 2026-05-12
- **Status:** proposed
- **Update (2026-08-16):** the reference implementation's integration rig (`packages/reference-implementation/__tests__/integration/`, #900) implements this layer's "real DB" requirement with the `docker` CLI managing an ephemeral `postgres:17-alpine` container directly, rather than the testcontainers library named below. The rig also accepts an operator-supplied `TEST_DATABASE_URL` as an alternative to the ephemeral container. The layer's decision (real Postgres, per-package `__tests__/integration/`, `*.integration.test.ts`) is unchanged.

## Context

The repository has unit tests, integration tests, and end-to-end (E2E) tests, but without a shared definition of what each layer is *for*, layer boundaries drift. The most common drift modes:

- **E2E inversion (test pyramid flipped).** Contributors reach for E2E by default because "it tests the whole thing." Over time the E2E suite balloons to hundreds of tests covering things — form validation, API response shapes, error formatting — that a unit or integration test could verify in milliseconds. The suite becomes slow, flaky, and expensive to run, which produces an incentive to skip it, which erodes the safety net it was supposed to provide.
- **Unit tests that mock everything.** A "unit test" that mocks the DB, HTTP client, auth service, and validators is testing the mocks, not the code. The test passes; the integration is broken. Coverage looks high; confidence is low.
- **Redundant coverage across layers.** The same assertion lives in a unit test, an integration test, and an E2E test. When the code changes, three tests break for the same reason. Triage burns time. The marginal test added no information.
- **Implementation-detail testing.** Snapshot tests over entire component trees, tests on private functions, tests asserting internal call ordering. These break on refactors that don't change behaviour, which trains the team to ignore failing tests.

The repository's domain — verifiable credentials, JSON-LD context resolution, DID resolution, signature verification, adapter dispatch — is heavily I/O-dependent. **Heavy unit-test mocking specifically does not work well here**, because the value of the code is in the integration with real cryptographic libraries, real JSON-LD processors, real DBs, real HTTP. A test suite shaped like a classical pyramid (many unit tests, few integration tests) would produce high coverage on logic that has no bearing on whether the system actually works.

What we want: a test suite shaped more like a **trophy** (or **honeycomb**) — substantial integration test investment, focused unit tests for genuinely pure logic, a small deliberate set of E2E tests for critical user journeys, and a tiny smoke subset for prod health checks.

We need a shared decision rule that contributors and reviewers use to put tests at the right layer the first time, before drift sets in.

## Decision

We adopt the following test layer taxonomy. Each layer is defined by the **question it answers**, not by the tool that runs it.

### Layer definitions

**Unit tests** answer: *"Does this function or component behave correctly in isolation?"*

- **Scope:** one function, one class, one component. No I/O. No network. No DB. No filesystem.
- **Tool:** Jest + React Testing Library for components.
- **Speed budget:** under 10ms per test.
- **Location:** co-located, `foo.ts` + `foo.test.ts`.
- **What belongs here:**
  - Pure functions: parsers, validators, formatters, transformers, date logic, signature verification helpers, JSON-LD context utilities.
  - React components in isolation: `<CredentialCard>` renders correctly given props, fires the right callback on click, handles loading/error/empty states.
  - Domain logic without I/O: state machines, business rule evaluators, credential schema builders.
  - Reducer/store logic.

**Integration tests** answer: *"Do these modules work correctly together, against real I/O?"*

- **Scope:** multiple modules within a package; **real** DB (via testcontainers), **real** HTTP within the process (via supertest), **real** filesystem when relevant. External services (third-party APIs, vckit when out-of-process, identity registries) are mocked at the HTTP boundary using msw or nock.
- **Tool:** Jest + testcontainers + supertest + msw or nock.
- **Speed budget:** under 1 second per test.
- **Location:** per-package, `__tests__/integration/` or `src/**/*.integration.test.ts`.
- **What belongs here:**
  - API route handlers exercised end-to-end within-process via supertest (real Express, real routing, real middleware, real DB).
  - Database queries against a real Postgres in a testcontainer.
  - Adapter logic: input arrives, adapter transforms and dispatches, output matches what the external system would receive (external system mocked at the HTTP boundary).
  - Multi-step workflows within one process: "issuer creates credential → stores → retrieves → verifies."
  - Cross-module composition within a package: the public API of `services` composing internal modules correctly.

**E2E tests** answer: *"Does the user-facing journey actually work through a real browser against a real stack?"*

- **Scope:** the whole app via the UI, full Docker Compose stack, real DB.
- **Tool:** Cypress.
- **Speed budget:** under 30 seconds per test.
- **Location:** per app, `packages/<app>/e2e/` (per ADR 025).
- **Headcount target: tens of tests per app, not hundreds.** A growing E2E suite is a smell — something is leaking down from a higher layer.
- **What belongs here:**
  - A small, deliberately limited set of critical user journeys per app.
  - Reference-implementation example: issuer logs in → creates a credential → it appears in the holder's wallet view → verifier scans and confirms validity.
  - Playground example: user pastes a credential → playground decodes and displays → user modifies a field → re-signs → exports.

**Smoke tests** answer: *"Is the deployed service alive and serving correctly?"*

- **Scope:** read-only, idempotent health checks against a deployed environment.
- **Tool:** Cypress (a tagged subset of the E2E suite) or a separate minimal HTTP-only suite.
- **Speed budget:** under 5 seconds per test; full smoke suite under 2 minutes total.
- **Location:** `packages/<app>/e2e/smoke/` or tagged within the existing E2E suite.
- **What belongs here:**
  - `GET /health` returns 200 with expected payload.
  - `GET /version` returns the deployed version (matches the deploy target).
  - One read-only request exercising the DB connection.
  - One read-only request exercising a critical external dependency.

### Decision rule for placing a new test

When writing a new test, the contributor asks in order:

1. **Can a unit test give me confidence this works?** Yes → write it there. Stop.
2. **Is the thing I'm testing fundamentally about integration between modules or with real I/O?** Yes → integration test. Stop.
3. **Is this a critical user-facing journey through the UI that no lower layer can validate?** Yes → E2E test.
4. **Otherwise:** don't write the test at the highest layer. Drop down.

The phrasing is "put the test where the answer is most authoritative," not "put the test at the lowest possible layer." For pure logic that's the unit layer. For UNTP's heavily I/O-dependent flows, the most authoritative answer is usually integration — mocking out the I/O removes exactly the thing being tested.

### Conformance tests are a separate axis

The `test-suite` package is the UNTP conformance test framework — it tests that an implementation conforms to the UNTP spec. This is structurally distinct from the unit/integration/E2E taxonomy:

- **Audience:** external implementers, not internal contributors.
- **Authority:** the UNTP specification, not our implementation.
- **Role in CI:** `reference-implementation` and `playground` run `test-suite` against themselves as part of their integration test suite. Conformance failure is a build failure. This gives the conformance suite double duty: external implementer test framework AND internal regression check.

Conformance tests are not a fourth layer in the same dimension; they're an orthogonal concern that uses the integration layer as its mechanism.

### Explicit anti-patterns

These are named so reviewers have shared language to push back with:

- **E2E for form validation.** "User enters invalid email, sees error message" is a unit or component test. Running it in Cypress is 100x cost for identical signal.
- **E2E for API contract verification.** `POST /credentials` returns 422 on missing field → integration test with supertest, not E2E.
- **Unit tests that mock everything.** If a "unit test" mocks the DB, HTTP client, auth service, and validators, it's testing the mocks. If the code genuinely has that many collaborators, write integration tests, or decompose the code.
- **Integration tests that exercise one pure function.** A test with no I/O and no module composition is a unit test wearing a different hat. Rename or relocate it.
- **Implementation-detail testing.** Snapshot tests over entire component trees, tests on private functions, tests asserting internal call ordering. These break on refactors that don't change behaviour. Test observable behaviour, not internals.
- **Snapshot tests as a substitute for thinking.** Snapshot tests are appropriate for stable serialised output (generated JSON-LD documents, generated credential payloads). They become noise when snapshotting anything that legitimately evolves. Default to assertion-based tests; reach for snapshots deliberately.
- **E2E as the safety net for thin lower layers.** If the felt experience is "we keep adding E2E because we don't trust the unit/integration coverage," the fix is to invest in the lower layers. Adding more E2E compounds the problem.

### Coverage philosophy

We do not target a single coverage percentage across the repository. Coverage targets per layer reflect the layer's role:

- **Unit:** high coverage of pure logic (target ~80%+ for files containing pure functions). Components covered for behaviour, not lines.
- **Integration:** high coverage of API surface, DB interactions, and adapter logic. Coverage by feature, not by line.
- **E2E:** coverage by critical user journey, not by line or branch. The right number is "every persona's primary journey works," typically 10-30 tests per app.
- **Smoke:** every deployed service has at least one smoke test.

Coverage is a signal, not a target. A PR that drops coverage because it deletes dead code is good. A PR that adds coverage by testing implementation details is bad.

We chose this taxonomy because each layer answers a question only that layer can authoritatively answer, the decision rule gives contributors a clear first-time placement strategy, and the named anti-patterns give reviewers language to enforce the boundaries. The trophy/honeycomb shape (heavy on integration) is appropriate for UNTP's I/O-heavy domain where mocking removes the thing being tested.

## Consequences

**What becomes easier:**
- Contributors know where a new test belongs without ad-hoc judgment per PR.
- Reviewers have explicit anti-patterns to point at when pushing back on misplaced tests.
- The E2E suite stays small and trustworthy — it doesn't bloat with form-validation tests.
- Test runtime stays bounded per layer, which keeps Stage A feedback fast.
- The conformance suite has a clear role (integration-layer mechanism, external-implementer audience) and doesn't get confused with internal regression testing.

**What becomes harder:**
- Contributors must read and internalise the taxonomy. Some will resist ("it works, why does it matter what layer it's in") until they see the slow E2E suite their predecessors built.
- Code review now includes a layer-appropriateness check. A test that "works" but is at the wrong layer should be sent back, which is a new kind of review feedback some contributors find pedantic.
- Heavy integration test investment requires testcontainers (real Postgres in CI), msw/nock for HTTP mocking, and good test data factories. More infrastructure than pure unit testing.
- The trophy/honeycomb shape produces slower per-test runtime than a pure pyramid would — integration tests are slower than unit tests by definition. Acceptable given the value, but worth budgeting in CI minutes.

## Alternatives Considered

### Classical test pyramid (many unit tests, few integration tests, very few E2E)

Rejected for this project because the domain is heavily I/O-dependent. A pyramid produces high unit-test coverage by mocking the I/O, but the mocks are exactly the integration we care about. The pyramid is correct for codebases where most value lives in pure logic; UNTP's value lives in integration.

### Pure E2E coverage (no unit, no integration)

Rejected because E2E is slow, expensive, and flaky. Using it for everything produces an unmaintainable suite that contributors avoid running. Misses fast feedback on logic bugs that unit tests catch in milliseconds.

### No defined taxonomy; trust contributor judgment

Rejected — this is the current state and it produces the drift modes named in the Context section. Without shared definitions, every contributor's "unit test" or "integration test" means something different, and the suite becomes a Frankenstein of overlapping coverage at the wrong layers.

### Test category labels (e.g., `@unit`, `@integration`, `@e2e` tags on test files)

Considered as a supplementary mechanism. Not adopted as the primary discipline because the taxonomy is enforced more naturally by directory structure and tooling (Jest configs per layer, separate Cypress runs). Labels can be added later if specific selection needs arise.

### 100% coverage as a single global target

Rejected because coverage is a signal, not a target. Mandating a global number incentivises gaming (testing trivial getters, snapshotting everything) and doesn't capture whether the meaningful behaviours are tested.

## References

- ADR 014: PR checks workflow with static matrix and combined Turbo filter
- ADR 015: Four-stage testing strategy (A through D)
- ADR 025: E2E test architecture per package
- "The Practical Test Pyramid" — Ham Vocke (general reference)
- "Testing Trophy" — Kent C. Dodds (general reference for integration-heavy shape)
- Testing Library principles: "the more your tests resemble the way your software is used, the more confidence they can give you"
