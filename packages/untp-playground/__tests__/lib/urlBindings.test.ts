import {
  dropUrlBinding,
  emptyUrlBindings,
  recordUrlBinding,
  remapUrlBindings,
  resolveBoundInstance,
} from '@/lib/urlBindings';

describe('urlBindings', () => {
  it('records later ingestions over earlier ones and ignores empty urls', () => {
    let bindings = recordUrlBinding(emptyUrlBindings, ['https://a.example.org/1', undefined, ''], 'id-1');
    bindings = recordUrlBinding(bindings, ['https://a.example.org/1'], 'id-2');
    expect(bindings.get('https://a.example.org/1')).toBe('id-2');
    expect(bindings.size).toBe(1);
  });

  it('resolves a binding to its live instance and fails open when the instance is gone', () => {
    const bindings = recordUrlBinding(emptyUrlBindings, ['https://a.example.org/1'], 'id-1');
    const items = [{ instanceId: 'id-1', contentHash: 'h', payload: 'p', runId: null, result: undefined }];
    expect(resolveBoundInstance(bindings, 'https://a.example.org/1', items as any)?.instanceId).toBe('id-1');
    expect(resolveBoundInstance(bindings, 'https://a.example.org/1', [])).toBeUndefined();
    expect(resolveBoundInstance(bindings, 'https://unknown.example.org/x', items as any)).toBeUndefined();
  });
});

describe('remapUrlBindings (#813 collision merge)', () => {
  it('repoints every URL bound to the removed instance and leaves others alone', () => {
    let bindings = recordUrlBinding(emptyUrlBindings, ['https://a.example.org/1'], 'id-twin');
    bindings = recordUrlBinding(bindings, ['https://b.example.org/2'], 'id-twin');
    bindings = recordUrlBinding(bindings, ['https://c.example.org/3'], 'id-other');

    const next = remapUrlBindings(bindings, 'id-twin', 'id-survivor');
    expect(next.get('https://a.example.org/1')).toBe('id-survivor');
    expect(next.get('https://b.example.org/2')).toBe('id-survivor');
    expect(next.get('https://c.example.org/3')).toBe('id-other');
  });
});

describe('dropUrlBinding (#1007)', () => {
  it('forgets one URL and leaves the rest, returning the same map when nothing changes', () => {
    const bindings = recordUrlBinding(emptyUrlBindings, ['https://x/a', 'https://x/b'], 'A' as any);
    const dropped = dropUrlBinding(bindings, 'https://x/a');
    expect(dropped.has('https://x/a')).toBe(false);
    expect(dropped.get('https://x/b')).toBe('A');
    expect(dropUrlBinding(dropped, 'https://x/none')).toBe(dropped);
  });
});

describe('recordUrlBinding identity (#814)', () => {
  it('returns the same map when every url already points at the instance, so a repeat Verify is not a change', () => {
    const bindings = recordUrlBinding(emptyUrlBindings, ['https://x/a', 'https://x/b'], 'A' as any);
    expect(recordUrlBinding(bindings, ['https://x/a'], 'A' as any)).toBe(bindings);
    expect(recordUrlBinding(bindings, ['https://x/a', undefined, ''], 'A' as any)).toBe(bindings);
    expect(recordUrlBinding(bindings, [undefined, ''], 'B' as any)).toBe(bindings);
  });

  it('returns a new map, leaving the input untouched, when a url is new or moves to another instance', () => {
    const bindings = recordUrlBinding(emptyUrlBindings, ['https://x/a'], 'A' as any);
    const added = recordUrlBinding(bindings, ['https://x/a', 'https://x/c'], 'A' as any);
    expect(added).not.toBe(bindings);
    expect(added.get('https://x/c')).toBe('A');
    expect(bindings.has('https://x/c')).toBe(false);
    const moved = recordUrlBinding(bindings, ['https://x/a'], 'B' as any);
    expect(moved).not.toBe(bindings);
    expect(moved.get('https://x/a')).toBe('B');
    expect(bindings.get('https://x/a')).toBe('A');
  });
});
