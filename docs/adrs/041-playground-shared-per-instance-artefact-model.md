# ADR-041: Playground shared per-instance artefact model

- **Date:** 2026-07-15
- **Status:** accepted
- **Update (2026-08-20):** two rules recorded here became per-family with #811. Identity: link sets key by the normalised resolver request URL rather than a content hash, per [ADR-046](./046-link-set-identity-is-the-resolver-request-url.md). Removal: link sets remove immediately with a toast-and-Undo (the model gained a pure `restore` operation), per [ADR-047](./047-link-set-removal-is-undoable-not-confirmed.md), which supersedes this record's rejection of delete-with-undo for that family. Credentials and schemes keep content-hash identity and dialog-confirmed removal as recorded here.

## Context

The UNTP Playground validates artefacts a user uploads or resolves. Until #809 it held one slot per artefact kind: credentials keyed by `PermittedCredentialType` (five type slots) and conformity schemes keyed by the single-member `SchemeType` enum, where each new upload of a kind overwrote the previous one (`src/app/page.tsx`). The phase-2 restructure (#808) turns each of three families (Credentials, Conformity Schemes, Link Sets) into a collection of independently validated instances.

The first of those, multiple conformity schemes (#677), needs an instance to have a stable identity, a way to dedupe a re-upload against a loaded instance, replacement in place when they match, and removal. Credentials (#810) and link sets (#811) need the identical behaviour. Three hand-rolled copies would drift on exactly the parts that must stay consistent.

Four forces, each verified against the current code, shape the design and rule out the naive "the shared model owns the instance array, each family owns its own results" boundary.

- **Results and payload were already split, and that split is the bug.** Scheme documents lived in `schemes` and their pipeline results in a parallel `schemeTestResults` map, joined by the type key. With one slot per type this was invisible; with a collection it produces replace-flash, orphaned results after a remove, and no clean join for the report.
- **There was no write-side staleness guard.** `validatedRef`/`confettiShownRef` in `SchemeTestResults.tsx` only decided whether to _start_ a run; `runPipeline`'s `setStep` wrote results with no check that the instance was still current. Because replace-in-place re-runs an asynchronous pipeline (schema fetch, JSON-LD expansion), a superseded run's late write could land in the wrong card.
- **Report readiness treated "no results" as success.** `reportService.ts` computed status with `steps.every(...)`, and `[].every()` is `true`, so an instance with empty or missing results was marked SUCCESS.
- **A document id is not a reliable identity.** A JSON-LD `id` can be absent, and for an enveloped credential the outer `id` is the `data:application/vc+jwt,...` envelope, not the document (`credentialService.ts` decodes it). A filename is only a basename, so two different documents saved as `scheme.json` collide. Matching on id-then-url-then-filename therefore has to carry a conflict case and still mishandles these.

A domain fact also matters: a conformity scheme is not independently versioned. The `(v0.7.0)` on a card is the UNTP release detected from the document `@context`, not a version of the scheme's content, so identity must ignore it.

## Decision

Introduce one **family-agnostic per-instance collection** that schemes (#677) now, and credentials (#810) and link sets (#811) later, all reuse. It lives in `packages/untp-playground/src/types/artefact.ts` (types) and `packages/untp-playground/src/lib/artefactCollection.ts` (pure functions), names no family, and owns the ordered instances, their opaque results, and the run token that guards writes. It does not own any family's pipeline, copy, hashing, or UI.

### Identity is the content hash

An instance is identified by the hash of its content (`hashContent` over the family's document, in `src/lib/hash.ts`). Identical content is one instance; different content is a separate one. This is unambiguous where a document id is not: it needs no id, is unaffected by an envelope wrapper (the family hashes its decoded document), never conflates two different documents that share a filename, and carries no conflict case. The detected UNTP context version is part of the content, but two genuinely different versions of a scheme are different documents and so different instances, which matches the domain. The URL and filename survive only as the card title and source caption, never as identity.

### Shape and operations

```ts
type InstanceId = string; // immutable, minted per instance, stable across in-place replace
type RunId = string; // minted per pipeline run; the write token

type ArtefactSlot<P, R> = {
  instanceId: InstanceId;
  contentHash: string;
  payload: P;
  result: R | undefined; // undefined = no snapshot yet / cleared for a new run
  runId: RunId | null; // null = idle (never run, or just replaced)
};
type CollectionState<P, R> = { items: ArtefactSlot<P, R>[] };
```

Pure functions: `emptyCollection`, `matchTarget` (by content hash), `upsert`, `remove`, `beginRun`, `commitResult`.

- `upsert` appends a new instance in upload order, or, on a matching content hash, replaces it at its existing index (keeping its `instanceId`, clearing its result and `runId`). Re-uploading identical content is idempotent; different content always appends. Re-populating a URL-sourced instance is re-submitting it through the family's normal ingest, which replaces the card when the content is unchanged and adds a new one when the content has changed.
- `beginRun` mints a `RunId` and sets the pending result, but only for an idle slot, so a repeated effect (React StrictMode's double invocation) cannot start a duplicate pipeline. `commitResult` is the only path that writes a result and applies only if the slot still holds that `RunId`, so a superseded or removed run's late completion, and its toasts and confetti, are dropped.
- `remove` deletes an instance. There is no undo: the family confirms a removal with a dialog before deleting, so the destructive action is deliberate rather than reversible after the fact. `runId` stays set on a finished run (it is not cleared on completion) because per-run confetti dedupe keys on it; only `upsert` clears it.

### Scope boundary

The shared model owns the ordered instances, the opaque payload `P` and result `R`, the `runId`, and the transitions above. Each family owns: the `P`/`R` shapes, the pipeline that produces `R` (committed only via `commitResult`), the content-hash of its document, title/subtitle copy, the removal confirmation copy, confetti, its grouping views, and its report projection. Credentials are one flat `CollectionState` for the family, with the five typed cards and the `n / 5` checklist as views over the detected type, and the content hash taken from the decoded credential (never the envelope), so a re-ingest whose detected type changed moves the same `instanceId` between groups. Report readiness requires every loaded family instance to have a terminal result (a non-empty result whose steps have all settled), joined by `instanceId`; it is enforced in the UI gate and again inside `generateReport`, so a still-validating artefact holds generation rather than being recorded as a spurious pass or failure.

## Consequences

- One identity, dedupe, replace and run-guard implementation backs all three families, so #810 and #811 add a family by supplying a content-hash function, `P`, `R`, and a pipeline, rather than re-deriving the mechanics or the race handling.
- Content-hash identity is unambiguous and removes the id/url/filename matcher, its conflict case, and the same-filename and envelope-id footguns. The trade-off: re-fetching a URL whose content has changed produces a new card rather than replacing the old one, which treats changed content as the genuinely different document it is; the stale card is removed with the confirmation flow.
- The stale asynchronous write is closed by construction: `commitResult` is the only write path and checks the run token, so a consumer that writes any other way is out of contract and caught in review.
- Removal is a confirmation dialog rather than delete-with-undo, so the collection carries no undo snapshot or conditional-restore state, and there is no silent-undo failure mode to convey.
- Report vacuity is fixed at the source: readiness requires a terminal result per loaded instance in every present family, so an empty, orphaned, or mid-pipeline artefact can no longer read as success, and a report cannot be generated across a still-validating family.
- Migrating schemes off the `SchemeType`-keyed objects touches several consumers together (`page.tsx` state, `reportService.ts`, `TestReportContext.tsx`, `SchemeTestResults.tsx`, the report result type, the E2E selectors), so the migration lands as one coherent change.

## Alternatives Considered

- **Identity by document id, then source URL, then filename.** Rejected. A JSON-LD id can be absent, is the envelope string for an enveloped credential, and does not distinguish two different documents that share a filename, so the matcher needed a conflict case and still mishandled these. The content hash is unambiguous and needs none of that.
- **Identity by `id` plus the detected version.** Rejected. A conformity scheme is not independently versioned; the detected version is part of the content, so two versions are two documents under content hashing, without a special rule.
- **Content hash plus a remembered source URL, so re-fetching the same URL replaces even when the content changed.** Rejected in favour of pure content hashing: changed content is a different document, and keeping source-URL matching would reintroduce the provenance-tracking the content hash exists to avoid.
- **Delete-with-undo (a "Removed" toast with an Undo action).** Rejected in favour of a confirmation dialog. Undo required a single-level `pendingUndo` snapshot, a conditional `restore` (rejecting stale tokens and re-occupied identities), and careful toast-dismissal to avoid a silent no-op when the Undo could not complete; a confirmation dialog is simpler and makes the destructive action deliberate up front.
- **The shared model owns the instance array only; each family owns its own results map.** Rejected. Results and payload split across two stores is the defect that produced replace-flash, orphaned results, and report vacuity; co-locating an opaque `R` on the slot adds no family knowledge and removes the drift.
- **A shared `useInstancePipeline` hook that runs each family's pipeline.** Rejected. The pipeline shapes differ materially (schemes run three mostly-synchronous steps, credentials run verification plus multiple schema steps plus an extension branch, link sets resolve then fan out), so a shared runner would either encode a pretence or accumulate family branching. The shared layer owns a guarded `commitResult` transition and leaves the pipeline to the family.

## References

- Story #677 (multiple conformity schemes, first consumer), ticket #819 (this shared model), epic #808 (phase-2 tabbed artefact surface).
- Reused by #810 (credentials instance groups) and #811 (link sets).
- Builds on the tabbed surface from #809 (merged in #835).
- Related to ADR-029 (test-layer taxonomy and decision rules), which governs where the collection, the guarded commit, the card, and the page wiring are tested.
