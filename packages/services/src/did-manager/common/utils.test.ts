import { didWebToUrl, parseDidMethod, normaliseDidWebAlias, normaliseSelfManagedAlias } from './utils';
import { DidParseError, DidMethodNotSupportedError, DidInputError } from '../errors';

describe('didWebToUrl', () => {
  it('converts a basic domain DID to a well-known URL', () => {
    expect(didWebToUrl('did:web:example.com')).toBe('https://example.com/.well-known/did.json');
  });

  it('converts a domain with path segments to the correct URL', () => {
    expect(didWebToUrl('did:web:example.com:path:to')).toBe('https://example.com/path/to/did.json');
  });

  it('decodes percent-encoded port in the domain', () => {
    expect(didWebToUrl('did:web:example.com%3A3000')).toBe('https://example.com:3000/.well-known/did.json');
  });

  it('handles localhost with percent-encoded port and path segments', () => {
    expect(didWebToUrl('did:web:localhost%3A3000:org:abc')).toBe('https://localhost:3000/org/abc/did.json');
  });

  it('converts a did:webvh domain to a well-known did.jsonl URL', () => {
    expect(didWebToUrl('did:webvh:example.com')).toBe('https://example.com/.well-known/did.jsonl');
  });

  it('converts a did:webvh with path segments to did.jsonl', () => {
    expect(didWebToUrl('did:webvh:example.com:org:abc')).toBe('https://example.com/org/abc/did.jsonl');
  });

  it('throws DidParseError for unsupported DID method', () => {
    expect(() => didWebToUrl('did:key:z6Mk...')).toThrow(DidParseError);
  });
});

describe('parseDidMethod', () => {
  it('returns "web" for a did:web DID', () => {
    expect(parseDidMethod('did:web:example.com')).toBe('web');
  });

  // TODO: Enable when did:webvh support is implemented
  it('throws DidMethodNotSupportedError for did:webvh (not yet supported)', () => {
    expect(() => parseDidMethod('did:webvh:example.com:abc')).toThrow(DidMethodNotSupportedError);
  });

  it('throws DidMethodNotSupportedError for unsupported did:key method', () => {
    expect(() => parseDidMethod('did:key:z6Mk...')).toThrow(DidMethodNotSupportedError);
  });

  it('throws DidMethodNotSupportedError for unsupported did:ethr method', () => {
    expect(() => parseDidMethod('did:ethr:0x...')).toThrow(DidMethodNotSupportedError);
  });

  it('throws DidParseError for an empty string', () => {
    expect(() => parseDidMethod('')).toThrow(DidParseError);
  });

  it('throws DidParseError for an invalid format', () => {
    expect(() => parseDidMethod('not-a-did')).toThrow(DidParseError);
  });

  it('throws DidParseError when the method-specific-id is missing', () => {
    expect(() => parseDidMethod('did:web')).toThrow(DidParseError);
  });
});

describe('normaliseDidWebAlias', () => {
  it('lowercases the input', () => {
    expect(normaliseDidWebAlias('MyOrg')).toBe('myorg');
  });

  it('replaces spaces with hyphens', () => {
    expect(normaliseDidWebAlias('my org name')).toBe('my-org-name');
  });

  it('strips invalid characters', () => {
    expect(normaliseDidWebAlias('my_org@123!')).toBe('myorg123');
  });

  it('collapses consecutive hyphens', () => {
    expect(normaliseDidWebAlias('my---org')).toBe('my-org');
  });

  it('trims leading and trailing hyphens', () => {
    expect(normaliseDidWebAlias('-my-org-')).toBe('my-org');
  });

  it('handles a mix of normalisation rules', () => {
    expect(normaliseDidWebAlias('  My Org & Co.  ')).toBe('my-org-co');
  });

  it('throws DidInputError for input that normalises to empty', () => {
    expect(() => normaliseDidWebAlias('!!!')).toThrow(DidInputError);
  });

  it('throws DidInputError for empty string', () => {
    expect(() => normaliseDidWebAlias('')).toThrow(DidInputError);
  });

  it('preserves already-valid aliases', () => {
    expect(normaliseDidWebAlias('my-org-123')).toBe('my-org-123');
  });
});

describe('normaliseSelfManagedAlias', () => {
  it('preserves dots and colons in domain aliases', () => {
    expect(normaliseSelfManagedAlias('vckit.dev3.pyx.io:my-org')).toBe('vckit.dev3.pyx.io:my-org');
  });

  it('lowercases the input', () => {
    expect(normaliseSelfManagedAlias('Example.COM:My-Org')).toBe('example.com:my-org');
  });

  it('trims whitespace', () => {
    expect(normaliseSelfManagedAlias('  example.com:org  ')).toBe('example.com:org');
  });

  it('strips invalid characters', () => {
    expect(normaliseSelfManagedAlias('example.com:my_org@123!')).toBe('example.com:myorg123');
  });

  it('handles complex whitespace and invalid characters', () => {
    expect(normaliseSelfManagedAlias('  my-domain.com : my org  ')).toBe('my-domain.com:my-org');
  });

  it('preserves hyphens', () => {
    expect(normaliseSelfManagedAlias('my-domain.io:my-org')).toBe('my-domain.io:my-org');
  });

  it('throws DidInputError for input that normalises to empty', () => {
    expect(() => normaliseSelfManagedAlias('!!!')).toThrow(DidInputError);
  });

  it('throws DidInputError for empty string', () => {
    expect(() => normaliseSelfManagedAlias('')).toThrow(DidInputError);
  });
});
