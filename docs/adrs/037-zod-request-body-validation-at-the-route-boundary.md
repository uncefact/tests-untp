# ADR-037: Request-Body Validation with Zod Schemas at the Route Boundary

- **Date:** 2026-07-02
- **Status:** accepted

## Context

Most reference implementation write routes accept request bodies with little runtime shape validation: handlers check one or two fields with `isNonEmptyString` and pass the rest through unchecked type casts. Malformed input then fails deep in the stack (a `TypeError` on property access, Prisma's client-side argument validation, or an upstream service call) instead of returning a documented 400. The sanitised backstop from ADR-036 stops those responses leaking internals, but the status and message remain wrong: clients receive a generic 500 for what is a malformed request. An API-surface audit catalogued the gaps route by route (#736), including handlers that dereference a JSON `null` body, array fields never checked to be arrays, and a Zod schema that exists for documentation but is never applied to the incoming body.

One route already validates properly: the identifier links publish route defines a Zod schema, parses the body with `safeParse`, and maps the first issue to a 400 naming the offending field. Zod is already a dependency of the package, and `src/lib/swagger/schemas.ts` already uses Zod to generate the OpenAPI component schemas. The open question was whether to extend that mechanism across the write surface or to grow the manual per-field helpers in `src/lib/api/validation.ts`.

## Decision

Every write route validates its request body with a Zod schema before calling repositories or upstream services, and the schemas live in a shared per-resource module.

1. **Zod is the validation mechanism at the route boundary.** Each write route parses the raw body (`req.json()` guarded so malformed JSON and a literal `null` body become a 400) and runs it through a Zod schema with `safeParse`. On failure the route throws `ValidationError` with the first issue rendered as `field.path: message`, which the central error mapper returns as a 400. This extends the pattern the links publish route established rather than introducing a new one.
2. **Schemas live in a shared per-resource module** (`src/lib/api/request-schemas/`, one file per resource). POST and PATCH handlers for a resource sit in different route files (`route.ts` and `[id]/route.ts`) but share field shapes; co-locating schemas in route files would duplicate those shapes. Keeping a resource's create and update schemas in one file also makes deriving one from the other possible where the shapes coincide (the link schemas do this via `.partial()`); most resources hand-declare both because their update shapes add nullable-clear semantics the create shapes lack.
3. **Consumers import the resource file directly** (`@/lib/api/request-schemas/<resource>`), never through a barrel index. A barrel makes every importer transitively load every schema file and its dependencies (`@uncefact/untp-ri-services`, `@uncefact/untp-utils`), which breaks route tests that mock those packages with partial module factories: a test starts failing when an unrelated resource's schema needs an export the mock does not provide.
4. **Unknown keys are stripped, not rejected.** Zod's default object behaviour (strip unknown keys) is kept, matching the links route. Clients that have been sending extra fields keep working; the handler only ever sees validated, known fields.
5. **Validation covers shape and type, not existence.** Referential checks (does this identifier exist, does it belong to this tenant) stay in repositories and services, where ADR-036 already maps constraint violations. The schema's job ends at "this is a well-formed request".

## Consequences

- Easier: malformed input fails fast with a 400 naming the offending field, instead of a `TypeError` or a sanitised 500. The failure mode is documented and testable per schema rather than per code path.
- Easier: handlers drop their unchecked `as` casts; `parsed.data` is the typed input, so the compiler enforces that only validated fields are used.
- Easier: a resource's create and update schemas sit in the same file, so a field added to one verb is visible next to the other; where the shapes coincide the update schema can derive from the create schema directly.
- Harder: request shapes are now declared twice, once in the request-schemas module and once in the hand-written Swagger `requestBody` annotations. The two can drift; folding the documentation generation onto the request schemas is a possible later step but out of scope here.
- Harder: every new write route carries a schema obligation, and schema tests join the test surface.

## Alternatives Considered

- **Manual per-field checks via `src/lib/api/validation.ts` helpers.** Rejected: the audit showed this approach is exactly what left the gaps, because per-field discipline does not hold across dozens of fields and routes. Helpers validate one field at a time, so nothing enforces that every field was checked, `null` bodies and non-array arrays were repeatedly missed, and the handler still needs unchecked casts to name the body's type.
- **Co-locating schemas in each route file** (the original links route layout). Rejected: a resource's create and update bodies share most field shapes but live in different route files, so co-location duplicates the shapes and lets them drift. The links publish route's previously co-located schema moved into the module for the same reason once the link update route needed the same field shapes.
- **Extending `src/lib/swagger/schemas.ts` with the request schemas.** Rejected: that file's job is generating OpenAPI component schemas, and its shapes describe responses. Mixing request-validation schemas into it couples two concerns with different change cadences in one growing file; the request-schemas module can still be imported there later if documentation generation is unified.
- **Rejecting unknown keys (`.strict()`).** Rejected: it turns previously accepted requests into 400s for clients that send extra fields, a behaviour break with no safety gain, since stripped fields never reach the handler.
- **Validating inside repositories instead of routes.** Rejected: repositories receive typed inputs from many callers (routes, seeds, services) and are the wrong place to re-check shape on every call; the boundary where untyped external input enters the system is the route, so that is where shape validation belongs. This mirrors ADR-036's division: routes own request semantics, repositories own persistence semantics.

## References

- #736 (this change), #379 (credentials-route validation, absorbed by #736)
- ADR-036 (database error translation; the sanitised backstop that currently catches these failures)
- Existing pattern: `src/app/api/v1/identifiers/[id]/links/route.ts`
- Zod: https://zod.dev
