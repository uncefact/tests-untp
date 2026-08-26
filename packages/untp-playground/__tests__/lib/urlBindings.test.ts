import { emptyUrlBindings, recordUrlBinding, remapUrlBindings, resolveBoundInstance } from '@/lib/urlBindings';

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
