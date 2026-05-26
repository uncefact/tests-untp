# ADR-035: Throw structured error classes from utils sub-entries

- **Date:** 2026-05-26
- **Status:** accepted
- **Supersedes:** [ADR-034](./034-utils-error-and-warning-reporting.md)

## Context

Every diagnostic emitted by a utils function carries a structured payload — `code`, `message`, `received`, `expected`, `remediation`, `pointer`, plus a wrapped underlying cause — so downstream consumers can **aggregate** and **render** those diagnostics to a human without parsing strings or inferring what went wrong. ADR-034 established this contract; it is preserved here.

What ADR-034 got wrong was the **delivery mechanism**. Returning `ValidationOutcome` / `ParseOutcome<T>` with `errors[]` and `warnings[]` arrays forces every consumer to handle the same three-line shape (`if (outcome.errors.length > 0) translate-and-throw`) and at the API surface forces a choice between outcome-returning functions and `*OrThrow` variants which do not scale across many sub-entries.

After landing `/node`, `/validation`, `/schema-loaders`, `/resolvers`, and `/conformity-vocabulary`, and starting the first cross-package migration (the SSRF guard consolidation in [#673](https://github.com/uncefact/tests-untp/issues/673)), the friction is visible. The RI verify route, `assertPublicUrl`, the data-models routes, and the playground fetch route all do the same outcome→throw translation. The plural-errors affordance the outcome shape was sold on is consumed as plural in only one place today (Ajv `allErrors: true` inside `validateAgainstSchemas`); warnings are populated by exactly one accumulator (per-redirect-hop in `/resolvers`).

Errors *want* to throw in JavaScript. The natural failure-signalling primitive is `throw` + `try/catch` + `instanceof`. That gives us type-safe discrimination at consumer sites, centralised translation at routing / handler boundaries, natural propagation when a consumer does not want to handle it locally, and preserved stack traces. The current convention gives none of those and asks every consumer to do the same translation by hand.

We want to **keep ADR-034's structured-payload contract** but **deliver it via a thrown structured error class** instead of an outcome array.

## Decision

Utils sub-entries throw structured error classes for failure cases. The structured payload from ADR-034 is preserved as the public fields on those classes. ADR-034 is superseded.

The convention has six rules.

### 1. One system-wide base class: `StructuredError`

Defined in the utils package's main entry (`packages/untp-utils/src/structured-error.ts`, re-exported from `@uncefact/untp-utils`) but **named neutrally**. Any package in the workspace is encouraged to extend it for its own domain errors as the system-wide structured-diagnostic pattern. The name does not claim utils ownership; the location is just pragmatic shared infrastructure (every package in the workspace already depends on `@uncefact/untp-utils`).

```ts
export interface StructuredErrorInit {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  remediation?: string;
  pointer?: string;
  cause?: unknown;
}

export class StructuredError extends Error {
  readonly code: string;
  readonly received?: unknown;
  readonly expected?: unknown;
  readonly remediation?: string;
  readonly pointer?: string;

  constructor(init: StructuredErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.code = init.code;
    this.received = init.received;
    this.expected = init.expected;
    this.remediation = init.remediation;
    this.pointer = init.pointer;
  }
}
```

`Error.cause` (the native option, available since Node 16.9 / ES2022) replaces the `raw` field from ADR-034. Same intent, idiomatic, free chained-cause printing in Node and browsers.

### 2. One typed error hierarchy per sub-entry

Each sub-entry defines its own error classes in a single file `errors.ts`, alongside the existing `codes.ts` layout. A sub-entry's base class extends `StructuredError`. Concrete failure classes extend the sub-entry base. Concrete classes lock their `code` and may add typed fields specific to the failure (e.g. `PrivateAddressError.resolvedAddresses: readonly string[]`).

```ts
// packages/untp-utils/src/node/errors.ts
import { StructuredError } from '../structured-error.js';

export class UrlValidationError extends StructuredError {}

export class InvalidUrlError extends UrlValidationError { /* ... */ }
export class UnsupportedSchemeError extends UrlValidationError { /* ... */ }
export class PrivateHostnameError extends UrlValidationError { /* ... */ }
export class ResolutionFailedError extends UrlValidationError { /* ... */ }
export class ResolutionEmptyError extends UrlValidationError { /* ... */ }
export class PrivateAddressError extends UrlValidationError {
  readonly resolvedAddresses: readonly string[];
  /* ... */
}
```

Consumers catch at whichever level fits — the concrete class for specific handling, the sub-entry base for sub-entry-scoped handling, `StructuredError` for "any structured diagnostic from anywhere" handling.

### 3. Successful returns are plain values

A function that previously returned `ParseOutcome<T>` now returns `Promise<T>` (or `T`). The "I returned an outcome with empty errors" path collapses to the natural return.

```ts
export async function validatePublicUrl(
  url: string,
  options?: ValidatePublicUrlOptions,
): Promise<{ address: string; family: 4 | 6 }> {
  // throws UrlValidationError subclasses on failure
}
```

### 4. Plural-failure cases live as a typed field on the thrown class

When a single library call produces multiple structured failures at once (Ajv `allErrors: true` is the canonical example), the thrown class **may** carry an optional `failures: readonly ValidationFailure[]` field. The thrown error itself stays singular (one throw per call); the `failures` field carries the array.

```ts
export interface ValidationFailure {
  code: string;
  message: string;
  pointer?: string;
  received?: unknown;
  expected?: unknown;
  remediation?: string;
}

export class SchemaPayloadError extends SchemaError {
  readonly failures: readonly ValidationFailure[];
  constructor(failures: readonly ValidationFailure[]) {
    super({
      code: 'schema.payload-invalid',
      message: `Payload failed validation against ${failures.length} rule(s).`,
    });
    this.failures = failures;
  }
}
```

Consumers that want to render every failure iterate `e.failures`. Aggregating consumers (see §6) duck-type on the presence of `failures` and spread it; single-error consumers just use `e.code` and `e.message`. No `*Aggregate*` wrapper class, no parallel return shape, no `AggregateError` from the platform.

### 5. Warnings are opt-in on the success return

Warnings are non-fatal advisory information. **The vast majority of functions have no warning concept at all and return `T` directly.** The few functions that genuinely produce advisory warnings opt into a `{ value: T; warnings: readonly StructuredWarning[] }` return shape:

```ts
export interface StructuredWarning {
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
  remediation?: string;
  pointer?: string;
}

export async function resolveDocument(
  url: string,
  options?: ResolveDocumentOptions,
): Promise<{ value: LoadResult; warnings: readonly StructuredWarning[] }> {
  // ...
}
```

The asymmetry (some functions return `T`, others return `{ value, warnings }`) is intentional: we judge a per-function opt-in cleaner than forcing every function in the codebase to a homogeneous return shape for the sake of the handful that ever emit warnings. The function's signature documents whether warnings exist; aggregating consumers (§6) duck-type on the success return.

### 6. Aggregating consumers bridge throws to structured collections via a small helper

Consumers that need to collect diagnostics across many utils calls (multi-URL ingestion paths, batch validation, deeper pipelines that compose checks) write a small helper that wraps each call in a `try/catch`. The helper does three things:

1. Catches `StructuredError` (and only `StructuredError` — anything else propagates as a genuine bug).
2. Checks for the optional `failures` field on the caught error and spreads it when present (§4).
3. Inspects the success return for the opt-in `{ value, warnings }` shape (§5) and extracts warnings.

```ts
// Heterogeneous on purpose: a `StructuredError` instance carries `Error`
// affordances (`stack`, `cause`, `name`) that an aggregator may want to
// log on the singular case; a `ValidationFailure` is a plain payload that
// only carries the structured fields. Both share `code`, `message`,
// `received`, `expected`, `pointer`, `remediation`. Aggregating consumers
// that need a uniform shape project both into their own report type.
type StructuredErrorLike = StructuredError | ValidationFailure;

async function captureStructured(fn: () => Promise<unknown>): Promise<{
  errors: readonly StructuredErrorLike[];
  warnings: readonly StructuredWarning[];
}> {
  try {
    const result = await fn();
    const warnings = hasWarnings(result) ? result.warnings : [];
    return { errors: [], warnings };
  } catch (e) {
    if (e instanceof StructuredError) {
      const errors = hasFailures(e) ? e.failures : [e];
      return { errors, warnings: [] };
    }
    throw e;
  }
}
```

Each leaf call collapses to one line at the consumer:

```ts
const { errors, warnings } = await captureStructured(() => validateAgainstSchemas(payload, [schemaUrl]));
```

`code` / `message` / `received` / `expected` / `remediation` / `pointer` all survive across the aggregation. The consumer composes its own report shape on top of these; the library has no opinion on the report.

One helper per aggregating consumer (or one shared in a place that fits the consumer's architecture). The library publishes no aggregator helper of its own — the consumer's report shape is theirs to define.

## Consequences

**Easier:**

- Consumer call sites that are happy to let the error propagate collapse from three lines to one. Boundary translation (HTTP error handler, CLI exit-code mapping, UI toast renderer) catches a base class once and handles the structured payload there.
- Discrimination becomes type-safe: `e instanceof PrivateAddressError` beats `outcome.errors[0]?.code === 'url.private-address'`. Refactor-safe, IDE-discoverable.
- Stack traces preserved by default; `Error.cause` chains print automatically.
- API surface is smaller and more consistent. No outcome shape to maintain; no `*OrThrow` siblings to invent; one shape across every sub-entry.
- Adding a new failure mode forces failure-type design at authoring time (`new MyError(...)` not `errors.push({ code, ... })`).

**Harder:**

- One-time refactor: every existing utils sub-entry, every consumer, every test. Mechanical but non-trivial. The migration is sequenced as one PR per sub-entry (`/node`, `/validation`, `/schema-loaders`, `/resolvers`, `/conformity-vocabulary`) plus one PR per consumer migration (services + RI in three places + playground), then redoing [#673](https://github.com/uncefact/tests-untp/issues/673) on the new footing.
- `instanceof` checks rely on consumers and producers seeing the same class instance. Under pnpm workspaces (our setup) this is the default. When utils ships to npm and consumers pin separately, two different copies of utils in `node_modules` would break `instanceof`. Mitigation: consumers must pin the major; we will not ship breaking changes to `StructuredError` without a major bump.
- Warnings asymmetry on the success return type. Most functions return `T`; the few that may produce warnings return `{ value: T; warnings: readonly StructuredWarning[] }`. The asymmetry is real; we judge it worth it because the alternative (every function returns the wrapper shape) adds noise to everything for the benefit of two or three functions.

## Alternatives Considered

- **Keep ADR-034 unchanged.** Rejected. Every consumer reproduces the same outcome→throw boilerplate; the convention is grafted-on rather than idiomatic; the plural-errors-and-warnings shape is consumed as plural in only one place today and that case is just as well served by a typed field on a thrown error.

- **Add `*OrThrow` variants per function alongside the outcome-returning ones.** Rejected. Doubles the API surface for every existing and future sub-entry. The consumer faces a "which variant do I call?" choice at every call site, with no obvious right answer (the throw variant is convenient at call sites; the outcome variant is needed for aggregation contexts that want to keep going on failure). The variants drift in behaviour over time.

- **A single library-level `unwrap(outcome)` helper.** Rejected. Saves one conditional but leaves the consumer-side translation cost intact and adds indirection. Does not pay its weight.

- **Throw plain `Error` instances with a `.code` string field.** Rejected. Loses type-safety on discrimination, ages worse under refactoring, and gives the IDE no signal about which extra fields are available per code. Class hierarchies are JavaScript's native answer to typed errors.

- **Name the base class `UntpUtilsError` and scope it to utils.** Rejected. The structured-diagnostic pattern is not utils-specific; any package in the workspace that throws structured diagnostics should be free to extend the same base. Naming it neutrally (`StructuredError`) keeps it free for system-wide reuse without claiming utils ownership.

- **Homogeneous success return shape (every function returns `{ value, warnings }`).** Rejected. Forces every call site in the codebase to destructure for a warnings field that is empty 95% of the time, in service of the small minority of functions that ever emit warnings. The asymmetric opt-in (§5) puts the cost on the rare case rather than the common case.

- **One file per error class.** Rejected. Six or seven classes per sub-entry × five sub-entries is ~30 single-class files for no navigability win. One `errors.ts` per sub-entry, alongside the existing `codes.ts`, mirrors the layout already in use and keeps related classes together.

## References

- [ADR-034](./034-utils-error-and-warning-reporting.md) (superseded by this ADR). Its structured-payload contract (`code`, `message`, `received`, `expected`, `remediation`, `pointer`, wrapped cause) is preserved; only the delivery mechanism changes.
- [#673](https://github.com/uncefact/tests-untp/issues/673) (the SSRF migration whose friction surfaced this revision).
- [MDN: `Error: cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
