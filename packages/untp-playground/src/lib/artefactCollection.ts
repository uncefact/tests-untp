/**
 * Pure operations for the shared per-instance artefact model (ADR-041).
 *
 * Framework-free and family-agnostic: `P` is the family payload, `R` the family result, both
 * opaque here. `contentHash` is a generic identity key: credentials and schemes pass a content
 * hash (identical content is one instance), link sets pass their normalised resolver request URL
 * (ADR-046) — do not assume every family hashes content. Id minting is injected so the operations stay pure and deterministic under
 * test. The React layer supplies real minters.
 */

import type { ArtefactSlot, CollectionState, InstanceId, MatchResult, RunId, UpsertOutcome } from '@/types/artefact';

export function emptyCollection<P, R>(): CollectionState<P, R> {
  return { items: [] };
}

/** Find the instance whose content hash matches, if any. */
export function matchTarget(
  items: ReadonlyArray<{ instanceId: InstanceId; contentHash: string }>,
  contentHash: string,
): MatchResult {
  const match = items.find((item) => item.contentHash === contentHash);
  return match ? { kind: 'one', instanceId: match.instanceId } : { kind: 'none' };
}

/**
 * Append a new instance in upload order, or, when its content hash matches a loaded instance,
 * replace that instance at its existing index (keeping its instanceId, clearing its result and
 * run token so a superseded run cannot write). Re-uploading identical content is therefore
 * idempotent; different content always appends.
 */
export function upsert<P, R>(
  state: CollectionState<P, R>,
  input: { payload: P; contentHash: string; mintInstanceId: () => InstanceId },
): { state: CollectionState<P, R>; outcome: UpsertOutcome } {
  const index = state.items.findIndex((item) => item.contentHash === input.contentHash);

  if (index !== -1) {
    const instanceId = state.items[index].instanceId;
    const items = state.items.slice();
    items[index] = {
      instanceId,
      contentHash: input.contentHash,
      payload: input.payload,
      result: undefined,
      runId: null,
    };
    return { state: { items }, outcome: { kind: 'replaced', instanceId, index } };
  }

  const instanceId = input.mintInstanceId();
  const slot: ArtefactSlot<P, R> = {
    instanceId,
    contentHash: input.contentHash,
    payload: input.payload,
    result: undefined,
    runId: null,
  };
  return { state: { items: [...state.items, slot] }, outcome: { kind: 'appended', instanceId } };
}

/** Remove an instance. Removing a missing instance is a no-op. */
export function remove<P, R>(
  state: CollectionState<P, R>,
  instanceId: InstanceId,
): { state: CollectionState<P, R>; removed: boolean } {
  const index = state.items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) return { state, removed: false };
  const items = state.items.slice();
  items.splice(index, 1);
  return { state: { items }, removed: true };
}

/**
 * Reinsert a previously removed slot at its old position, for a single-level undo. A no-op when a
 * slot with the same instanceId or content key is already present (the user re-uploaded before
 * undoing), so undo never duplicates an instance. An out-of-range index clamps to the end.
 */
export function restore<P, R>(
  state: CollectionState<P, R>,
  slot: ArtefactSlot<P, R>,
  index: number,
): { state: CollectionState<P, R>; restored: boolean } {
  const duplicate = state.items.some(
    (item) => item.instanceId === slot.instanceId || item.contentHash === slot.contentHash,
  );
  if (duplicate) return { state, restored: false };
  const items = state.items.slice();
  items.splice(Math.max(0, Math.min(index, items.length)), 0, slot);
  return { state: { items }, restored: true };
}

/**
 * Mint a fresh run token for an idle instance and set its pending result. Only an idle slot begins
 * a run, so a repeated call for the same instance (for example React StrictMode's double effect)
 * is a no-op returning a null run, rather than starting a duplicate pipeline.
 */
export function beginRun<P, R>(
  state: CollectionState<P, R>,
  instanceId: InstanceId,
  emptyResult: R,
  mintRunId: () => RunId,
): { state: CollectionState<P, R>; runId: RunId | null } {
  const index = state.items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1 || state.items[index].runId !== null) return { state, runId: null };

  const runId = mintRunId();
  const items = state.items.slice();
  items[index] = { ...items[index], runId, result: emptyResult };
  return { state: { items }, runId };
}

/**
 * The only path that writes a result. Applies only when the instance still exists and still holds
 * the given run token, so a superseded or removed run's late completion is dropped.
 */
