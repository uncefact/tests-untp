# ADR-034: Error and Warning Reporting Convention for `@uncefact/untp-utils`

- **Date:** 2026-05-21
- **Status:** accepted

## Context

`@uncefact/untp-utils` is shared by three first-class consumers with different audiences, UI surfaces, and language preferences:

- The **reference implementation** (an operator-facing web app) renders results to non-technical issuers and operators.
- The **UNTP test suite** (CLI + library) renders results to spec authors, integrators, and UNTP implementers reviewing the conformance of UNTP artefacts.
- The **UNTP playground** (browser tool) renders results to anyone diagnosing a UNTP artefact.

Each surface needs different presentation: different prose, different terminology, different document-path conventions for pointing at the failing field. The library cannot produce text that fits all three without locking in language that suits one and feels wrong to the others (for example, "registered within your tenant" is meaningful to an RI operator and meaningless to a CLI user, whose mental model has no tenants).

The conformance test suite design doc (a work in progress, not yet ratified) proposes a `ValidationError` interface with `code`, `message`, `received`, `expected`, `remediation`, `pointer`, `schemaUrl`, `raw`. That shape is rich enough, but it does not say **who fills which fields**. Without that boundary, every consumer relitigates whether the library or the caller owns the wording. ADR-033 §3 introduced a first set of warning codes for conformity-claim validation but specified the shape inline. As more utils primitives ship (credential detectors, schema loaders, resolvers), the surface multiplies and the convention has to be settled once.

Related: ADR-033 (the first concrete consumer of this convention); conformance test suite design doc; the existing playground `detectVersion` / `detectCredentialType` and the RI's existing CVC validation warning shape.

## Decision

Adopt the following convention for **every error and warning** `@uncefact/untp-utils` emits.

### 1. Structured shape

Errors and warnings carry a structured, library-agnostic shape:

| Field | Required | Populated by | Purpose |
| --- | --- | --- | --- |
| `code` | yes | utils | Namespaced identifier (see §2). Stable; consumers may branch on it. |
| `message` | yes | utils | Neutral, factual summary in English. No app concepts. |
| `received` | optional | utils | What the data showed, when relevant. Plain JSON-serialisable. |
| `expected` | optional | utils | What was expected, when knowable. Plain JSON-serialisable. |
| `pointer` | optional | utils when its inputs allow; consumer otherwise | JSON pointer (or other locator) into the input the utility received. The consumer re-maps if needed. See §4. |
| `remediation` | optional | consumer (utils only when agnostic and derivable from `expected`) | User-facing remediation in the consumer's tone and audience. See §4. |
| `raw` | optional | utils | Underlying error, when wrapping a third-party exception (Ajv, jsonld). For tooling, not for display. |

The same shape applies to errors and to warnings. Both are returned as arrays (see §5); the library does not throw for input-related failures.

### 2. Code namespacing

Codes are dotted, thing-oriented, and stable.

- Thing-oriented: `conformity-scheme.not-found`, not `conformity-claim.scheme-not-found`. The namespace identifies what the code is *about* (a scheme, a profile, a criterion), not the activity that detected it (validation, parsing).
- Stable: once a code ships, its identifier does not change. Renames go through an ADR that supersedes the old code.
- Exported as importable values via the **`as const` object** pattern so consumers can reference codes without hardcoding strings:

```ts
export const ConformityWarningCode = {
  SchemeNotFound: 'conformity-scheme.not-found',
  ProfileNotFound: 'conformity-profile.not-found',
  // ...
} as const;

export type ConformityWarningCode =
  (typeof ConformityWarningCode)[keyof typeof ConformityWarningCode];
```

This pattern is preferred over TypeScript `enum` (no reverse-mapping overhead, plain string values that serialise cleanly, exhaustiveness via the union type).

### 3. Library agnosticism in messages

The `message` field is neutral. It states the fact of the mismatch in plain English without referencing UI metaphors, deployment models, or app-specific concepts (no "tenant", "register", "catalogue", "import", "issuer dashboard"). Examples:

- "Scheme URI is not in the known set." (good)
- "Verify that the scheme is registered in your tenant." (bad; RI-specific)
- "Criterion URI is not in the profile's published criterion list." (good)
- "Pick a criterion from the dropdown." (bad; UI-specific)

The reasoning: messages are not the user-facing string. They are a structured record of what is wrong. The consumer wraps or replaces them when rendering.

### 4. `pointer` and `remediation`: most-informed-source wins

Both fields end up where the most informed source can fill them. The convention:

**`pointer` is populated by the util when its inputs let it construct one unambiguously**, and is otherwise the consumer's responsibility:

- Schema validation against the UNECE-published JSON Schemas: Ajv reports an `instancePath` for each error; the util passes it through directly. No consumer re-mapping needed unless the consumer wrapped the input.
- JSON-LD safe-mode expansion: when the underlying library reports a term-resolution failure or structural fault with a position or path, the util passes that through.
- Functions that walk an iterable internal structure: for example, `validateConformityClaim` knows it iterated `claim.criteria[i]`, so a `criterion-not-in-profile` warning carries `pointer: '/criteria/0/criterion'`.

A util-supplied `pointer` is **relative to the input the consumer passed in**. If the consumer extracted that input from a larger document (e.g., the RI extracts a claim object from `credentialSubject.conformityClaim` before passing it in), the consumer re-maps the pointer by prepending the wrapper path. The consumer is also free to replace the pointer entirely if its document model differs.

The util **omits** `pointer` when it has no knowledge of the input's internal structure (for example, when it operates on a pair of fragments and compares them without traversing).

