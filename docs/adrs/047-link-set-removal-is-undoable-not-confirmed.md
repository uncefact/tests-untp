# ADR-047: Link set removal is undoable, not confirmed

- **Date:** 2026-08-20
- **Status:** accepted

## Context

The Link Sets family (#811) needed a removal affordance, and its ticket contract specifies one directly: remove fires a `Removed <card title>` toast with `Undo`, with no confirm dialog. [ADR-041](./041-playground-shared-per-instance-artefact-model.md) had recorded the opposite for the families that existed then: removal confirms through a dialog, and delete-with-undo was rejected because the shared model carried no way to restore a removed slot. This ADR records the newer decision and what it changes in the shared model.

Removing a link set is cheap to reverse in a way removing a credential is not: the instance is a resolver response the app can hold in memory and reinsert with its result intact, so no pipeline needs re-running. A confirm dialog charges every removal an interruption to prevent a mistake that undo repairs in one click.

## Decision

1. **Link set removal deletes immediately and offers a single-level Undo in the toast.** The #811 contract specifies this shape; a dialog would contradict it. Undo restores the removed slot, with the result it already carried, at its original list position. Single-level is enforced with a stable toast id: a newer removal's toast replaces the previous one, so only the most recent removal is undoable.
2. **The shared model gains a pure `restore` operation** (`restore(state, slot, index)` in `src/lib/artefactCollection.ts`): reinsert a previously removed slot at its old index, clamping an out-of-range index, and a no-op when the same `instanceId` or identity key is already present (the user re-added it before undoing). The no-op case is surfaced to the user in a toast rather than silently doing nothing.
3. **Credentials and schemes keep their confirm dialogs.** Their removal discards a completed validation run that took real time and external calls to produce, so the dialog is guarding something undo cannot cheaply repair. The per-family split is cross-referenced in `SchemeTestResults.tsx` so it reads as deliberate.

## Consequences

- Removing a link set is one click instead of two, and a mis-click is one click to repair.
- The undo is single-level: only the most recent removal is restorable, and only until its toast is dismissed or another removal replaces it.
- ADR-041's "no undo, dialog-confirmed removal" now describes two families rather than all of them; a fourth family chooses its removal shape deliberately, like its identity key ([ADR-046](./046-link-set-identity-is-the-resolver-request-url.md)).

## Alternatives Considered

- **The confirm dialog the other families use.** Rejected for link sets: it contradicts the #811 contract, and it guards a removal that undo repairs more cheaply than the dialog interrupts.
- **Delete-with-undo for every family.** Not taken here. Credentials and schemes discard completed validation runs on removal, and restoring those without re-running pipelines would need result-preserving restore semantics nobody has designed; their dialogs stay until a decision says otherwise.

## References

- #811 (removal contract)
- [ADR-041](./041-playground-shared-per-instance-artefact-model.md) (the model this adds `restore` to; its removal section now applies per-family)
- [ADR-046](./046-link-set-identity-is-the-resolver-request-url.md) (the sibling per-family exception for identity)