export function commitResult<P, R>(
  state: CollectionState<P, R>,
  args: { instanceId: InstanceId; runId: RunId; result: R },
): { state: CollectionState<P, R>; applied: boolean } {
  const index = state.items.findIndex((item) => item.instanceId === args.instanceId);
  if (index === -1 || state.items[index].runId !== args.runId) {
    return { state, applied: false };
  }
  const items = state.items.slice();
  items[index] = { ...items[index], result: args.result };
  return { state: { items }, applied: true };
}

/**
 * Replaces a slot's payload in place and clears its run state (#813): the instance identity
 * survives (bindings keep pointing at it) while the result and run token reset, so the standard
 * begin-a-run-when-unstarted effect starts the pipeline over the new payload. Returns the state
 * unchanged when the instance is not present.
 */
export function replacePayload<P, R>(
  state: CollectionState<P, R>,
  instanceId: InstanceId,
  payload: P,
  contentHash: string,
): { state: CollectionState<P, R>; replaced: boolean } {
  const index = state.items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) return { state, replaced: false };
  const items = [...state.items];
  items[index] = { instanceId, contentHash, payload, runId: null, result: undefined };
  return { state: { items }, replaced: true };
}

/**
 * Decrypt-collision merge for a COMPLETED twin (#813): the locked slot that was just decrypted
 * keeps its identity, provenance and position, adopts the twin's finished result (the caller
 * prepends the successful Decryption step), and the twin is removed in the same transition so
 * one-slot-per-hash never breaks even transiently. Fails open (absorbed: false, state unchanged)
 * when either slot is missing.
 */
export function absorbTwin<P, R>(
  state: CollectionState<P, R>,
  instanceId: InstanceId,
  twinInstanceId: InstanceId,
  payload: P,
  contentHash: string,
  result: R,
  mintRunId: () => RunId,
): { state: CollectionState<P, R>; absorbed: boolean } {
  const index = state.items.findIndex((item) => item.instanceId === instanceId);
  const twinIndex = state.items.findIndex((item) => item.instanceId === twinInstanceId);
  if (index === -1 || twinIndex === -1) return { state, absorbed: false };
  const items = state.items.filter((item) => item.instanceId !== twinInstanceId);
  const newIndex = items.findIndex((item) => item.instanceId === instanceId);
  items[newIndex] = { instanceId, contentHash, payload, runId: mintRunId(), result };
  return { state: { items }, absorbed: true };
}

/**
 * Applies a successful decrypt atomically (#813): looks the content-hash twin up in the CURRENT
 * state (never a render closure), then either absorbs a settled twin (the decrypting slot keeps
 * its identity and adopts the twin's finished result behind the given leading step, the twin
 * removed in the same transition) or replaces in place, dropping a still-running twin whose work
 * is not worth preserving. The caller remaps URL bindings and envelope aliases from `twinId`.
 */
export function admitDecrypted<P, R extends unknown[]>(
  state: CollectionState<P, R>,
  args: {
    instanceId: InstanceId;
    payload: P;
    contentHash: string;
    leadingStep: R[number];
    isTerminal: (result: R | undefined) => boolean;
    leadsWithDecryption: (result: R) => boolean;
    mintRunId: () => RunId;
  },
): {
  state: CollectionState<P, R>;
  outcome: { kind: 'absorbed' | 'replaced'; twinId?: InstanceId } | { kind: 'missing' };
} {
  const { instanceId, payload, contentHash, leadingStep, isTerminal, leadsWithDecryption, mintRunId } = args;
  const index = state.items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) return { state, outcome: { kind: 'missing' } };
  const twin = state.items.find((item) => item.instanceId !== instanceId && item.contentHash === contentHash);

  if (twin && twin.result !== undefined && isTerminal(twin.result)) {
    // A twin that was itself decrypted earlier already leads with a Decryption step; do not stack a second.
    const result = (leadsWithDecryption(twin.result) ? [...twin.result] : [leadingStep, ...twin.result]) as R;
    const items = state.items.filter((item) => item.instanceId !== twin.instanceId);
    const newIndex = items.findIndex((item) => item.instanceId === instanceId);
    items[newIndex] = { instanceId, contentHash, payload, runId: mintRunId(), result };
    return { state: { items }, outcome: { kind: 'absorbed', twinId: twin.instanceId } };
  }

  const items = state.items.filter((item) => item.instanceId === instanceId || item.instanceId !== twin?.instanceId);
  const newIndex = items.findIndex((item) => item.instanceId === instanceId);
  items[newIndex] = { instanceId, contentHash, payload, runId: null, result: undefined };
  return { state: { items }, outcome: { kind: 'replaced', twinId: twin?.instanceId } };
}
