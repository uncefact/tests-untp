import {
  readBundledArtefactsFallback,
  validateBundledArtefactsFallbackOnBoot,
} from './bundled-artefacts-fallback.config';

describe('readBundledArtefactsFallback', () => {
  it('is on when BUNDLED_ARTEFACTS_FALLBACK is unset or blank', () => {
    expect(readBundledArtefactsFallback({})).toBe(true);
    expect(readBundledArtefactsFallback({ BUNDLED_ARTEFACTS_FALLBACK: '  ' })).toBe(true);
  });

  it.each(['false', 'FALSE', ' False '])('is off for %s', (raw) => {
    expect(readBundledArtefactsFallback({ BUNDLED_ARTEFACTS_FALLBACK: raw })).toBe(false);
  });

  it('is on for true', () => {
    expect(readBundledArtefactsFallback({ BUNDLED_ARTEFACTS_FALLBACK: 'true' })).toBe(true);
  });

  it.each(['off', '0', 'no', 'yes'])('throws on %s, naming the variable', (raw) => {
    expect(() => readBundledArtefactsFallback({ BUNDLED_ARTEFACTS_FALLBACK: raw })).toThrow(
      /BUNDLED_ARTEFACTS_FALLBACK/,
    );
  });
});

describe('validateBundledArtefactsFallbackOnBoot', () => {
  it('passes when unset', () => {
    expect(() => validateBundledArtefactsFallbackOnBoot({})).not.toThrow();
  });

  it('throws at boot when invalid', () => {
    expect(() => validateBundledArtefactsFallbackOnBoot({ BUNDLED_ARTEFACTS_FALLBACK: 'off' })).toThrow(
      /BUNDLED_ARTEFACTS_FALLBACK/,
    );
  });
});
