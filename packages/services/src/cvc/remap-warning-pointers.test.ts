import { remapWarningPointers } from './remap-warning-pointers';

const SOURCE_MAP = {
  '/scheme': '/referenceScheme/id',
  '/criteria/0/criterion': '/conformityAssessment/0/assessmentCriteria/0/id',
  '/criteria/0/conformityTopics/0': '/conformityAssessment/0/assessmentCriteria/0/conformityTopic/1',
  '/assessments/0/conformityTopics/0': '/conformityAssessment/0/conformityTopic/0',
};

const DOCUMENT = {
  credentialSubject: {
    referenceScheme: { id: 'https://scheme.example' },
    conformityAssessment: [
      {
        conformityTopic: [{ id: 'https://topic.example/a' }],
        assessmentCriteria: [
          {
            id: 'https://criterion.example/1',
            conformityTopic: [{}, { id: 'https://topic.example/b' }],
          },
        ],
      },
    ],
  },
};

function warning(pointer?: string) {
  return { code: 'conformity-criterion.not-in-profile', message: 'unused', ...(pointer && { pointer }) };
}

describe('remapWarningPointers', () => {
  it('rewrites a pointer onto the submitted document', () => {
    const [result] = remapWarningPointers([warning('/scheme')], SOURCE_MAP, DOCUMENT, '/credentialSubject');

    expect(result.pointer).toBe('/credentialSubject/referenceScheme/id');
  });

  it('rewrites a topic pointer to the source index the value was read from', () => {
    // The projected topic sits at index 0 because the extractor drops the
    // id-less entry ahead of it; the source index is 1.
    const [result] = remapWarningPointers(
      [warning('/criteria/0/conformityTopics/0')],
      SOURCE_MAP,
      DOCUMENT,
      '/credentialSubject',
    );

    expect(result.pointer).toBe('/credentialSubject/conformityAssessment/0/assessmentCriteria/0/conformityTopic/1');
  });

  it('drops a pointer the map does not cover', () => {
    // `/criteria` is the missing-criterion warning: the subject is absent from
    // the document, so there is nothing to point at.
    const [result] = remapWarningPointers([warning('/criteria')], SOURCE_MAP, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
    expect(result.code).toBe('conformity-criterion.not-in-profile');
  });

  it('drops every pointer when the bridge recorded no provenance', () => {
    const [result] = remapWarningPointers([warning('/scheme')], undefined, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops a mapped pointer that does not resolve in the document', () => {
    const staleMap = { '/scheme': '/conformityAssessment/9/assessmentCriteria/0/id' };

    const [result] = remapWarningPointers([warning('/scheme')], staleMap, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });

  it('leaves a warning that carries no pointer untouched', () => {
    const input = warning();

    const [result] = remapWarningPointers([input], SOURCE_MAP, DOCUMENT, '/credentialSubject');

    expect(result).toBe(input);
  });

  it('preserves the warning fields it does not rewrite', () => {
    const input = { ...warning('/scheme'), received: 'a', expected: 'b' };

    const [result] = remapWarningPointers([input], SOURCE_MAP, DOCUMENT, '/credentialSubject');

    expect(result).toMatchObject({ code: input.code, message: input.message, received: 'a', expected: 'b' });
  });

  it('does not modify the warnings it was given', () => {
    const input = warning('/scheme');

    remapWarningPointers([input], SOURCE_MAP, DOCUMENT, '/credentialSubject');

    expect(input.pointer).toBe('/scheme');
  });

  it('ignores a mapping reached only through the prototype chain', () => {
    // An empty own map must stay empty: a polluted prototype must not be able
    // to put a pointer back into a response.
    const polluted = Object.create({ '/scheme': '/referenceScheme/id' }) as Record<string, string>;

    const [result] = remapWarningPointers([warning('/scheme')], polluted, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops a recorded path that is not a well-formed pointer', () => {
    // The sibling exists precisely so this fails without the syntax check:
    // concatenating 'Elsewhere/id' onto '/credentialSubject' addresses
    // /credentialSubjectElsewhere/id, which resolves here and would be
    // published as though it named something inside the subject.
    const document = { ...DOCUMENT, credentialSubjectElsewhere: { id: 'present' } };
    const malformed = { '/scheme': 'Elsewhere/id' };

    const [result] = remapWarningPointers([warning('/scheme')], malformed, document, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops a map value that is not a string at runtime', () => {
    // The type says string; a map built at runtime need not honour that, and
    // an advisory path must drop the pointer rather than throw.
    const wrongType = { '/scheme': 42 } as unknown as Record<string, string>;

    const [result] = remapWarningPointers([warning('/scheme')], wrongType, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops a warning whose own pointer is not a well-formed pointer', () => {
    const [result] = remapWarningPointers(
      [warning('scheme')],
      { scheme: '/referenceScheme/id' },
      DOCUMENT,
      '/credentialSubject',
    );

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops a recorded path using an escape RFC 6901 does not define', () => {
    const document = { credentialSubject: { 'bad~2escape': 'present' } };

    const [result] = remapWarningPointers(
      [warning('/scheme')],
      { '/scheme': '/bad~2escape' },
      document,
      '/credentialSubject',
    );

    expect(result).not.toHaveProperty('pointer');
  });

  it('resolves the RFC 6901 escapes it does define', () => {
    const document = { credentialSubject: { 'a/b': { 'c~d': 'present' } } };

    const [result] = remapWarningPointers(
      [warning('/scheme')],
      { '/scheme': '/a~1b/c~0d' },
      document,
      '/credentialSubject',
    );

    expect(result.pointer).toBe('/credentialSubject/a~1b/c~0d');
  });

  it('drops a path addressing an inherited property of the document', () => {
    const [result] = remapWarningPointers(
      [warning('/scheme')],
      { '/scheme': '/constructor' },
      DOCUMENT,
      '/credentialSubject',
    );

    expect(result).not.toHaveProperty('pointer');
  });

  it('drops the array end-of-list token, which addresses no existing element', () => {
    const [result] = remapWarningPointers(
      [warning('/scheme')],
      { '/scheme': '/conformityAssessment/-' },
      DOCUMENT,
      '/credentialSubject',
    );

    expect(result).not.toHaveProperty('pointer');
  });

  it('rejects an out-of-range array index rather than treating it as a property', () => {
    const map = { '/scheme': '/conformityAssessment/1' };

    const [result] = remapWarningPointers([warning('/scheme')], map, DOCUMENT, '/credentialSubject');

    expect(result).not.toHaveProperty('pointer');
  });
});
