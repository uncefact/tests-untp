// @ts-expect-error: the script is plain ESM JavaScript with no declaration file.
import { classify } from './refresh-artefacts.mjs';

describe('classify', () => {
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
