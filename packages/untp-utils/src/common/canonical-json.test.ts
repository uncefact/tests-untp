import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts keys, removes whitespace and preserves nested structure', () => {
    // Catches a regression that only sorts top-level keys or retains whitespace.
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: [3, { d: 4, c: 5 }] })).toBe(
      '{"a":[3,{"c":5,"d":4}],"z":{"a":1,"b":2}}',
    );
  });

  it('omits undefined object properties and writes undefined array items as null', () => {
    // Catches a regression that serialises undefined object values or rejects array holes.
    expect(canonicalJson({ keep: true, omit: undefined, values: [undefined, 'x'] })).toBe(
      '{"keep":true,"values":[null,"x"]}',
    );
  });

  it('preserves array order, unicode and JSON number spelling', () => {
    // Catches a regression that sorts arrays, escapes unicode unnecessarily or changes numbers.
    expect(canonicalJson({ values: ['z', 'ä', 'a'], number: 1.5, negativeZero: -0 })).toBe(
      '{"negativeZero":0,"number":1.5,"values":["z","ä","a"]}',
    );
  });

  it('rejects top-level undefined', () => {
    // Catches a regression that silently turns an absent top-level value into JSON null.
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });
});
