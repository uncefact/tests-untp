import {
  emptyCollection,
  matchTarget,
  upsert,
  remove,
  restore,
  beginRun,
  commitResult,
} from '@/lib/artefactCollection';
import type { CollectionState } from '@/types/artefact';

// Test doubles for the opaque family payload P and result R.
type P = { name: string };
type R = { steps: number; done: boolean };

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function seed(...entries: Array<{ payload: P; contentHash: string }>): {
  state: CollectionState<P, R>;
  mintId: () => string;
} {
  const mintId = counter('i');
  let state = emptyCollection<P, R>();
  for (const e of entries) {
    state = upsert(state, { ...e, mintInstanceId: mintId }).state;
  }
  return { state, mintId };
}

describe('matchTarget', () => {
  const items = [
    { instanceId: 'A', contentHash: 'hash-a' },
    { instanceId: 'B', contentHash: 'hash-b' },
  ];

  it('finds the instance with the matching content hash', () => {
    expect(matchTarget(items, 'hash-b')).toEqual({ kind: 'one', instanceId: 'B' });
  });

  it('returns none when no content hash matches', () => {
    expect(matchTarget(items, 'hash-z')).toEqual({ kind: 'none' });
  });
});

describe('upsert', () => {
  it('appends a new instance when the content hash is new', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ instanceId: 'i-1', contentHash: 'h1', result: undefined, runId: null });
  });

  it('appends in upload order', () => {
    const { state } = seed(
      { payload: { name: 'one' }, contentHash: 'h1' },
      { payload: { name: 'two' }, contentHash: 'h2' },
    );
    expect(state.items.map((i) => i.payload.name)).toEqual(['one', 'two']);
  });

  it('appends different content as separate instances even when other fields would collide', () => {
    const { state } = seed(
      { payload: { name: 'scheme-a' }, contentHash: 'h1' },
      { payload: { name: 'scheme-b' }, contentHash: 'h2' },
    );
    expect(state.items).toHaveLength(2);
  });

  it('replaces in place on a matching hash, keeping the instanceId and index, clearing result and runId', () => {
    const mintId = counter('i');
    let state = emptyCollection<P, R>();
    state = upsert(state, { payload: { name: 'a' }, contentHash: 'h1', mintInstanceId: mintId }).state;
    state = upsert(state, { payload: { name: 'b' }, contentHash: 'h2', mintInstanceId: mintId }).state;
    state = beginRun(state, 'i-1', { steps: 1, done: false }, () => 'run-x').state;

    const { state: next, outcome } = upsert(state, {
      payload: { name: 'a-again' },
      contentHash: 'h1',
      mintInstanceId: mintId,
    });

    expect(outcome).toEqual({ kind: 'replaced', instanceId: 'i-1', index: 0 });
    expect(next.items).toHaveLength(2);
    expect(next.items[0]).toMatchObject({ instanceId: 'i-1', result: undefined, runId: null });
    expect(next.items[0].payload).toEqual({ name: 'a-again' });
  });

  it('is idempotent for identical content (same hash re-uploaded stays one instance)', () => {
    const { state, mintId } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const { state: next } = upsert(state, { payload: { name: 'one' }, contentHash: 'h1', mintInstanceId: mintId });
    expect(next.items).toHaveLength(1);
  });
});

describe('remove', () => {
  it('removes an instance', () => {
    const { state } = seed(
      { payload: { name: 'one' }, contentHash: 'h1' },
      { payload: { name: 'two' }, contentHash: 'h2' },
    );
    const { state: after, removed } = remove(state, 'i-1');
    expect(removed).toBe(true);
    expect(after.items.map((i) => i.payload.name)).toEqual(['two']);
  });

  it('is a no-op when the instance is missing', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const { state: after, removed } = remove(state, 'nope');
    expect(removed).toBe(false);
    expect(after).toBe(state);
  });
});

