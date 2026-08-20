/**
 * Shared per-instance artefact model (ADR-041).
 *
 * A family-agnostic ordered collection of validated artefact instances. It owns the instances,
 * their opaque results, and the per-run write token that guards stale writes. `contentHash` is a
 * generic identity key each family supplies: credentials and schemes pass a content hash
 * (identical content is one instance), link sets pass their normalised resolver request URL or
 * filename (ADR-046), so do not assume the key is always a hash. `P` is the family payload and
 * `R` the family result, both opaque here. Schemes (#677) are the first consumer; credentials
 * (#810) and link sets (#811) reuse it.
 *
 * See docs/adrs/041-playground-shared-per-instance-artefact-model.md.
 */

/** Immutable synthetic id, minted per instance, stable across in-place replace. */
export type InstanceId = string;
/** Minted per pipeline run; the token a write must carry to be applied. */
export type RunId = string;

/** One instance: its content-hash identity, opaque payload, opaque result, and the live run token. */
export interface ArtefactSlot<P, R> {
  instanceId: InstanceId;
  /** Content hash of the artefact; identical content shares one instance. */
  contentHash: string;
  payload: P;
  /** `undefined` = no snapshot yet, or cleared for a fresh run. */
  result: R | undefined;
  /** `null` = idle (no live run). Set by `beginRun`, cleared by `upsert`. */
  runId: RunId | null;
}

/** The whole collection: ordered instances in upload order. */
export interface CollectionState<P, R> {
  items: ArtefactSlot<P, R>[];
}

/** Result of matching an incoming content hash against the loaded instances. */
export type MatchResult = { kind: 'none' } | { kind: 'one'; instanceId: InstanceId };

/** Outcome of an upsert. */
export type UpsertOutcome =
  | { kind: 'appended'; instanceId: InstanceId }
  | { kind: 'replaced'; instanceId: InstanceId; index: number };
