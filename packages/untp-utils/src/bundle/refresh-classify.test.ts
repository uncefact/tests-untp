// The refresh script is plain ESM JavaScript outside `src/`, so it is loaded
// at runtime rather than imported statically (tsc's rootDir is `src`).
const scriptUrl = new URL('../../scripts/refresh-artefacts.mjs', import.meta.url).href;
const { classify } = (await import(scriptUrl)) as {
  classify: (bundled: string | undefined, fetched: string) => string;
};

describe('refresh-artefacts classify', () => {
  it('reports a copy the bundle does not have', () => {
    expect(classify(undefined, '{"a":1}')).toBe('missing');
  });

  it('treats byte-different but content-equal copies as the same, so a formatter never reads as drift', () => {
    expect(classify('{\n  "a": 1\n}\n', '{"a":1}')).toBe('same');
  });

  it('reports a published copy whose content differs', () => {
    expect(classify('{"a":1}', '{"a":2}')).toBe('differs');
  });

  it('reports an unreadable bundled copy as corrupt rather than as upstream drift', () => {
    expect(classify('{not json', '{"a":1}')).toBe('corrupt');
  });
});
