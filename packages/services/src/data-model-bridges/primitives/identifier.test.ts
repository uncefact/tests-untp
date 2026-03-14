import { buildIdentifierScheme } from './identifier.js';

describe('buildIdentifierScheme', () => {
  it('returns IdentifierScheme object when scheme has both id and name', () => {
    const result = buildIdentifierScheme({ id: 'scheme-1', name: 'GLN' });

    expect(result).toEqual({
      type: ['IdentifierScheme'],
      id: 'scheme-1',
      name: 'GLN',
    });
  });

  it('returns undefined when scheme is null', () => {
    const result = buildIdentifierScheme(null);

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme is undefined', () => {
    const result = buildIdentifierScheme(undefined);

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme has id but no name', () => {
    const result = buildIdentifierScheme({ id: 'scheme-1' });

    expect(result).toBeUndefined();
  });

  it('returns undefined when scheme has name but no id', () => {
    const result = buildIdentifierScheme({ name: 'GLN' });

    expect(result).toBeUndefined();
  });
});
