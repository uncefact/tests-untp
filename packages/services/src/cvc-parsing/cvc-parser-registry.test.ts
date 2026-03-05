import { getCvcParser, SUPPORTED_CVC_VERSIONS } from './cvc-parser-registry';
import { CvcV070Parser } from './parsers/cvc-v070.parser';

describe('getCvcParser', () => {
  it('returns the v0.7.0 parser for version "0.7.0"', () => {
    const parser = getCvcParser('0.7.0');

    expect(parser).toBeInstanceOf(CvcV070Parser);
  });

  it('returns undefined for an unsupported version', () => {
    expect(getCvcParser('99.0.0')).toBeUndefined();
  });
});

describe('SUPPORTED_CVC_VERSIONS', () => {
  it('includes 0.7.0', () => {
    expect(SUPPORTED_CVC_VERSIONS).toContain('0.7.0');
  });
});
