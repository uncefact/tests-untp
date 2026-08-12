# ADR-042: Vanished-Reference Races Return the Pre-Check's Status

- **Date:** 2026-08-12
- **Status:** accepted

## Context

ADR-036 put database error translation at the repository boundary but left one status question open, tracked as #781: when a reference that passed a route's pre-check is deleted by a concurrent request before the write lands, the resulting foreign-key violation had no settled answer. The shared helper's `invalidReference` context maps a foreign-key violation to a 400, while the same missing reference caught a moment earlier by the route's pre-check returns a 404, so one condition produced two answers depending on timing. Several call sites mapped the race to neither and fell through to the sanitised 500 (identifier creation, scheme-qualifier recreation, data-model creation), and DID creation mapped it to a 400 whose message said "not found".

## Decision

A reference that passed a route's pre-check and vanished before the write returns exactly what the pre-check returns steady-state: the same status and the same message.

1. **Per-route consistency wins over cross-surface uniformity.** The caller sees one behaviour for one condition on one route, regardless of timing. A 400 is wrong for this condition because the request was valid when it was validated; the state changed underneath it, which is what the pre-check's 404 already says.
2. **Multi-key writes match the violated column first.** Where the write carries more than one foreign key, `isForeignKeyViolationOn` matches the violated column before the pre-check's error is thrown, so a violation on any other column (for example a tenant deleted mid-request) rethrows into ADR-036's sanitised backstop instead of carrying a misattributed message.
3. **Applied at:** identifier creation and scheme-qualifier recreation (scheme), data-model creation (parent config), DID creation (service instance, previously the helper's 400), render-template creation (data model, previously matched column-blind), and link-registration bulk creation (identifier).

## Consequences

- Easier: route contracts stay exactly as documented. The race maps to a status and description every affected route already carries, so adopting the convention needed no Swagger changes.
- Easier: clients handle one outcome per condition; retrying after a 404 means the referenced record is gone, whatever the timing was.
- Harder: the repository catch must repeat the pre-check's message string, a small duplication kept adjacent in the same function or file.

## Alternatives Considered

- **Map every vanished reference to the helper's 400 `invalidReference`.** Rejected: the same condition then yields a 400 or a 404 depending on timing, and a 400 tells the caller their request was malformed when it was valid at validation time.
- **One uniform status for all vanished references across the API, regardless of route.** Rejected: every affected route already documents the pre-check's status for this condition, so a cross-surface constant would change documented contracts for no caller benefit, and the per-route rule already yields a uniform experience within each route.

## References

- #781 (the open question this settles), #782 (the adoption it landed with)
- ADR-036 (the repository-boundary mapping this refines)