describe('beginRun and commitResult (stale-write guard)', () => {
  it('beginRun mints a run token and sets the pending result', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const { state: running, runId } = beginRun(state, 'i-1', { steps: 0, done: false }, () => 'r1');
    expect(runId).toBe('r1');
    expect(running.items[0].runId).toBe('r1');
    expect(running.items[0].result).toEqual({ steps: 0, done: false });
  });

  it('beginRun on a missing instance is a no-op returning a null run', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const { state: after, runId } = beginRun(state, 'nope', { steps: 0, done: false }, () => 'r1');
    expect(runId).toBeNull();
    expect(after).toBe(state);
  });

  it('beginRun on an already-running slot is a no-op (no duplicate pipeline under a repeated effect)', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const running = beginRun(state, 'i-1', { steps: 0, done: false }, () => 'r1').state;
    const { state: after, runId } = beginRun(running, 'i-1', { steps: 0, done: false }, () => 'r2');
    expect(runId).toBeNull();
    expect(after.items[0].runId).toBe('r1');
  });

  it('applies a write that carries the current run token', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const running = beginRun(state, 'i-1', { steps: 0, done: false }, () => 'r1').state;
    const { state: written, applied } = commitResult(running, {
      instanceId: 'i-1',
      runId: 'r1',
      result: { steps: 3, done: true },
    });
    expect(applied).toBe(true);
    expect(written.items[0].result).toEqual({ steps: 3, done: true });
  });

  it('drops a superseded run’s late write after a replace re-runs the instance', () => {
    const { state, mintId } = seed({ payload: { name: 'v1' }, contentHash: 'h1' });
    const running = beginRun(state, 'i-1', { steps: 0, done: false }, () => 'r1').state;
    // Same content re-uploaded (replace) clears the run token.
    const replaced = upsert(running, { payload: { name: 'v1' }, contentHash: 'h1', mintInstanceId: mintId }).state;
    const { applied } = commitResult(replaced, { instanceId: 'i-1', runId: 'r1', result: { steps: 3, done: true } });
    expect(applied).toBe(false);
  });

  it('drops a write for an instance that has been removed', () => {
    const { state } = seed({ payload: { name: 'one' }, contentHash: 'h1' });
    const running = beginRun(state, 'i-1', { steps: 0, done: false }, () => 'r1').state;
    const removed = remove(running, 'i-1').state;
    const { applied } = commitResult(removed, { instanceId: 'i-1', runId: 'r1', result: { steps: 3, done: true } });
    expect(applied).toBe(false);
  });
});

describe('restore (single-level undo)', () => {
  it('reinserts a removed slot at its old position', () => {
    const { state } = seed(
      { payload: { name: 'a' }, contentHash: 'ha' },
      { payload: { name: 'b' }, contentHash: 'hb' },
      { payload: { name: 'c' }, contentHash: 'hc' },
    );
    const slot = state.items[1];
    const afterRemove = remove(state, slot.instanceId).state;

    const { state: restored, restored: didRestore } = restore(afterRemove, slot, 1);

    expect(didRestore).toBe(true);
    expect(restored.items.map((item) => item.payload.name)).toEqual(['a', 'b', 'c']);
  });

  it('clamps an out-of-range index to the end', () => {
    const { state } = seed({ payload: { name: 'a' }, contentHash: 'ha' });
    const slot = state.items[0];
    const afterRemove = remove(state, slot.instanceId).state;

    const { state: restored } = restore(afterRemove, slot, 99);

    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].payload.name).toBe('a');
  });

  it('is a no-op when the same content key was re-added before the undo', () => {
    const { state, mintId } = seed({ payload: { name: 'a' }, contentHash: 'ha' });
    const slot = state.items[0];
    const afterRemove = remove(state, slot.instanceId).state;
    const reAdded = upsert(afterRemove, { payload: { name: 'a2' }, contentHash: 'ha', mintInstanceId: mintId }).state;

    const { state: restored, restored: didRestore } = restore(reAdded, slot, 0);

    expect(didRestore).toBe(false);
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].payload.name).toBe('a2');
  });
});