**`remediation` is the consumer's responsibility almost always.** The util may supply a remediation **only** when the text is plainly derivable from `expected` and uses agnostic, non-technical language. Acceptable: `"Use one of: <list from expected>"`. Not acceptable: anything mentioning a workflow, dashboard, deployment role, register, or tenant. Consumer-supplied remediation always wins over a util-supplied one.

Consumers enrich via a simple map at the call site; no overrides parameter is required on any util's signature:

```ts
const { warnings } = validateConformityClaim(claim, scheme);
const enriched = warnings.map((w) => ({
  ...w,
  pointer: w.pointer ? `/credentialSubject/conformityClaim${w.pointer}` : undefined,
  remediation: remediationForRiOperator(w),
}));
```

### 5. Errors are returned, not thrown

Both **errors** and **warnings** carry the structured shape from §1, and both are returned as arrays. Functions in `@uncefact/untp-utils` do not throw for input-related failures. The caller decides whether to throw, log, collect across calls, or render inline.

The reason consumers have different needs:

- The **RI** wants a single error to convert into a 4xx response and bail; it can throw at the call site.
- The **test suite** wants to collect every error across a batch of artefacts to generate a complete report; throwing on the first defeats that.
- The **playground** wants to render every error inline against the artefact being inspected.

If utils throw for data failures, all three consumers wrap every call in `try` / `catch` and re-extract the structured fields. Returning errors as data keeps call sites simple and lets each consumer apply its own throw policy.

**Outcome shapes** for validators and parsers:

```ts
interface ValidationOutcome {
  errors: ValidationError[];      // empty array on success
  warnings: ValidationWarning[];  // advisory; not blocking
}

interface ParseOutcome<T> extends ValidationOutcome {
  value?: T;                      // present iff errors.length === 0
}
```

A parser that fails produces an outcome with `errors[]` populated and `value === undefined`. A validator with errors reports them alongside any warnings. The difference between an error and a warning is meaning, not shape: an error means the input is invalid (a parser cannot produce output, a validator says the data should not be used); a warning is advisory.

**What still throws:** only genuine programming errors that signal "this call is impossible" — for example, calling with `null` where a non-null argument is required, or violating a documented invariant. These are bug indicators in the caller, not problems with the data.

## Consequences

### Easier

- One shape works for the RI, the test suite, and the playground; none of them re-invent or re-translate utils output.
- Codes are stable contracts; consumers can branch on them with exhaustive switches and trust that ADR governance protects them from silent renames.
- Utils stays narrow and pure: no rendering concerns, no opinionated remediation text, no app-specific phrases that age into noise as the products evolve.
- Adding a new utils sub-entry (credential detectors, resolvers, schema loaders) is a mechanical exercise: pick code namespace, fill `code` / `message` / `received` / `expected`, done.

### Harder

- Every consumer carries its own pointer-mapping and remediation-text logic. We trade some duplication of text for keeping each surface coherent in its own audience's language. The RI / playground / test suite each maintain a small lookup from `code` to user-facing string; that is acceptable.
- A consumer that displays warnings raw (without enrichment) shows neutral-but-bland messages and no pointer. That is honest, not a regression; the unenriched output is still understandable.

## Alternatives Considered

- **Inline remediation and pointer in utils unconditionally.** Rejected for `remediation` in the general case: text that tries to fit one consumer ages into noise in the others ("Verify the URI matches a registered entry" means different things in three apps). Accepted for `pointer` when the util has the information (Ajv `instancePath`, jsonld safe-mode positions, internal iteration indices), since the util is the most informed source and throwing the information away would force consumers to re-validate to recover it. The convention in §4 carves out exactly these cases.
- **Overrides parameter on each function (e.g. `validateConformityClaim(claim, scheme, { overrides: { 'code-x': { remediation, pointer } } })`).** Rejected. Encourages a per-function configuration object that proliferates as more utils functions ship, with no obvious composition story. A consumer-side `.map(enrich)` covers the same ground with one line and no new API surface.
- **Single-string `message` only (no `received` / `expected`).** Rejected. Forces consumers to parse messages to extract structured data for tooling (reports, diagnostics, machine-readable output). The whole point of structured warnings is that machines can read them; throwing away that property to "keep it simple" defeats the purpose.
- **TypeScript `enum` for codes.** Rejected. TypeScript `enum` introduces reverse-mappings, non-erased runtime objects with non-string values for numeric enums, and is increasingly disfavoured by modern style guides. The `as const` object gives the same ergonomics without the warts.
- **Adopt the test suite design's `ValidationError` shape as canonical and have this ADR mirror it.** Rejected as the source. That design doc is a work in progress and not yet ratified; treating its shape as the binding contract would invert the dependency. This ADR is the canonical pattern; the design doc should be updated to align with it as part of its own ratification.

- **Throw on input-related failures and let callers `try` / `catch`.** Rejected (see §5). Throwing surfaces only the first failure, forces every consumer to wrap every call site, and re-extract the structured fields by inspecting the error class. The test suite specifically wants to collect every failure across a batch of artefacts for a complete report; a thrown-error API is the wrong shape for that. Library-contract violations (passing `null` where a non-null argument is required) still throw; those are programming errors, not data errors.

## References

- ADR-033 (first concrete consumer of this convention; `conformity-claim.*` codes will be renamed to `conformity-{scheme,profile,criterion}.*` per §2).
- Issue #541 (CVC implementation parent; first PR consuming this convention is the `@uncefact/untp-utils/conformity-vocabulary` sub-entry).
